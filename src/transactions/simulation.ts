import { Transaction, type Connection } from "@solana/web3.js";

export type SignedTransactionForSimulation = {
  role: string;
  signature: string;
  serializedTransaction: {
    base64: string;
  };
};

export type TransactionSimulationResult = {
  role: string;
  signature: string;
  ok: boolean;
  err: unknown | null;
  logs: string[];
  units_consumed: number | null;
};

function conciseError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function truncateLogs(logs: string[] | null): string[] {
  return (logs ?? []).slice(0, 10);
}

export async function simulateSignedTransactions(input: {
  connection: Connection;
  transactions: SignedTransactionForSimulation[];
}): Promise<TransactionSimulationResult[]> {
  const results: TransactionSimulationResult[] = [];

  for (const transaction of input.transactions) {
    try {
      const signedTransaction = Transaction.from(Buffer.from(transaction.serializedTransaction.base64, "base64"));
      const simulation = await input.connection.simulateTransaction(signedTransaction);

      results.push({
        role: transaction.role,
        signature: transaction.signature,
        ok: simulation.value.err === null,
        err: simulation.value.err,
        logs: truncateLogs(simulation.value.logs),
        units_consumed: simulation.value.unitsConsumed ?? null
      });
    } catch (error) {
      results.push({
        role: transaction.role,
        signature: transaction.signature,
        ok: false,
        err: conciseError(error),
        logs: [],
        units_consumed: null
      });
    }
  }

  return results;
}
