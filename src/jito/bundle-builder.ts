import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

import type { BundleLayout } from "../config/env.js";
import type { BundlePreview, BundleTransaction } from "./bundle-transaction.js";
import { defaultCommitment } from "../types/solana.js";

export type BuildBundlePreviewInput = {
  connection: Connection;
  wallet: Keypair;
  tipAccount: string;
  tipLamports: number;
  priorityFeeMicroLamports: number;
  computeUnitLimit: number;
  bundleLayout: BundleLayout;
  selfTransferLamports?: number;
};

function toSerializedPreview(serialized: Buffer): BundlePreview["serializedTransaction"] {
  const base64 = serialized.toString("base64");

  return {
    base64,
    byteLength: serialized.byteLength,
    base64Prefix: base64.slice(0, 32)
  };
}

function signatureFor(transaction: Transaction, label: string): string {
  const signatureBytes = transaction.signatures[0]?.signature;

  if (!signatureBytes) {
    throw new Error(`Failed to sign ${label} transaction.`);
  }

  return bs58.encode(signatureBytes);
}

function toBundleTransaction(input: {
  transaction: Transaction;
  role: BundleTransaction["role"];
  feePayer: string;
  blockhash: string;
  lastValidBlockHeight: number;
}): BundleTransaction {
  return {
    signature: signatureFor(input.transaction, input.role),
    role: input.role,
    feePayer: input.feePayer,
    blockhash: input.blockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
    serializedTransaction: toSerializedPreview(input.transaction.serialize())
  };
}

export async function buildJitoBundlePreview(input: BuildBundlePreviewInput): Promise<BundlePreview> {
  const selfTransferLamports = input.selfTransferLamports ?? 1;

  if (!Number.isSafeInteger(selfTransferLamports) || selfTransferLamports <= 0) {
    throw new Error("Self-transfer amount must be a positive integer number of lamports.");
  }

  if (!Number.isSafeInteger(input.tipLamports) || input.tipLamports <= 0) {
    throw new Error("Tip amount must be a positive integer number of lamports.");
  }

  if (!Number.isSafeInteger(input.priorityFeeMicroLamports) || input.priorityFeeMicroLamports < 0) {
    throw new Error("Priority fee must be a non-negative integer number of micro-lamports.");
  }

  if (!Number.isSafeInteger(input.computeUnitLimit) || input.computeUnitLimit <= 0) {
    throw new Error("Compute unit limit must be a positive integer.");
  }

  const tipAccount = new PublicKey(input.tipAccount);
  const latestBlockhash = await input.connection.getLatestBlockhash(defaultCommitment);
  const feePayer = input.wallet.publicKey.toBase58();
  const selfTransferRecipient = input.wallet.publicKey.toBase58();
  const buildBaseTransaction = () =>
    new Transaction({
      feePayer: input.wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash
    }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: input.computeUnitLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: input.priorityFeeMicroLamports })
    );
  const workloadInstruction = SystemProgram.transfer({
    fromPubkey: input.wallet.publicKey,
    toPubkey: input.wallet.publicKey,
    lamports: selfTransferLamports
  });
  const tipInstruction = SystemProgram.transfer({
    fromPubkey: input.wallet.publicKey,
    toPubkey: tipAccount,
    lamports: input.tipLamports
  });
  const transactions: BundleTransaction[] = [];

  if (input.bundleLayout === "combined_tip_instruction") {
    const transaction = buildBaseTransaction().add(workloadInstruction, tipInstruction);

    transaction.sign(input.wallet);
    transactions.push(
      toBundleTransaction({
        transaction,
        role: "combined",
        feePayer,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      })
    );
  } else {
    const workloadTransaction = buildBaseTransaction().add(workloadInstruction);
    const tipTransaction = buildBaseTransaction().add(tipInstruction);

    workloadTransaction.sign(input.wallet);
    tipTransaction.sign(input.wallet);
    transactions.push(
      toBundleTransaction({
        transaction: workloadTransaction,
        role: "workload",
        feePayer,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }),
      toBundleTransaction({
        transaction: tipTransaction,
        role: "tip",
        feePayer,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      })
    );
  }

  const workloadTransaction = transactions[0];
  const tipTransaction = transactions.find((transaction) => transaction.role === "tip") ?? null;

  if (!workloadTransaction) {
    throw new Error("Failed to build bundle transactions.");
  }

  return {
    bundleLayout: input.bundleLayout,
    signature: workloadTransaction.signature,
    workloadTransactionSignature: workloadTransaction.signature,
    tipTransactionSignature: tipTransaction?.signature ?? null,
    transactionSignatures: transactions.map((transaction) => transaction.signature),
    feePayer,
    selfTransferRecipient,
    selfTransferLamports,
    tipAccount: tipAccount.toBase58(),
    tipLamports: input.tipLamports,
    priorityFeeMicroLamports: input.priorityFeeMicroLamports,
    computeUnitLimit: input.computeUnitLimit,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    serializedTransaction: workloadTransaction.serializedTransaction,
    serializedTransactions: transactions.map((transaction) => transaction.serializedTransaction),
    serializedTransactionByteLengths: transactions.map((transaction) => transaction.serializedTransaction.byteLength),
    bundleTransactionCount: transactions.length,
    transactions
  };
}
