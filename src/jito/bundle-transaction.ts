import type { SerializedTransactionPreview } from "../types/transaction.js";
import type { BundleLayout } from "../config/env.js";

export type BundleTransaction = {
  signature: string;
  role: "workload" | "tip" | "combined";
  feePayer: string;
  blockhash: string;
  lastValidBlockHeight: number;
  serializedTransaction: SerializedTransactionPreview;
};

export type BundlePreview = {
  bundleLayout: BundleLayout;
  signature: string;
  workloadTransactionSignature: string;
  tipTransactionSignature: string | null;
  transactionSignatures: string[];
  feePayer: string;
  selfTransferRecipient: string;
  selfTransferLamports: number;
  tipAccount: string;
  tipLamports: number;
  priorityFeeMicroLamports: number;
  computeUnitLimit: number;
  blockhash: string;
  lastValidBlockHeight: number;
  serializedTransaction: SerializedTransactionPreview;
  serializedTransactions: SerializedTransactionPreview[];
  serializedTransactionByteLengths: number[];
  bundleTransactionCount: number;
  transactions: BundleTransaction[];
};
