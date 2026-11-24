require('dotenv').config()

import { PrismaClient } from "@prisma/client";
import { Kafka } from "kafkajs";
import { runStage } from "./execution";

const prismaClient = new PrismaClient();
const TOPIC_NAME = "zap-events"

const kafkaSasl = process.env.KAFKA_SASL_USERNAME ? {
    mechanism: "plain" as const,
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD || ""
} : undefined;

const kafka = new Kafka({
    clientId: 'outbox-processor-2',
    brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
    ssl: process.env.KAFKA_SSL === "true" || !!process.env.KAFKA_SASL_USERNAME,
    ...(kafkaSasl ? { sasl: kafkaSasl } : {})
})

async function main() {
    const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID || 'main-worker-2' });
    await consumer.connect();
    const producer = kafka.producer();
    await producer.connect();

    await consumer.subscribe({ topic: TOPIC_NAME, fromBeginning: true })

    await consumer.run({
        autoCommit: false,
        eachMessage: async ({ partition, message }) => {
            console.log({
                partition,
                offset: message.offset,
                value: message.value?.toString(),
            })

            const commit = () => consumer.commitOffsets([{
                topic: TOPIC_NAME,
                partition: partition,
                offset: (parseInt(message.offset) + 1).toString()
            }])

            if (!message.value?.toString()) {
                return;
            }

            const parsedValue = (() => {
                try {
                    return JSON.parse(message.value?.toString() as string);
                } catch (e) {
                    return null;
                }
            })();

            if (!parsedValue) {
                // a message that can not be parsed should not take the whole worker down
                console.error("Skipping a message that is not valid json", message.value?.toString());
                await commit();
                return;
            }

            const zapRunId = parsedValue.zapRunId;
            const stage = parsedValue.stage;

            const result = await runStage(prismaClient, zapRunId, stage);

            if (result.outcome === "missing") {
                console.log("Zap run not found?");
                return;
            }

            if (result.outcome === "no-actions") {
                console.log("No actions at this stage");
                await commit();
                return;
            }

            if (result.outcome === "retry") {
                console.log("pushing the stage back to the queue for a retry");
                // back off a little, a solana transfer that is still pending needs time
                await new Promise(r => setTimeout(r, Math.min(result.attempts, 5) * 1000));
                await producer.send({
                    topic: TOPIC_NAME,
                    messages: [{
                        value: JSON.stringify({
                            stage,
                            zapRunId
                        })
                    }]
                })
                await commit();
                return;
            }

            if (result.outcome === "gave_up") {
                console.log("giving up on this stage, the action failed too many times");
                await commit();
                return;
            }

            await new Promise(r => setTimeout(r, 500));

            console.log(result.lastStage);
            console.log(stage);
            if (result.lastStage > stage) {
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
            await commit();
        },
    })

}

main()
