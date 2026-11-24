import nodemailer from "nodemailer";

// SOL_PRIVATE_KEY=""
// SMTP_USERNAME=""
// SMTP_PASSWORD=""
// SMTP_ENDPOINT

const brevoApiKey = process.env.BREVO_API_KEY;
const from = process.env.SMTP_FROM || "contact@100xdevs.com";

// Some hosts (render's free tier for example) block outbound smtp ports. When a
// brevo api key is configured we send over https instead, which always works.
// Plain smtp is still used locally.
const transport = brevoApiKey ? null : nodemailer.createTransport({
    host: process.env.SMTP_ENDPOINT,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false, // upgrade later with STARTTLS
    auth: {
      user: process.env.SMTP_USERNAME,
      pass: process.env.SMTP_PASSWORD,
    },
  });

export async function sendEmail(to: string, body: string) {
    if (brevoApiKey) {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "api-key": brevoApiKey,
                "content-type": "application/json",
                accept: "application/json"
            },
            body: JSON.stringify({
                sender: { email: from },
                to: [{ email: to }],
                subject: "Hello from Zapier",
                textContent: body
            })
        });

        if (!response.ok) {
            throw new Error(`brevo api ${response.status}: ${await response.text()}`);
        }

        return;
    }

    if (!transport) {
        throw new Error("no mail transport configured (set BREVO_API_KEY or SMTP_ENDPOINT)");
    }

    await transport.sendMail({
        from,
        sender: from,
        to,
        subject: "Hello from Zapier",
        text: body
    })
}
