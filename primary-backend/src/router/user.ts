
import { Router } from "express";
import crypto from "crypto";
import { authMiddleware } from "../middleware";
import { ResendVerificationSchema, SigninSchema, SignupSchema, VerificationRequestSchema } from "../types";
import { prismaClient } from "../db";
import jwt from "jsonwebtoken";
import { FRONTEND_URL, JWT_PASSWORD } from "../config";
import { sendMail } from "../lib/mailer";

const router = Router();

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

async function sendVerificationEmail(email: string, name: string, token: string) {
    const link = `${FRONTEND_URL}/verify?token=${token}`;

    await sendMail({
        to: email,
        subject: "Verify your email",
        text: `Hi ${name},\n\nPlease verify your email by opening this link:\n${link}\n\nThis link is valid for 24 hours.`,
        html: `<p>Hi ${name},</p><p>Please verify your email by clicking <a href="${link}">this link</a>.</p><p>This link is valid for 24 hours.</p>`
    })
}

router.post("/signup", async (req, res) => {
    const body = req.body;
    const parsedData = SignupSchema.safeParse(body);

    if (!parsedData.success) {
        console.log(parsedData.error);
        return res.status(411).json({
            message: "Incorrect inputs"
        })
    }

    const userExists = await prismaClient.user.findFirst({
        where: {
            email: parsedData.data.username
        }
    });

    if (userExists) {
        return res.status(403).json({
            message: "User already exists"
        })
    }

    const verificationToken = crypto.randomUUID();
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    await prismaClient.user.create({
        data: {
            email: parsedData.data.username,
            // TODO: Dont store passwords in plaintext, hash it
            password: parsedData.data.password,
            name: parsedData.data.name,
            verified: false,
            verificationToken,
            verificationExpiresAt
        }
    })

    try {
        await sendVerificationEmail(parsedData.data.username, parsedData.data.name, verificationToken);
    } catch (e) {
        // the user is created either way, they can ask for another email
        console.error("Could not send verification email", e);
    }

    return res.json({
        message: "Please verify your account by checking your email"
    });

})

router.post("/verify", async (req, res) => {
    const parsedData = VerificationRequestSchema.safeParse(req.body);

    if (!parsedData.success) {
        return res.status(411).json({
            message: "Incorrect inputs"
        })
    }

    const user = await prismaClient.user.findFirst({
        where: {
            verificationToken: parsedData.data.token
        }
    });

    if (!user) {
        return res.status(400).json({
            message: "This verification link is invalid or has already been used"
        })
    }

    if (user.verificationExpiresAt && user.verificationExpiresAt.getTime() < Date.now()) {
        return res.status(400).json({
            message: "This verification link has expired, please request a new one"
        })
    }

    await prismaClient.user.update({
        where: {
            id: user.id
        },
        data: {
            verified: true,
            verificationToken: null,
            verificationExpiresAt: null
        }
    })

    return res.json({
        message: "Your email has been verified, you can login now"
    })
})

router.post("/resend-verification", async (req, res) => {
    const parsedData = ResendVerificationSchema.safeParse({
        username: req.body?.username
    });

    if (!parsedData.success) {
        return res.status(411).json({
            message: "Incorrect inputs"
        })
    }

    const user = await prismaClient.user.findFirst({
        where: {
            email: parsedData.data.username
        }
    });

    // do not leak whether the account exists
    if (!user || user.verified) {
        return res.json({
            message: "If the account exists, a new verification email has been sent"
        })
    }

    const verificationToken = crypto.randomUUID();
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    await prismaClient.user.update({
        where: {
            id: user.id
        },
        data: {
            verificationToken,
            verificationExpiresAt
        }
    })

    try {
        await sendVerificationEmail(user.email, user.name, verificationToken);
    } catch (e) {
        console.error("Could not send verification email", e);
    }

    return res.json({
        message: "If the account exists, a new verification email has been sent"
    })
})

router.post("/signin", async (req, res) => {
    const body = req.body;
    const parsedData = SigninSchema.safeParse(body);

    if (!parsedData.success) {
        return res.status(411).json({
            message: "Incorrect inputs"
        })
    }

    const user = await prismaClient.user.findFirst({
        where: {
            email: parsedData.data.username,
            password: parsedData.data.password
        }
    });
    
    if (!user) {
        return res.status(403).json({
            message: "Sorry credentials are incorrect"
        })
    }

    if (!user.verified) {
        return res.status(403).json({
            message: "Please verify your email before signing in"
        })
    }

    // sign the jwt
    const token = jwt.sign({
        id: user.id
    }, JWT_PASSWORD);

    res.json({
        token: token,
    });
})

router.get("/", authMiddleware, async (req, res) => {
    // TODO: Fix the type
    // @ts-ignore
    const id = req.id;
    const user = await prismaClient.user.findFirst({
        where: {
            id
        },
        select: {
            name: true,
            email: true
        }
    });

    return res.json({
        user
    });
})

export const userRouter = router;
