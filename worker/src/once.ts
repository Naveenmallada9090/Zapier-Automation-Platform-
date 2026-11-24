require('dotenv').config()

import { PrismaClient } from "@prisma/client";
import { runStage } from "./execution";

// One pass over the outbox: takes the pending zap runs, executes every stage in
// order and exits. This is what the scheduled github action runs, so the app can
// work without a long lived worker (and without kafka) on hosts that only give
// you short-lived jobs.

const prismaClient = new PrismaClient();

const BATCH_SIZE = Number(process.env.ONCE_BATCH_SIZE || 20);
const TIME_LIMIT_MS = Number(process.env.ONCE_TIME_LIMIT_MS || 4 * 60 * 1000);

async function processZapRun(zapRunId: string): Promise<"done" | "retry" | "gave_up" | "missing"> {
    const zapRun = await prismaClient.zapRun.findFirst({
        where: { id: zapRunId },
        include: { zap: { include: { actions: true } } }
    });

    if (!zapRun) {
        console.log(`zap run ${zapRunId} no longer exists, dropping it`);
        return "missing";
    }

    const stages = [...new Set(zapRun.zap.actions.map(x => x.sortingOrder))].sort((a, b) => a - b);

    if (stages.length === 0) {
        console.log(`zap run ${zapRunId} has no actions, nothing to do`);
        return "done";
    }

    for (const stage of stages) {
        // already confirmed actions are skipped inside runStage, so replaying a
        // stage after a partial failure does not send anything twice
        const result = await runStage(prismaClient, zapRunId, stage);

        if (result.outcome === "retry") {
            console.log(`stage ${stage} of zap run ${zapRunId} failed (attempt ${result.attempts}), will retry on the next run`);
            return "retry";
        }

        if (result.outcome === "gave_up") {
            console.log(`stage ${stage} of zap run ${zapRunId} failed too many times, giving up`);
            return "gave_up";
        }
    }

    console.log(`zap run ${zapRunId} finished`);
    return "done";
}

async function main() {
    const startedAt = Date.now();

    const pendingRows = await prismaClient.zapRunOutbox.findMany({
        take: BATCH_SIZE,
        orderBy: { id: "asc" }
    });

    console.log(`${pendingRows.length} pending zap run(s)`);

    for (const row of pendingRows) {
        if (Date.now() - startedAt > TIME_LIMIT_MS) {
            console.log("time limit reached, the rest stays queued for the next run");
            break;
        }

        const outcome = await processZapRun(row.zapRunId);

        if (outcome === "retry") {
            // keep the outbox row, the next scheduled run picks it up again
            continue;
        }

        await prismaClient.zapRunOutbox.deleteMany({ where: { id: row.id } });
    }

    await prismaClient.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prismaClient.$disconnect();
    process.exit(1);
})
