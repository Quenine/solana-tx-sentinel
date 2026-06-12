import { getEnv, type Network } from "../config/env.js";

export function getNetwork(): Network {
  return getEnv().NETWORK;
}

export function explorerUrl(signature: string, network: Network): string {
  const cluster = network === "mainnet-beta" ? "" : `?cluster=${network}`;

  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
