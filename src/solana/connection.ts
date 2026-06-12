import { Connection } from "@solana/web3.js";

import { getEnv } from "../config/env.js";
import { defaultCommitment } from "../types/solana.js";

export function createConnection(): Connection {
  return new Connection(getEnv().SOLANA_RPC_URL, defaultCommitment);
}
