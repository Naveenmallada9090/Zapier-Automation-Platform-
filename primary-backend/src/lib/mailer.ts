import nodemailer from "nodemailer";

// SMTP is optional. When it is not configured we print the email to the console
// and the API returns the link to the caller so that flows like email
// verification still work in local development.
//
// Render's free tier blocks outbound smtp ports, so when BREVO_API_KEY is set we
// send through brevo's https api instead of smtp.
const brevoApiKey = process.env.BREVO_API_KEY;
const smtpConfigured = Boolean(process.env.SMTP_ENDPOINT && process.env.SMTP_USERNAME);

const transport = !brevoApiKey && smtpConfigured
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
    return Boolean(brevoApiKey) || smtpConfigured;
}

export async function sendMail({ to, subject, text, html }: {
    to: string;
    subject: string;
    text: string;
    html?: string;
}) {
    if (brevoApiKey) {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "api-key": brevoApiKey,
                "content-type": "application/json",
                accept: "application/json"
            },
            body: JSON.stringify({
                sender: { email: process.env.SMTP_FROM || "contact@100xdevs.com" },
                to: [{ email: to }],
                subject,
                textContent: text,
                htmlContent: html
            })
        });

        if (!response.ok) {
            throw new Error(`brevo api ${response.status}: ${await response.text()}`);
        }

        return;
    }

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
