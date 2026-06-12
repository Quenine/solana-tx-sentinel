import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ControlledJitoBundleFailureLog } from "../evidence/failure-evidence.js";

const latestSummaryPath = "data/lifecycle/latest-evidence-summary.json";
const jitoBundlesPath = "data/lifecycle/jito-bundles.jsonl";
const jitoBundleFailuresPath = "data/lifecycle/jito-bundle-failures.jsonl";
const autonomousRecoveryPath = "data/lifecycle/autonomous-recovery.jsonl";
const devnetFailuresPath = "data/lifecycle/devnet-failures.jsonl";
const agentDecisionsPath = "data/lifecycle/agent-decisions.jsonl";
const streamEvidenceSummaryPath = "data/stream/latest-stream-evidence-summary.json";
const reportPath = "docs/evidence-report.md";

type JsonObject = Record<string, unknown>;

type EvidenceSummary = {
  evidence_session_id?: string;
  requested_count?: number;
  completed_count?: number;
  bundle_landed_count?: number;
  bundle_failed_count?: number;
  bundle_invalid_count?: number;
  bundle_timed_out_count?: number;
  signature_finalized_count?: number;
  code_inconsistent_count?: number;
  operational_ambiguity_count?: number;
  average_submitted_to_processed_ms?: number | null;
  average_submitted_to_confirmed_ms?: number | null;
  average_submitted_to_finalized_ms?: number | null;
  tip_lamports_min?: number | null;
  tip_lamports_max?: number | null;
  bundle_ids?: string[];
  started_at?: string;
  finished_at?: string;
};

type BundleRun = {
  evidence_session_id?: string;
  network?: string;
  bundle_id?: string | null;
  transaction_signature?: string;
  tip_lamports?: number;
  submission_path?: string;
  rpc_rebroadcast?: boolean;
  timing_decision?: JsonObject;
  tip_decision?: JsonObject;
  bundle_status?: {
    final_bundle_status?: string;
    landed_slot?: number;
    final_status_source?: string;
  };
  lifecycle?: {
    submitted_to_processed_ms?: number | null;
    processed_to_confirmed_ms?: number | null;
    submitted_to_finalized_ms?: number | null;
  } | null;
  failure?: {
    type?: string;
    message?: string;
  } | null;
  submitted_at?: string;
  created_at?: string;
};

type AgentDecision = {
  source_file?: string;
  provider?: string;
  decision_mode?: string;
  selected_action?: string;
  action?: string;
  reason?: string;
  refresh_blockhash?: boolean;
  resubmit?: boolean;
  confidence?: number;
  candidate_actions?: CandidateAction[];
  created_at?: string;
};

type StreamEvidenceSummary = {
  source?: string;
  requested_count?: number;
  captured_count?: number;
  first_slot?: number | null;
  last_slot?: number | null;
  unique_leader_count?: number;
  started_at?: string;
  finished_at?: string;
};

type CandidateAction = {
  action?: string;
  score?: number;
  reason?: string;
};

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  const text = await readOptionalText(path);

  if (text === null) {
    return null;
  }

  return JSON.parse(text) as T;
}

async function readJsonLines<T>(path: string): Promise<T[] | null> {
  const text = await readOptionalText(path);

  if (text === null) {
    return null;
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "not available";
  }

  return String(value);
}

function boolText(value: unknown): string {
  return typeof value === "boolean" ? String(value) : "not available";
}

