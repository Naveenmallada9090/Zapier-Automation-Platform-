import { PrismaClient } from "@prisma/client";
import { JsonObject } from "@prisma/client/runtime/library";
import { parse } from "./parser";
import { sendEmail } from "./email";
import { generateReference, reconcileSolTransaction, sendSol } from "./solana";

export const MAX_ATTEMPTS = 5;

export type Action = {
    id: string;
    actionId: string;
    metadata: any;
    sortingOrder: number;
    type: {
        id: string;
    }
};

export type StageOutcome = "done" | "retry" | "gave_up" | "missing" | "no-actions";

export type StageResult = {
    outcome: StageOutcome;
    lastStage: number;
    attempts: number;
};

// Every (zap run, action) pair gets exactly one execution row. The reference is
// stored on it so that a restarted worker can check the blockchain instead of
// blindly sending the same transfer again.
async function getExecution(prismaClient: PrismaClient, zapRunId: string, action: Action) {
    const where = {
        zapRunId_actionRowId: {
            zapRunId,
            actionRowId: action.id
        }
    };

    const existing = await prismaClient.actionExecution.findUnique({ where });
    if (existing) {
        return existing;
    }

    try {
        return await prismaClient.actionExecution.create({
            data: {
                zapRunId,
                actionRowId: action.id,
                stage: action.sortingOrder,
                actionId: action.actionId,
                reference: generateReference()
            }
        })
    } catch (e) {
        // another worker created the row first
        const created = await prismaClient.actionExecution.findUnique({ where });
        if (!created) {
            throw e;
        }
        return created;
    }
}

async function markStatus(prismaClient: PrismaClient, id: string, data: {
    status?: "PENDING" | "SENT" | "CONFIRMED" | "FAILED",
    signature?: string,
    error?: string | null
}) {
    await prismaClient.actionExecution.update({
        where: {
            id
        },
        data
    })
}

async function executeAction(prismaClient: PrismaClient, zapRunId: string, action: Action, zapRunMetadata: any) {
    const execution = await getExecution(prismaClient, zapRunId, action);

    if (execution.status === "CONFIRMED") {
        console.log(`Action ${action.actionId} of zap run ${zapRunId} already executed, skipping`);
        return;
    }

    if (execution.status === "FAILED") {
        console.log(`Action ${action.actionId} of zap run ${zapRunId} failed permanently, skipping`);
        return;
    }

    if (action.type.id === "email") {
        // An email can not be checked after the fact, so once it is handed to the
        // mail server we never send it again (at most once).
        if (execution.status === "SENT") {
            console.log("Email was already handed to the mail server, skipping to avoid a duplicate");
            return;
        }

        const body = parse((action.metadata as JsonObject)?.body as string, zapRunMetadata);
        const to = parse((action.metadata as JsonObject)?.email as string, zapRunMetadata);
        console.log(`Sending out email to ${to} body is ${body}`);

        await markStatus(prismaClient, execution.id, { status: "SENT", error: null });

        try {
            await sendEmail(to, body);
        } catch (e) {
            // the mail server rejected it, so it is safe to try again later
            await markStatus(prismaClient, execution.id, { status: "PENDING" });
            throw e;
        }

        await markStatus(prismaClient, execution.id, { status: "CONFIRMED" });
        return;
    }

    if (action.type.id === "send-sol") {
        // A transfer might already be on chain from a previous attempt, even if
        // this worker crashed before it could store the signature.
        const reconciliation = await reconcileSolTransaction(execution.reference);

        if (reconciliation.status === "confirmed") {
            console.log(`Solana transfer already landed with signature ${reconciliation.signature}, not sending again`);
            await markStatus(prismaClient, execution.id, { status: "CONFIRMED", signature: reconciliation.signature });
            return;
        }

        if (reconciliation.status === "pending") {
            throw new Error("A previous solana transaction for this action is still pending");
        }

        const amount = parse((action.metadata as JsonObject)?.amount as string, zapRunMetadata);
        const address = parse((action.metadata as JsonObject)?.address as string, zapRunMetadata);
        console.log(`Sending out SOL of ${amount} to address ${address}`);

        await markStatus(prismaClient, execution.id, { status: "SENT", error: null });

        const signature = await sendSol(address, amount, execution.reference);

        await markStatus(prismaClient, execution.id, { status: "CONFIRMED", signature });
        return;
    }

    console.log(`No handler for action type ${action.type.id}`);
}

async function registerFailure(prismaClient: PrismaClient, zapRunId: string, action: Action, error: unknown) {
    const execution = await prismaClient.actionExecution.findUnique({
        where: {
            zapRunId_actionRowId: {
                zapRunId,
                actionRowId: action.id
            }
        }
    });

    if (!execution) {
        return { retry: false, attempts: 0 };
    }

    const attempts = execution.attempts + 1;
    const retry = attempts < MAX_ATTEMPTS;

    await prismaClient.actionExecution.update({
        where: {
            id: execution.id
        },
        data: {
            attempts,
            error: String(error instanceof Error ? error.message : error).slice(0, 500),
            ...(retry ? {} : { status: "FAILED" })
        }
    })

    return { retry, attempts };
}

// Runs every action of one stage. Actions that already ran are skipped, so this
// can be called again for the same run safely.
export async function runStage(prismaClient: PrismaClient, zapRunId: string, stage: number): Promise<StageResult> {
    const zapRunDetails = await prismaClient.zapRun.findFirst({
        where: {
            id: zapRunId
        },
        include: {
            zap: {
                include: {
                    actions: {
                        include: {
                            type: true
                        }
                    }
                }
            },
        }
    });

    if (!zapRunDetails) {
        return { outcome: "missing", lastStage: 0, attempts: 0 };
    }

    const lastStage = Math.max(0, ...zapRunDetails.zap.actions.map(x => x.sortingOrder));

    // multiple actions can share a stage, they run in parallel
    const currentActions = zapRunDetails.zap.actions.filter(x => x.sortingOrder === stage);

    if (currentActions.length === 0) {
        return { outcome: "no-actions", lastStage, attempts: 0 };
    }

    const zapRunMetadata = zapRunDetails.metadata;

    // every action of a stage runs in parallel, the stage only advances
    // once all of them are done
    const results = await Promise.allSettled(
        currentActions.map(action => executeAction(prismaClient, zapRunId, action as Action, zapRunMetadata))
    );

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") {
            console.error(`Action ${currentActions[i].actionId} failed`, result.reason);
            const failure = await registerFailure(prismaClient, zapRunId, currentActions[i] as Action, result.reason);
            return {
                outcome: failure.retry ? "retry" : "gave_up",
                lastStage,
                attempts: failure.attempts
            };
        }
    }

    return { outcome: "done", lastStage, attempts: 0 };
}
