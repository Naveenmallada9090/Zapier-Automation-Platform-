require('dotenv').config()

import { PrismaClient } from "@prisma/client";
import { JsonObject } from "@prisma/client/runtime/library";
import { Kafka } from "kafkajs";
import { parse } from "./parser";
import { sendEmail } from "./email";
import { generateReference, reconcileSolTransaction, sendSol } from "./solana";

const prismaClient = new PrismaClient();
const TOPIC_NAME = "zap-events"
const MAX_ATTEMPTS = 5;

const kafka = new Kafka({
    clientId: 'outbox-processor-2',
    brokers: ['localhost:9092']
})

type Action = {
    id: string;
    actionId: string;
    metadata: any;
    sortingOrder: number;
    type: {
        id: string;
    }
};

// Every (zap run, action) pair gets exactly one execution row. The reference is
// stored on it so that a restarted worker can check the blockchain instead of
// blindly sending the same transfer again.
async function getExecution(zapRunId: string, action: Action) {
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

async function markStatus(id: string, data: {
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

async function executeAction(zapRunId: string, action: Action, zapRunMetadata: any) {
    const execution = await getExecution(zapRunId, action);

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

        await markStatus(execution.id, { status: "SENT", error: null });

        try {
            await sendEmail(to, body);
        } catch (e) {
            // the mail server rejected it, so it is safe to try again later
            await markStatus(execution.id, { status: "PENDING" });
            throw e;
        }

        await markStatus(execution.id, { status: "CONFIRMED" });
        return;
    }

    if (action.type.id === "send-sol") {
        // A transfer might already be on chain from a previous attempt, even if
        // this worker crashed before it could store the signature.
        const reconciliation = await reconcileSolTransaction(execution.reference);

        if (reconciliation.status === "confirmed") {
            console.log(`Solana transfer already landed with signature ${reconciliation.signature}, not sending again`);
            await markStatus(execution.id, { status: "CONFIRMED", signature: reconciliation.signature });
            return;
        }

        if (reconciliation.status === "pending") {
            throw new Error("A previous solana transaction for this action is still pending");
        }

        const amount = parse((action.metadata as JsonObject)?.amount as string, zapRunMetadata);
        const address = parse((action.metadata as JsonObject)?.address as string, zapRunMetadata);
        console.log(`Sending out SOL of ${amount} to address ${address}`);

        await markStatus(execution.id, { status: "SENT", error: null });

        const signature = await sendSol(address, amount, execution.reference);

        await markStatus(execution.id, { status: "CONFIRMED", signature });
        return;
    }

    console.log(`No handler for action type ${action.type.id}`);
}

async function registerFailure(zapRunId: string, action: Action, error: unknown) {
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

async function main() {
    const consumer = kafka.consumer({ groupId: 'main-worker-2' });
    await consumer.connect();
    const producer =  kafka.producer();
    await producer.connect();

    await consumer.subscribe({ topic: TOPIC_NAME, fromBeginning: true })

    await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
          console.log({
            partition,
            offset: message.offset,
            value: message.value?.toString(),
          })
          if (!message.value?.toString()) {
            return;
          }

          const parsedValue = JSON.parse(message.value?.toString());
          const zapRunId = parsedValue.zapRunId;
          const stage = parsedValue.stage;

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
            console.log("Zap run not found?");
            return;
          }

          // multiple actions can share a stage, they run in parallel
          const currentActions = zapRunDetails.zap.actions.filter(x => x.sortingOrder === stage);

          if (currentActions.length === 0) {
            console.log("No actions at this stage");
            await consumer.commitOffsets([{
              topic: TOPIC_NAME,
              partition: partition,
              offset: (parseInt(message.offset) + 1).toString()
            }])
            return;
          }

          const zapRunMetadata = zapRunDetails.metadata;

          let failure: null | { retry: boolean, attempts: number } = null;

          for (const action of currentActions) {
            try {
              await executeAction(zapRunId, action as Action, zapRunMetadata);
            } catch (e) {
              console.error(`Action ${action.actionId} failed`, e);
              failure = await registerFailure(zapRunId, action as Action, e);
              break;
            }
          }

          if (failure) {
            if (failure.retry) {
              console.log("pushing the stage back to the queue for a retry");
              // back off a little, a solana transfer that is still pending needs time
              await new Promise(r => setTimeout(r, Math.min(failure.attempts, 5) * 1000));
              await producer.send({
                topic: TOPIC_NAME,
                messages: [{
                  value: JSON.stringify({
                    stage,
                    zapRunId
                  })
                }]
              })
            } else {
              console.log("giving up on this stage, the action failed too many times");
            }

            await consumer.commitOffsets([{
              topic: TOPIC_NAME,
              partition: partition,
              offset: (parseInt(message.offset) + 1).toString()
            }])
            return;
          }

          await new Promise(r => setTimeout(r, 500));

          const lastStage = Math.max(...zapRunDetails.zap.actions.map(x => x.sortingOrder));
          console.log(lastStage);
          console.log(stage);
          if (lastStage > stage) {
            console.log("pushing back to the queue")
            await producer.send({
              topic: TOPIC_NAME,
              messages: [{
                value: JSON.stringify({
                  stage: stage + 1,
                  zapRunId
                })
              }]
            })
          }

          console.log("processing done");
          await consumer.commitOffsets([{
            topic: TOPIC_NAME,
            partition: partition,
            offset: (parseInt(message.offset) + 1).toString() // 5
          }])
        },
      })

}

main()
