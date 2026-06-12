import { PublicKey } from "@solana/web3.js";

import type { JitoRpcClient } from "./jito-rpc-client.js";

function isSolanaPublicKey(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export async function fetchTipAccounts(client: JitoRpcClient): Promise<string[]> {
  const accounts = await client.getTipAccounts();

  if (!Array.isArray(accounts)) {
    throw new Error("Jito getTipAccounts returned a non-array result.");
  }

  const invalid = accounts.filter((account) => !isSolanaPublicKey(account));

  if (invalid.length > 0) {
    throw new Error(`Jito getTipAccounts returned invalid Solana public keys: ${invalid.slice(0, 3).join(", ")}`);
  }

  return accounts;
}

export function chooseTipAccount(accounts: string[], seed = Date.now()): string {
  if (accounts.length === 0) {
    throw new Error("No Jito tip accounts are available.");
  }

  const index = Math.abs(Math.trunc(seed)) % accounts.length;

  return accounts[index]!;
}
