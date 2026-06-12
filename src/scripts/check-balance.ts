import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { defaultCommitment, formatSol } from "../types/solana.js";

async function main(): Promise<void> {
  const connection = createConnection();
  const wallet = loadWalletKeypair();
  const lamports = await connection.getBalance(wallet.publicKey, defaultCommitment);

  console.log(`Public key: ${wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${formatSol(lamports)} SOL`);
  console.log(`Lamports: ${lamports}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown balance check error";
  console.error(message);
  process.exitCode = 1;
});
