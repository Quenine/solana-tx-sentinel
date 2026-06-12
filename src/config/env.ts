import "dotenv/config";

import { z } from "zod";

const networkSchema = z.enum(["devnet", "testnet", "mainnet-beta"]);
const logLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);
const slotStreamSourceSchema = z.enum(["solana_ws", "yellowstone"]);
const yellowstoneCommitmentSchema = z.enum(["processed", "confirmed", "finalized"]);
const bundleLayoutSchema = z.enum(["combined_tip_instruction", "separate_tip_tx"]);
const evidenceProfileSchema = z.enum(["final"]);
const positiveIntegerEnv = z.coerce.number().int().positive();
const positiveNumberEnv = z.coerce.number().positive();

const envSchema = z.object({
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: z.string().url(),
  YELLOWSTONE_GRPC_ENDPOINT: z.string().optional().default(""),
  YELLOWSTONE_GRPC_TOKEN: z.string().optional().default(""),
  JITO_BLOCK_ENGINE_URL: z.string().url(),
  WALLET_KEYPAIR_PATH: z.string().min(1),
  NETWORK: networkSchema.default("devnet"),
  LOG_LEVEL: logLevelSchema.default("info"),
  SLOT_STREAM_SOURCE: slotStreamSourceSchema.default("solana_ws"),
  YELLOWSTONE_COMMITMENT: yellowstoneCommitmentSchema.default("processed"),
  STREAM_EVIDENCE_EVENT_COUNT: positiveIntegerEnv.default(25),
  STREAM_RECONNECT_MAX_ATTEMPTS: z.coerce.number().int().nonnegative().default(5),
  STREAM_RECONNECT_BACKOFF_MS: positiveIntegerEnv.default(1_000),
  BUNDLE_LAYOUT: bundleLayoutSchema.default("separate_tip_tx"),
  EVIDENCE_PROFILE: evidenceProfileSchema.optional(),
  MIN_JITO_TIP_LAMPORTS: positiveIntegerEnv.default(1_000),
  MAX_JITO_TIP_LAMPORTS: positiveIntegerEnv.default(100_000),
  TIP_URGENCY_MULTIPLIER: positiveNumberEnv.default(1.25),
  PRIORITY_FEE_MICRO_LAMPORTS: z.coerce.number().int().nonnegative().default(200_000),
  COMPUTE_UNIT_LIMIT: positiveIntegerEnv.default(200_000),
  ENABLE_SUBMISSION_TIMING: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SUBMISSION_LOOKAHEAD_SLOTS: positiveIntegerEnv.default(16),
  SUBMISSION_TARGET_DISTANCE_MIN: z.coerce.number().int().nonnegative().default(1),
  SUBMISSION_TARGET_DISTANCE_MAX: positiveIntegerEnv.default(8),
  SUBMISSION_MAX_WAIT_MS: positiveIntegerEnv.default(30_000),
  ENABLE_OBSERVED_JITO_LEADERS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SUBMIT_BUNDLE_ON_SIMULATION_FAILURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BUNDLE_STATUS_TIMEOUT_MS: positiveIntegerEnv.default(45_000),
  BUNDLE_STATUS_POLL_INTERVAL_MS: positiveIntegerEnv.default(1_500),
  STOP_ON_FIRST_INVALID: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OBSERVED_JITO_LEADERS_PATH: z.string().min(1).default("data/lifecycle/observed-jito-leaders.json"),
  OBSERVED_JITO_LEADER_MIN_LANDINGS: positiveIntegerEnv.default(1),
  ENABLE_AI_AGENT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OPENAI_API_KEY: z.string().optional()
}).refine((env) => env.MAX_JITO_TIP_LAMPORTS >= env.MIN_JITO_TIP_LAMPORTS, {
  path: ["MAX_JITO_TIP_LAMPORTS"],
  message: "MAX_JITO_TIP_LAMPORTS must be greater than or equal to MIN_JITO_TIP_LAMPORTS"
}).refine((env) => env.SUBMISSION_TARGET_DISTANCE_MAX >= env.SUBMISSION_TARGET_DISTANCE_MIN, {
  path: ["SUBMISSION_TARGET_DISTANCE_MAX"],
  message: "SUBMISSION_TARGET_DISTANCE_MAX must be greater than or equal to SUBMISSION_TARGET_DISTANCE_MIN"
}).refine((env) => env.SUBMISSION_LOOKAHEAD_SLOTS >= env.SUBMISSION_TARGET_DISTANCE_MAX, {
  path: ["SUBMISSION_LOOKAHEAD_SLOTS"],
  message: "SUBMISSION_LOOKAHEAD_SLOTS must be greater than or equal to SUBMISSION_TARGET_DISTANCE_MAX"
});

export type Network = z.infer<typeof networkSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type SlotStreamSource = z.infer<typeof slotStreamSourceSchema>;
export type YellowstoneCommitment = z.infer<typeof yellowstoneCommitmentSchema>;
export type BundleLayout = z.infer<typeof bundleLayoutSchema>;
export type EvidenceProfile = z.infer<typeof evidenceProfileSchema>;
export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(input);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return parsed.data;
}

let cachedEnv: Env | undefined;

export function getEnv(): Env {
  cachedEnv ??= parseEnv(process.env);
  return cachedEnv;
}
