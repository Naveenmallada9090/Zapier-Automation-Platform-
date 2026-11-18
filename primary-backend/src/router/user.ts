
import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware";
import { ForgotPasswordSchema, ResendVerificationSchema, ResetPasswordSchema, SigninSchema, SignupSchema, VerificationRequestSchema } from "../types";
import { prismaClient } from "../db";
import jwt from "jsonwebtoken";
import { FRONTEND_URL, JWT_PASSWORD } from "../config";
import { isMailConfigured, sendMail } from "../lib/mailer";
import { forgotPasswordLimiter, resendVerificationLimiter, resetPasswordLimiter, signinLimiter, signupLimiter, verifyLimiter } from "../lib/rateLimit";

const router = Router();

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const SALT_ROUNDS = 10;

// used so that a login for a missing account takes about as long as a real one
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", SALT_ROUNDS);

export async function hashPassword(password: string) {
    return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string) {
    return bcrypt.compare(password, passwordHash);
}

// When SMTP is not configured there is no way to deliver the mail, so we hand
// the link back to the caller instead of silently doing nothing.
function canExposeLinks() {
    return !isMailConfigured() && process.env.NODE_ENV !== "production";
}

async function sendVerificationEmail(email: string, name: string, token: string) {
    const link = `${FRONTEND_URL}/verify?token=${token}`;

    await sendMail({
        to: email,
        subject: "Verify your email",
        text: `Hi ${name},\n\nPlease verify your email by opening this link:\n${link}\n\nThis link is valid for 24 hours.`,
        html: `<p>Hi ${name},</p><p>Please verify your email by clicking <a href="${link}">this link</a>.</p><p>This link is valid for 24 hours.</p>`
    })

    return link;
}

async function sendPasswordResetEmail(email: string, name: string, token: string) {
    const link = `${FRONTEND_URL}/reset-password?token=${token}`;

    await sendMail({
        to: email,
        subject: "Reset your password",
        text: `Hi ${name},\n\nSomeone asked to reset the password of your account.\nOpen this link to choose a new password:\n${link}\n\nThis link is valid for 1 hour. If this was not you, you can ignore this email.`,
        html: `<p>Hi ${name},</p><p>Someone asked to reset the password of your account.</p><p><a href="${link}">Choose a new password</a></p><p>This link is valid for 1 hour. If this was not you, you can ignore this email.</p>`
    })

    return link;
}

router.post("/signup", signupLimiter, async (req, res) => {
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
    const passwordHash = await hashPassword(parsedData.data.password);

    await prismaClient.user.create({
        data: {
            email: parsedData.data.username,
            passwordHash,
            name: parsedData.data.name,
            verified: false,
            verificationToken,
            verificationExpiresAt
        }
    })

    let verificationLink: string | undefined;

    try {
        verificationLink = await sendVerificationEmail(parsedData.data.username, parsedData.data.name, verificationToken);
    } catch (e) {
        // the user is created either way, they can ask for another email
        console.error("Could not send verification email", e);
    }

    return res.json({
        message: "Please verify your account by checking your email",
        verificationLink: canExposeLinks() ? verificationLink : undefined
    });

})

router.post("/verify", verifyLimiter, async (req, res) => {
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

router.post("/resend-verification", resendVerificationLimiter, async (req, res) => {
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

    let verificationLink: string | undefined;

    try {
        verificationLink = await sendVerificationEmail(user.email, user.name, verificationToken);
    } catch (e) {
        console.error("Could not send verification email", e);
    }

    return res.json({
        message: "If the account exists, a new verification email has been sent",
        verificationLink: canExposeLinks() ? verificationLink : undefined
    })
})

router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
    const parsedData = ForgotPasswordSchema.safeParse(req.body);

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

    let resetLink: string | undefined;

    if (user) {
        // only the newest link should work
        await prismaClient.passwordResetToken.updateMany({
            where: {
                userId: user.id,
                usedAt: null
            },
            data: {
                usedAt: new Date()
            }
        })

        const token = crypto.randomUUID();

        await prismaClient.passwordResetToken.create({
            data: {
                token,
                userId: user.id,
                expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS)
            }
        })

        try {
            resetLink = await sendPasswordResetEmail(user.email, user.name, token);
        } catch (e) {
            console.error("Could not send password reset email", e);
        }
    }

    // do not leak whether the account exists
    return res.json({
        message: "If the account exists, a password reset email has been sent",
        resetLink: canExposeLinks() ? resetLink : undefined
    })
})

router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
    const parsedData = ResetPasswordSchema.safeParse(req.body);

    if (!parsedData.success) {
        return res.status(411).json({
            message: "Incorrect inputs"
        })
    }

    const resetToken = await prismaClient.passwordResetToken.findFirst({
        where: {
            token: parsedData.data.token
        }
    });

    if (!resetToken || resetToken.usedAt) {
        return res.status(400).json({
            message: "This password reset link is invalid or has already been used"
        })
    }

    if (resetToken.expiresAt.getTime() < Date.now()) {
        return res.status(400).json({
            message: "This password reset link has expired, please request a new one"
        })
    }

    const passwordHash = await hashPassword(parsedData.data.password);

    await prismaClient.$transaction([
        prismaClient.user.update({
            where: {
                id: resetToken.userId
            },
            data: {
                passwordHash
            }
        }),
        prismaClient.passwordResetToken.update({
            where: {
                id: resetToken.id
            },
            data: {
                usedAt: new Date()
            }
        })
    ])

    return res.json({
        message: "Your password has been updated, you can login now"
    })
})

router.post("/signin", signinLimiter, async (req, res) => {
    const body = req.body;
    const parsedData = SigninSchema.safeParse(body);

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

    const passwordMatches = await verifyPassword(
        parsedData.data.password,
        user?.passwordHash ?? DUMMY_HASH
    );

    if (!user || !passwordMatches) {
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
