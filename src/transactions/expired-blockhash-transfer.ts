import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { classifyFailure } from "../failures/classifier.js";
import type { ClassifiedFailure } from "../failures/types.js";
import { defaultCommitment } from "../types/solana.js";

export type ExpiredBlockhashTransferResult = {
  feePayer: string;
  recipient: string;
  lamports: number;
  originalBlockhash: string;
  originalLastValidBlockHeight: number;
  currentBlockHeightAtSend: number;
  attemptedAtMs: number;
  failure: ClassifiedFailure;
};

export type ExpiredBlockhashTransferOptions = {
  lamports?: number;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  onProgress?: (status: {
    currentBlockHeight: number;
    lastValidBlockHeight: number;
    remainingBlocks: number;
  }) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBlockhashExpiry(
  connection: Connection,
  lastValidBlockHeight: number,
  options: Required<Pick<ExpiredBlockhashTransferOptions, "maxWaitMs" | "pollIntervalMs">> &
    Pick<ExpiredBlockhashTransferOptions, "onProgress">
): Promise<number> {
  const startedAt = Date.now();
  let lastProgressAt = 0;

  while (Date.now() - startedAt < options.maxWaitMs) {
    const currentBlockHeight = await connection.getBlockHeight(defaultCommitment);

    if (currentBlockHeight > lastValidBlockHeight) {
      return currentBlockHeight;
    }

    const now = Date.now();

    if (options.onProgress && now - lastProgressAt >= 10_000) {
      options.onProgress({
        currentBlockHeight,
        lastValidBlockHeight,
        remainingBlocks: lastValidBlockHeight - currentBlockHeight + 1
      });
      lastProgressAt = now;
    }

    await sleep(options.pollIntervalMs);
  }

  throw new Error(`Timed out waiting for blockhash expiry at block height ${lastValidBlockHeight}`);
}

export async function injectExpiredBlockhashTransfer(
  connection: Connection,
  wallet: Keypair,
  options: ExpiredBlockhashTransferOptions = {}
): Promise<ExpiredBlockhashTransferResult> {
  const lamports = options.lamports ?? 1;

  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error("Transfer amount must be a positive integer number of lamports.");
  }

  const latestBlockhash = await connection.getLatestBlockhash(defaultCommitment);
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    recentBlockhash: latestBlockhash.blockhash
  }).add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports
    })
  );

  transaction.sign(wallet);

  const waitOptions: Required<Pick<ExpiredBlockhashTransferOptions, "maxWaitMs" | "pollIntervalMs">> &
    Pick<ExpiredBlockhashTransferOptions, "onProgress"> = {
    maxWaitMs: options.maxWaitMs ?? 120_000,
    pollIntervalMs: options.pollIntervalMs ?? 2_000
  };

  if (options.onProgress) {
    waitOptions.onProgress = options.onProgress;
  }

  const currentBlockHeightAtSend = await waitForBlockhashExpiry(
    connection,
    latestBlockhash.lastValidBlockHeight,
    waitOptions
  );

  try {
    await connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: 0,
      preflightCommitment: defaultCommitment,
      skipPreflight: false
    });
  } catch (error) {
    return {
      feePayer: wallet.publicKey.toBase58(),
      recipient: wallet.publicKey.toBase58(),
      lamports,
      originalBlockhash: latestBlockhash.blockhash,
      originalLastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      currentBlockHeightAtSend,
      attemptedAtMs: Date.now(),
      failure: classifyFailure(error)
    };
  }

  throw new Error("Expired blockhash transaction unexpectedly submitted without an error.");
}