function escapeCell(value: unknown): string {
  return display(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? "not available" : String(value);
}

function submittedToConfirmed(run: BundleRun): number | null {
  const processed = run.lifecycle?.submitted_to_processed_ms;
  const processedToConfirmed = run.lifecycle?.processed_to_confirmed_ms;

  if (processed === null || processed === undefined || processedToConfirmed === null || processedToConfirmed === undefined) {
    return null;
  }

  return processed + processedToConfirmed;
}

function selectBundleRuns(summary: EvidenceSummary | null, runs: BundleRun[] | null): BundleRun[] {
  if (!runs) {
    return [];
  }

  const bundleIds = new Set(summary?.bundle_ids ?? []);
  const sessionId = summary?.evidence_session_id;
  const selected = runs.filter((run) => {
    if (sessionId && run.evidence_session_id === sessionId) {
      return true;
    }

    return run.bundle_id !== null && run.bundle_id !== undefined && bundleIds.has(run.bundle_id);
  });

  return selected.sort((left, right) => display(left.submitted_at ?? left.created_at).localeCompare(display(right.submitted_at ?? right.created_at)));
}

function bundleTable(runs: BundleRun[]): string {
  if (runs.length === 0) {
    return "not available";
  }

  const rows = runs.map((run) =>
    [
      run.bundle_id,
      run.transaction_signature,
      run.bundle_status?.landed_slot,
      run.tip_lamports,
      run.lifecycle?.submitted_to_processed_ms,
      submittedToConfirmed(run),
      run.lifecycle?.submitted_to_finalized_ms,
      run.bundle_status?.final_bundle_status
    ]
      .map(escapeCell)
      .join(" | ")
  );

  return [
    "| bundle_id | signature | landed_slot | tip_lamports | submitted_to_processed_ms | submitted_to_confirmed_ms | submitted_to_finalized_ms | final_bundle_status |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row} |`)
  ].join("\n");
}

function latestByCreatedAt<T extends { created_at?: string }>(items: T[] | null): T | null {
  if (!items || items.length === 0) {
    return null;
  }

  return [...items].sort((left, right) => display(right.created_at).localeCompare(display(left.created_at)))[0] ?? null;
}

function toAgentDecision(record: JsonObject): AgentDecision {
  const sourceFile = asString(record.source_file);
  const provider = asString(record.provider);
  const decisionMode = asString(record.decision_mode);
  const selectedAction = asString(record.selected_action);
  const action = asString(record.action);
  const reason = asString(record.reason);
  const refreshBlockhash = typeof record.refresh_blockhash === "boolean" ? record.refresh_blockhash : undefined;
  const resubmit = typeof record.resubmit === "boolean" ? record.resubmit : undefined;
  const confidence = asNumber(record.confidence);
  const createdAt = asString(record.created_at);
  const candidateActions = Array.isArray(record.candidate_actions)
    ? record.candidate_actions.flatMap((item): CandidateAction[] => {
        const candidate = asObject(item);

        if (!candidate) {
          return [];
        }

        const candidateAction = asString(candidate.action);
        const score = asNumber(candidate.score);
        const candidateReason = asString(candidate.reason);

        return [
          {
            ...(candidateAction === undefined ? {} : { action: candidateAction }),
            ...(score === undefined ? {} : { score }),
            ...(candidateReason === undefined ? {} : { reason: candidateReason })
          }
        ];
      })
    : undefined;

  return {
    ...(sourceFile === undefined ? {} : { source_file: sourceFile }),
    ...(provider === undefined ? {} : { provider }),
    ...(decisionMode === undefined ? {} : { decision_mode: decisionMode }),
    ...(selectedAction === undefined ? {} : { selected_action: selectedAction }),
    ...(action === undefined ? {} : { action }),
    ...(reason === undefined ? {} : { reason }),
    ...(refreshBlockhash === undefined ? {} : { refresh_blockhash: refreshBlockhash }),
    ...(resubmit === undefined ? {} : { resubmit }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(candidateActions === undefined ? {} : { candidate_actions: candidateActions }),
    ...(createdAt === undefined ? {} : { created_at: createdAt })
  };
}

function failureSummary(input: {
  failures: JsonObject[] | null;
  recovery: JsonObject[] | null;
  bundleRuns: BundleRun[];
}): string {
  const latestExpired = latestByCreatedAt(input.failures);
  const latestRecovery = latestByCreatedAt(input.recovery);
  const bundleFailures = input.bundleRuns.filter((run) => run.failure !== null && run.failure !== undefined);

  return [
    `- Expired blockhash fault injection: ${
      latestExpired
        ? `${display(asObject(latestExpired.failure)?.type)} recorded at ${display(latestExpired.created_at)}.`
        : "not available"
    }`,
    `- Autonomous retry recovery: ${
      latestRecovery
        ? `${display(latestRecovery.final_status)} recorded at ${display(latestRecovery.created_at)}.`
        : "not available"
    }`,
    `- Bundle failure classification: ${
      bundleFailures.length === 0
        ? "none recorded in the selected final evidence session."
        : bundleFailures.map((run) => `${display(run.bundle_id)}: ${display(run.failure?.type)} (${display(run.failure?.message)})`).join("; ")
    }`
  ].join("\n");
}

function decisionsFrom(input: { decisions: JsonObject[] | null; recovery: JsonObject[] | null }): AgentDecision[] {
  const direct = (input.decisions ?? []).map(toAgentDecision);
  const fromRecovery = (input.recovery ?? []).flatMap((item) => {
    const decision = asObject(item.agent_decision);

    if (!decision) {
      return [];
    }

    return [toAgentDecision(decision)];
  });

  return [...direct, ...fromRecovery]
    .filter((decision) => decision.provider !== undefined && decision.decision_mode !== undefined)
    .sort((left, right) => display(right.created_at).localeCompare(display(left.created_at)))
    .slice(0, 5);
}

function decisionTable(decisions: AgentDecision[]): string {
  if (decisions.length === 0) {
    return "not available";
  }

  return [
    "| source_file | provider | decision_mode | selected_action | action | confidence | top rejected action | reason |",
    "| --- | --- | --- | --- | --- | ---: | --- | --- |",
    ...decisions.map(
      (decision) =>
        `| ${escapeCell(decision.source_file)} | ${escapeCell(decision.provider)} | ${escapeCell(
          decision.decision_mode
        )} | ${escapeCell(
          decision.selected_action
        )} | ${escapeCell(decision.action)} | ${escapeCell(decision.confidence)} | ${escapeCell(
          topRejectedAction(decision)
        )} | ${escapeCell(decision.reason)} |`
    )
  ].join("\n");
}

function topRejectedAction(decision: AgentDecision): string {
  const [rejected] = [...(decision.candidate_actions ?? [])]
    .filter((candidate) => candidate.action !== decision.selected_action)
    .sort((left, right) => (right.score ?? -1) - (left.score ?? -1));

  if (!rejected?.action) {
    return "not available";
  }

  return rejected.score === undefined ? rejected.action : `${rejected.action} (${rejected.score})`;
}

function latestFailureByType(
  entries: ControlledJitoBundleFailureLog[] | null,
  failureType: "expired_blockhash" | "compute_exceeded" | "bundle_failure"
): ControlledJitoBundleFailureLog | null {
  const matches = (entries ?? []).filter((entry) => entry.failure?.type === failureType);

  return latestByCreatedAt(matches);
}

function latestFailureByScenario(
  entries: ControlledJitoBundleFailureLog[] | null,
  scenario: ControlledJitoBundleFailureLog["failure_scenario"]
): ControlledJitoBundleFailureLog | null {
  const matches = (entries ?? []).filter((entry) => entry.failure_scenario === scenario);

  return latestByCreatedAt(matches);
}

function controlledFailureTable(entries: ControlledJitoBundleFailureLog[] | null): string {
  const selected = [
    latestFailureByType(entries, "expired_blockhash"),
    latestFailureByType(entries, "compute_exceeded"),
    latestFailureByScenario(entries, "invalid_tip_account_bundle")
  ].filter((entry): entry is ControlledJitoBundleFailureLog => entry !== null);

  if (selected.length === 0) {
    return "not available";
  }

  return [
    "| scenario | subtype | bundle_id | signature | simulation_status | final_bundle_status |",
    "| --- | --- | --- | --- | --- | --- |",
    ...selected.map(
      (entry) =>
        `| ${escapeCell(entry.failure_scenario)} | ${escapeCell(entry.failure.subtype)} | ${escapeCell(entry.bundle_id)} | ${escapeCell(
          entry.transaction_signature
        )} | ${escapeCell(simulationStatus(entry))} | ${escapeCell(entry.bundle_status?.final_bundle_status)} |`
    )
  ].join("\n");
}

function simulationStatus(entry: ControlledJitoBundleFailureLog): string {
  if (entry.failure_scenario === "expired_blockhash_bundle") {
    return `simulation_before_expiry_passed=${boolText(entry.simulation_passed)}`;
  }

  return `simulation_passed=${boolText(entry.simulation_passed)}`;
}

function firstAvailableNetwork(summaryRuns: BundleRun[]): string {
  return summaryRuns.find((run) => run.network)?.network ?? "not available";
}

function noteLines(runs: BundleRun[]): string {
  const firstRun = runs[0];
  const tipReason = asString(firstRun?.tip_decision?.reason);
  const timingStrategy = asString(firstRun?.timing_decision?.strategy);
  const finalStatusSource = firstRun?.bundle_status?.final_status_source;

  return [
    `- Jito-only submission path: ${firstRun ? display(firstRun.submission_path) : "not available"}.`,
    `- RPC rebroadcast: ${firstRun ? boolText(firstRun.rpc_rebroadcast) : "not available"}.`,
    `- Bundle status polling: every observation is recorded; early inflight Invalid is not treated as final when later Landed/final status data arrives. Example final_status_source: ${display(
      finalStatusSource
    )}.`,
    `- Dynamic tip calculation: ${tipReason ?? "not available"}`,
    `- Observed leader timing: ${timingStrategy ?? "not available"}`,
    "- Stale-blockhash bundle failures may be rejected before a bundle_id is produced."
  ].join("\n");
}

function streamEvidenceSummary(summary: StreamEvidenceSummary | null): string {
  if (!summary) {
    return "not available";
  }

  return [
    `- Source: ${display(summary.source)}`,
    `- Requested count: ${display(summary.requested_count)}`,
    `- Captured count: ${display(summary.captured_count)}`,
    `- First slot: ${display(summary.first_slot)}`,
    `- Last slot: ${display(summary.last_slot)}`,
    `- Unique leader count: ${display(summary.unique_leader_count)}`,
    `- Started at: ${display(summary.started_at)}`,
    `- Finished at: ${display(summary.finished_at)}`
  ].join("\n");
}

function renderReport(input: {
  summary: EvidenceSummary | null;
  bundleRuns: BundleRun[];
  streamSummary: StreamEvidenceSummary | null;
  failures: JsonObject[] | null;
  jitoBundleFailures: ControlledJitoBundleFailureLog[] | null;
  recovery: JsonObject[] | null;
  decisions: JsonObject[] | null;
}): string {
  const summary = input.summary;

  return [
    "# Solana Tx Sentinel Evidence Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Evidence Session",
    "",
    `- Evidence session ID: ${display(summary?.evidence_session_id)}`,
    `- Network: ${firstAvailableNetwork(input.bundleRuns)}`,
    `- Started at: ${display(summary?.started_at)}`,
    `- Finished at: ${display(summary?.finished_at)}`,
    "",
    "## Bundle Submission Summary",
    "",
    `- Requested count: ${display(summary?.requested_count)}`,
    `- Completed count: ${display(summary?.completed_count)}`,
    `- Bundle landed count: ${display(summary?.bundle_landed_count)}`,
    `- Signature finalized count: ${display(summary?.signature_finalized_count)}`,
    `- Bundle failed count: ${display(summary?.bundle_failed_count)}`,
    `- Bundle invalid count: ${display(summary?.bundle_invalid_count)}`,
    `- Bundle timed out count: ${display(summary?.bundle_timed_out_count)}`,
    `- Code inconsistent count: ${display(summary?.code_inconsistent_count)}`,
    `- Operational ambiguity count: ${display(summary?.operational_ambiguity_count)}`,
    "",
    "## Final Bundle Submissions",
    "",
    bundleTable(input.bundleRuns),
    "",
    "## Average Latency Summary",
    "",
    `- Average submitted to processed: ${ms(summary?.average_submitted_to_processed_ms)} ms`,
    `- Average submitted to confirmed: ${ms(summary?.average_submitted_to_confirmed_ms)} ms`,
    `- Average submitted to finalized: ${ms(summary?.average_submitted_to_finalized_ms)} ms`,
    "",
    "## Tip Range",
    "",
    `- Minimum tip: ${display(summary?.tip_lamports_min)} lamports`,
    `- Maximum tip: ${display(summary?.tip_lamports_max)} lamports`,
    "",
    "## Stream Evidence Summary",
    "",
    streamEvidenceSummary(input.streamSummary),
    "",
    "## Failure Evidence Summary",
    "",
    failureSummary({
      failures: input.failures,
      recovery: input.recovery,
      bundleRuns: input.bundleRuns
    }),
    "",
    "## Controlled Jito Bundle Failure Evidence",
    "",
    controlledFailureTable(input.jitoBundleFailures),
    "",
    "The expired-blockhash case may be rejected before bundle acceptance; invalid-tip and compute-exceeded cases are used as additional Jito bundle failure evidence.",
    "",
    "## AI Decision Evidence",
    "",
    decisionTable(
      decisionsFrom({
        decisions: input.decisions,
        recovery: input.recovery
      })
    ),
    "",
    "The local reasoning agent evaluates multiple candidate recovery actions and the recovery runner follows the selected decision.",
    "Older pre-scored local decisions are retained in raw logs but omitted from this table.",
    "",
    "## Notes",
    "",
    noteLines(input.bundleRuns),
    ""
  ].join("\n");
}

async function main(): Promise<void> {
  const summary = await readOptionalJson<EvidenceSummary>(latestSummaryPath);
  const bundleRuns = await readJsonLines<BundleRun>(jitoBundlesPath);
  const selectedBundleRuns = selectBundleRuns(summary, bundleRuns);
  const failures = await readJsonLines<JsonObject>(devnetFailuresPath);
  const jitoBundleFailures = await readJsonLines<ControlledJitoBundleFailureLog>(jitoBundleFailuresPath);
  const recovery = await readJsonLines<JsonObject>(autonomousRecoveryPath);
  const decisions = await readJsonLines<JsonObject>(agentDecisionsPath);
  const streamSummary = await readOptionalJson<StreamEvidenceSummary>(streamEvidenceSummaryPath);
  const report = renderReport({
    summary,
    bundleRuns: selectedBundleRuns,
    streamSummary,
    failures,
    jitoBundleFailures,
    recovery,
    decisions
  });

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report, "utf8");
  console.log(`Wrote ${reportPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown evidence report error";
  console.error(`Evidence report generation failed: ${message}`);
  process.exitCode = 1;
});
