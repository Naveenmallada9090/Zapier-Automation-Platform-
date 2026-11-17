import nodemailer from "nodemailer";

// SMTP is optional. When it is not configured we print the email to the console
// and the API returns the link to the caller so that flows like email
// verification still work in local development.
const smtpConfigured = Boolean(process.env.SMTP_ENDPOINT && process.env.SMTP_USERNAME);

const transport = smtpConfigured
    ? nodemailer.createTransport({
        host: process.env.SMTP_ENDPOINT,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
            user: process.env.SMTP_USERNAME,
            pass: process.env.SMTP_PASSWORD,
        },
    })
    : null;

export function isMailConfigured() {
    return smtpConfigured;
}

export async function sendMail({ to, subject, text, html }: {
    to: string;
    subject: string;
    text: string;
    html?: string;
}) {
    if (!transport) {
        console.log("\n================= EMAIL =================");
        console.log(`To      : ${to}`);
        console.log(`Subject : ${subject}`);
        console.log("");
        console.log(text);
        console.log("=========================================\n");
        return;
    }

    await transport.sendMail({
        from: process.env.SMTP_FROM || "contact@100xdevs.com",
        sender: process.env.SMTP_FROM || "contact@100xdevs.com",
        to,
        subject,
        text,
        html,
    });
}
