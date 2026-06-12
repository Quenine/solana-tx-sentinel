import { LAMPORTS_PER_SOL, type Commitment } from "@solana/web3.js";

export const defaultCommitment = "confirmed" satisfies Commitment;

export function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toLocaleString("en-US", {
    maximumFractionDigits: 9
  });
}
