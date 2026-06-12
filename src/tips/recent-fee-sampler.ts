import type { Connection } from "@solana/web3.js";

import type { RecentFeeSummary } from "./types.js";

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  const boundedIndex = Math.min(Math.max(index, 0), sortedValues.length - 1);

  return sortedValues[boundedIndex]!;
}

export async function sampleRecentPrioritizationFees(connection: Connection): Promise<RecentFeeSummary> {
  const samples = await connection.getRecentPrioritizationFees();
  const fees = samples
    .map((sample) => sample.prioritizationFee)
    .filter((fee) => Number.isSafeInteger(fee) && fee >= 0)
    .sort((a, b) => a - b);

  if (fees.length === 0) {
    return {
      sample_count: 0,
      min: null,
      median: null,
      p75: null,
      p90: null,
      max: null
    };
  }

  return {
    sample_count: fees.length,
    min: fees[0]!,
    median: percentile(fees, 50),
    p75: percentile(fees, 75),
    p90: percentile(fees, 90),
    max: fees[fees.length - 1]!
  };
}
