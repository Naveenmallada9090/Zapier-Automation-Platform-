import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prismaClient = new PrismaClient();

// Before this change the password column held plaintext. The migration renames
// the column, this script replaces every value that is not a bcrypt hash with a
// hash of itself so that people can keep using the password they signed up with.
async function main() {
    const users = await prismaClient.user.findMany({
        select: {
            id: true,
            email: true,
            passwordHash: true
        }
    });

    let hashed = 0;

    for (const user of users) {
        if (user.passwordHash.startsWith("$2")) {
            continue;
        }

        await prismaClient.user.update({
            where: {
                id: user.id
            },
            data: {
                passwordHash: await bcrypt.hash(user.passwordHash, 10)
            }
        });

        hashed++;
        console.log(`Hashed the password of ${user.email}`);
    }

    console.log(`Done, hashed ${hashed} of ${users.length} passwords`);
}

main()
    .catch(e => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prismaClient.$disconnect();
    });
