import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Keypair } from "@solana/web3.js";

import { getEnv } from "../config/env.js";
import { getWalletKeypairPath } from "../solana/wallet.js";

function hasForceFlag(args: string[]): boolean {
  return args.includes("--force");
}

function main(): void {
  const env = getEnv();
  const keypairPath = getWalletKeypairPath();
  const force = hasForceFlag(process.argv.slice(2));

  if (existsSync(keypairPath) && !force) {
    throw new Error(`Wallet keypair already exists at ${keypairPath}. Re-run with --force to overwrite it.`);
  }

  mkdirSync(dirname(keypairPath), { recursive: true });

  const keypair = Keypair.generate();
  const secretKey = Array.from(keypair.secretKey);

  writeFileSync(keypairPath, `${JSON.stringify(secretKey)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  console.warn(`Created a local test wallet for ${env.NETWORK}. Do not use this wallet for mainnet funds.`);

  if (env.NETWORK === "mainnet-beta") {
    console.warn("This script is not intended for production custody.");
  }

  console.log(`Wallet path: ${keypairPath}`);
  console.log(`Public key: ${keypair.publicKey.toBase58()}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown wallet creation error";
  console.error(message);
  process.exitCode = 1;
}
