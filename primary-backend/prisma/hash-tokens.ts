import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prismaClient = new PrismaClient();

// Verification and reset tokens used to be stored in plaintext. Only the sha256
// of a token is stored now, so the links that are already sitting in someone's
// inbox have to be converted too, otherwise they would stop working.
function hashToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

// raw tokens are uuids (36 characters), a sha256 hex digest is 64
const RAW_TOKEN_LENGTH = 36;

async function main() {
    const users = await prismaClient.user.findMany({
        where: {
            verificationToken: {
                not: null
            }
        },
        select: {
            id: true,
            email: true,
            verificationToken: true
        }
    });

    let verificationTokens = 0;

    for (const user of users) {
        const token = user.verificationToken as string;

        if (token.length !== RAW_TOKEN_LENGTH) {
            continue;
        }

        await prismaClient.user.update({
            where: {
                id: user.id
            },
            data: {
                verificationToken: hashToken(token)
            }
        });

        verificationTokens++;
        console.log(`Hashed the verification token of ${user.email}`);
    }

    const resetTokens = await prismaClient.passwordResetToken.findMany({
        select: {
            id: true,
            token: true
        }
    });

    let resetTokensHashed = 0;

    for (const resetToken of resetTokens) {
        if (resetToken.token.length !== RAW_TOKEN_LENGTH) {
            continue;
        }

        await prismaClient.passwordResetToken.update({
            where: {
                id: resetToken.id
            },
            data: {
                token: hashToken(resetToken.token)
            }
        });

        resetTokensHashed++;
    }

    console.log(`Done, hashed ${verificationTokens} verification tokens and ${resetTokensHashed} of ${resetTokens.length} reset tokens`);
}

main()
    .catch(e => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prismaClient.$disconnect();
    });
