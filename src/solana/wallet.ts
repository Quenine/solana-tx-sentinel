import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Keypair } from "@solana/web3.js";

import { getEnv } from "../config/env.js";

export function getWalletKeypairPath(): string {
  return resolve(getEnv().WALLET_KEYPAIR_PATH);
}

export function loadWalletKeypair(): Keypair {
  const keypairPath = getWalletKeypairPath();

  if (!existsSync(keypairPath)) {
    throw new Error(
      `Wallet keypair file not found at ${keypairPath}. Create one with: solana-keygen new --outfile ${keypairPath}`
    );
  }

  const file = readFileSync(keypairPath, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(file) as number[]);

  return Keypair.fromSecretKey(secretKey);
}
