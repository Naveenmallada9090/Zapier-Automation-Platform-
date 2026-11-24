import { PrismaClient } from "@prisma/client";
import { Kafka } from "kafkajs";
const TOPIC_NAME = "zap-events";
const client = new PrismaClient();
const kafkaSasl = process.env.KAFKA_SASL_USERNAME ? {
    mechanism: "plain",
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD || ""
} : undefined;
const kafka = new Kafka({
    clientId: 'outbox-processor',
    brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
    ssl: process.env.KAFKA_SSL === "true" || !!process.env.KAFKA_SASL_USERNAME,
    ...(kafkaSasl ? { sasl: kafkaSasl } : {})
});
async function main() {
    const producer = kafka.producer();
    await producer.connect();
    while (1) {
        const pendingRows = await client.zapRunOutbox.findMany({
            where: {},
            take: 10
        });
        console.log(pendingRows);
        producer.send({
            topic: TOPIC_NAME,
            messages: pendingRows.map(r => {
                return {
                    value: JSON.stringify({ zapRunId: r.zapRunId, stage: 0 })
                };
            })
        });
        await client.zapRunOutbox.deleteMany({
            where: {
                id: {
                    in: pendingRows.map(x => x.id)
                }
            }
        });
        await new Promise(r => setTimeout(r, 3000));
    }
}
main();
//# sourceMappingURL=index.js.map