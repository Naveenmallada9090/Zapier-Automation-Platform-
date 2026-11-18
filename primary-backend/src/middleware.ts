import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_PASSWORD } from "./config";
import { prismaClient } from "./db";

export async function authMiddleware (req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization as unknown as string;

    try {
        const payload = jwt.verify(token, JWT_PASSWORD) as { id: number, tokenVersion?: number };

        const user = await prismaClient.user.findFirst({
            where: {
                id: payload.id
            },
            select: {
                tokenVersion: true
            }
        });

        // a password reset bumps tokenVersion, which makes every token issued
        // before the reset unusable
        if (!user || user.tokenVersion !== (payload.tokenVersion ?? 0)) {
            throw new Error("Stale token");
        }

        // @ts-ignore
        req.id = payload.id
        next();
    } catch(e) {
        return res.status(403).json({
            message: "You are not logged in"
        })
    }
}
