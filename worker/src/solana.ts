
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, PublicKey, sendAndConfirmTransaction, Connection } from "@solana/web3.js";
import base58 from "bs58";

const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "finalized");

const dryRun = process.env.SOLANA_DRY_RUN === "true";

// A reference is a throwaway public key that is embedded in the transaction as a
// read only account. It is unique per (zap run, action), which means that after a
// crash we can ask the blockchain "was this action already submitted?" and never
// send the same money twice.
export function generateReference() {
    return Keypair.generate().publicKey.toBase58();
}

export async function sendSol(to: string, amount: string, reference: string) {
    if (dryRun) {
        console.log(`[dry run] would send ${amount} SOL to ${to} with reference ${reference}`);
        return `dry-run:${reference}`;
    }

    const secretKey = process.env.SOL_PRIVATE_KEY ?? "";
    if (!secretKey) {
        throw new Error("SOL_PRIVATE_KEY is not set");
    }

    const keypair = Keypair.fromSecretKey(base58.decode(secretKey));
    console.log(keypair.publicKey);

    const transferInstruction = SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(to),
        lamports: parseFloat(amount) * LAMPORTS_PER_SOL, // 0.1 => 10 ^ 8
    });

    // the reference account makes the transaction searchable after a restart
    transferInstruction.keys.push({
        pubkey: new PublicKey(reference),
        isSigner: false,
        isWritable: false,
    });

    const transferTransaction = new Transaction().add(transferInstruction);

    const signature = await sendAndConfirmTransaction(connection, transferTransaction, [keypair]);
    console.log("sol Sent!", signature);

    return signature;
}

export type Reconciliation =
    | { status: "confirmed"; signature: string }
    | { status: "pending" }
    | { status: "none" };

// Looks up the chain for a transaction that used this reference.
// - confirmed: the money already moved, never send again
// - pending: a transaction exists but is not confirmed yet, wait and retry
// - none: nothing landed, it is safe to send
export async function reconcileSolTransaction(reference: string): Promise<Reconciliation> {
    if (dryRun) {
        return { status: "none" };
    }

    const signatures = await connection.getSignaturesForAddress(new PublicKey(reference), { limit: 10 });

    const successful = signatures.filter(x => !x.err);

    for (const x of successful) {
        if (x.confirmationStatus === "confirmed" || x.confirmationStatus === "finalized") {
            return { status: "confirmed", signature: x.signature };
        }
    }

    if (successful.length > 0) {
        return { status: "pending" };
    }

    return { status: "none" };
}
