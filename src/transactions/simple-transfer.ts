import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { defaultCommitment } from "../types/solana.js";

export type SimpleSelfTransfer = {
  transaction: Transaction;
  serializedTransaction: Buffer;
  feePayer: string;
  recipient: string;
  lamports: number;
  blockhash: string;
  lastValidBlockHeight: number;
};

export async function buildSimpleSelfTransfer(
  connection: Connection,
  wallet: Keypair,
  lamports = 1
): Promise<SimpleSelfTransfer> {
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

  return {
    transaction,
    serializedTransaction: transaction.serialize(),
    feePayer: wallet.publicKey.toBase58(),
    recipient: wallet.publicKey.toBase58(),
    lamports,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  };
}
