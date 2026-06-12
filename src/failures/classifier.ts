import type { ClassifiedFailure, FailureType } from "./types.js";

function errorText(error: unknown): string {
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

function conciseRawError(error: unknown): string | null {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : errorText(error);
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return null;
  }

  return normalized.length > 800 ? `${normalized.slice(0, 800)}...` : normalized;
}

function classifyText(text: string): FailureType {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("blockhash not found") ||
    normalized.includes("block height exceeded") ||
    normalized.includes("transaction expired") ||
    normalized.includes("expired blockhash") ||
    normalized.includes("lastvalidblockheight")
  ) {
    return "expired_blockhash";
  }

  if (
    normalized.includes("insufficient prioritization fee") ||
    normalized.includes("priority fee") ||
    normalized.includes("fee too low") ||
    normalized.includes("insufficient fee")
  ) {
    return "fee_too_low";
  }

  if (
    normalized.includes("computational budget exceeded") ||
    normalized.includes("compute budget exceeded") ||
    normalized.includes("exceeded maximum number of instructions") ||
    normalized.includes("program failed to complete")
  ) {
    return "compute_exceeded";
  }

  if (
    normalized.includes("bundle") &&
    (normalized.includes("failed") ||
      normalized.includes("rejected") ||
      normalized.includes("dropped") ||
      normalized.includes("invalid"))
  ) {
    return "bundle_failure";
  }

  return "unknown";
}

export function classifyFailure(error: unknown): ClassifiedFailure {
  const message = errorText(error);

  return {
    type: classifyText(message),
    message,
    raw_error: conciseRawError(error)
  };
}
