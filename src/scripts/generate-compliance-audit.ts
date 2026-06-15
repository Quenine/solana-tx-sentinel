import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const reportPath = "docs/competition-compliance.md";

const files = {
  evidenceReport: "docs/evidence-report.md",
  latestSummary: "data/lifecycle/latest-evidence-summary.json",
  jitoBundles: "data/lifecycle/jito-bundles.jsonl",
  jitoBundleFailures: "data/lifecycle/jito-bundle-failures.jsonl",
  autonomousRecovery: "data/lifecycle/autonomous-recovery.jsonl",
  agentDecisions: "data/lifecycle/agent-decisions.jsonl",
  observedJitoLeaders: "data/lifecycle/observed-jito-leaders.json",
  streamSummary: "data/stream/latest-stream-evidence-summary.json",
  streamEvidence: "data/stream/slot-stream-evidence.jsonl"
};

type JsonObject = Record<string, unknown>;

type FileStatus = {
  path: string;
  exists: boolean;
  entries?: number;
};

type EvidenceSummary = {
  evidence_session_id?: string;
  requested_count?: number;
  completed_count?: number;
  bundle_landed_count?: number;
  signature_finalized_count?: number;
  bundle_failed_count?: number;
  bundle_invalid_count?: number;
  code_inconsistent_count?: number;
};

type StreamSummary = {
  source?: string;
  transport?: string | null;
  captured_count?: number;
  requested_count?: number;
  first_slot?: number | null;
  last_slot?: number | null;
  unique_leader_count?: number;
};

type ObservedJitoLeaders = {
  observed_leader_count?: number;
};

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

  return text === null ? null : (JSON.parse(text) as T);
}

async function readJsonLines(path: string): Promise<JsonObject[] | null> {
  const text = await readOptionalText(path);

  if (text === null) {
    return null;
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonObject);
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "not available";
  }

  return String(value);
}

function statusLabel(passed: boolean, partial = false): "satisfied" | "partial" | "missing" {
  if (passed) {
    return "satisfied";
  }

  return partial ? "partial" : "missing";
}

function failureTypes(entries: JsonObject[] | null): string[] {
  const types = new Set<string>();

  for (const entry of entries ?? []) {
    const failure = entry.failure;

    if (typeof failure !== "object" || failure === null || Array.isArray(failure)) {
      continue;
    }

    const failureObject = failure as JsonObject;
    const type = failureObject.type;
    const subtype = failureObject.subtype;

    if (typeof type === "string") {
      types.add(typeof subtype === "string" ? `${type}:${subtype}` : type);
    }
  }

  return [...types].sort();
}

function scoredDecisionCount(entries: JsonObject[] | null): number {
  return (entries ?? []).filter(
    (entry) => entry.provider === "local_reasoning" && entry.decision_mode === "scored_policy"
  ).length;
}

function fileStatus(path: string, lines: JsonObject[] | null, text: string | null): FileStatus {
  return {
    path,
    exists: text !== null || lines !== null,
    ...(lines === null ? {} : { entries: lines.length })
  };
}

function matrixRow(requirement: string, status: string, evidence: string): string {
  return `| ${requirement} | ${status} | ${evidence.replace(/\|/g, "\\|")} |`;
}

function inventoryLine(status: FileStatus): string {
  const state = status.exists ? "present" : "missing";
  const entries = status.entries === undefined ? "" : `, entries=${status.entries}`;

  return `- ${status.path}: ${state}${entries}`;
}

function renderReport(input: {
  evidenceReportText: string | null;
  summary: EvidenceSummary | null;
  bundles: JsonObject[] | null;
  bundleFailures: JsonObject[] | null;
  recovery: JsonObject[] | null;
  decisions: JsonObject[] | null;
  observedLeaders: ObservedJitoLeaders | null;
  streamSummary: StreamSummary | null;
  streamEntries: JsonObject[] | null;
}): string {
  const summary = input.summary;
  const stream = input.streamSummary;
  const controlledFailures = failureTypes(input.bundleFailures);
  const landedBundles = summary?.bundle_landed_count ?? 0;
  const finalizedSignatures = summary?.signature_finalized_count ?? 0;
  const completedCount = summary?.completed_count ?? 0;
  const yellowstoneSatisfied = stream?.source === "yellowstone" && (stream.captured_count ?? 0) > 0;
  const scoredDecisions = scoredDecisionCount(input.decisions);
  const recoveryCount = input.recovery?.length ?? 0;
  const observedLeaderCount = input.observedLeaders?.observed_leader_count ?? 0;
  const hasEvidenceReport = input.evidenceReportText !== null;

  const matrix = [
    matrixRow(
      "At least 10 real bundle submissions",
      statusLabel(completedCount >= 10 && landedBundles >= 10),
      `completed=${completedCount}, landed=${landedBundles}, finalized_signatures=${finalizedSignatures}`
    ),
    matrixRow(
      "At least 2 controlled failure cases",
      statusLabel(controlledFailures.length >= 2, controlledFailures.length > 0),
      controlledFailures.length === 0 ? "not available" : controlledFailures.join(", ")
    ),
    matrixRow(
      "Yellowstone/Geyser live slot stream",
      statusLabel(yellowstoneSatisfied, (stream?.captured_count ?? 0) > 0),
      `source=${display(stream?.source)}, transport=${display(stream?.transport)}, captured_count=${display(stream?.captured_count)}`
    ),
    matrixRow(
      "Jito-only bundle submission evidence",
      statusLabel((input.bundles?.length ?? 0) > 0),
      `${display(input.bundles?.length)} bundle log entries in ${files.jitoBundles}`
    ),
    matrixRow(
      "Transaction and bundle lifecycle tracking",
      statusLabel(hasEvidenceReport && finalizedSignatures >= 10),
      `evidence_report=${hasEvidenceReport ? "present" : "missing"}, finalized_signatures=${finalizedSignatures}`
    ),
    matrixRow(
      "Failure classification",
      statusLabel(controlledFailures.length >= 2),
      controlledFailures.length === 0 ? "not available" : controlledFailures.join(", ")
    ),
    matrixRow(
      "AI operational decision ownership",
      statusLabel(scoredDecisions > 0),
      `scored local decisions=${scoredDecisions}`
    ),
    matrixRow(
      "Autonomous recovery evidence",
      statusLabel(recoveryCount > 0),
      `autonomous recovery entries=${recoveryCount}`
    ),
    matrixRow(
      "Observed Jito leader timing evidence",
      statusLabel(observedLeaderCount > 0),
      `observed_jito_leader_count=${observedLeaderCount}`
    )
  ];

  const inventory = [
    fileStatus(files.evidenceReport, null, input.evidenceReportText),
    fileStatus(files.latestSummary, null, input.summary === null ? null : "present"),
    fileStatus(files.jitoBundles, input.bundles, null),
    fileStatus(files.jitoBundleFailures, input.bundleFailures, null),
    fileStatus(files.autonomousRecovery, input.recovery, null),
    fileStatus(files.agentDecisions, input.decisions, null),
    fileStatus(files.observedJitoLeaders, null, input.observedLeaders === null ? null : "present"),
    fileStatus(files.streamSummary, null, input.streamSummary === null ? null : "present"),
    fileStatus(files.streamEvidence, input.streamEntries, null)
  ];

  const risks = [
    yellowstoneSatisfied
      ? `Yellowstone evidence is present via transport=${display(stream?.transport)}.`
      : "Yellowstone/Geyser evidence is not yet satisfied by the latest stream summary.",
    "Native @triton-one/yellowstone-grpc subscribe is not claimed as working unless separately captured; grpcurl transport is documented for Solinfra Subscribe evidence.",
    "Testnet Jito Block Engine behavior may differ from mainnet.",
    "Controlled failures are logged separately from the successful 10/10 final session."
  ];

  const nextActions = [
    yellowstoneSatisfied
      ? "Keep the latest Yellowstone stream summary and raw JSONL in the submission package."
      : "Run `SLOT_STREAM_SOURCE=yellowstone_grpcurl pnpm stream:capture` with valid Yellowstone credentials.",
    "Run `pnpm report:evidence` and `pnpm report:compliance` after any new evidence capture.",
    "Do not edit historical evidence logs; append new runs instead."
  ];

  return [
    "# Competition Compliance Audit",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Evidence session ID: ${display(summary?.evidence_session_id)}`,
    `- Final bundle submissions completed: ${display(summary?.completed_count)}`,
    `- Landed bundles: ${display(summary?.bundle_landed_count)}`,
    `- Finalized signatures: ${display(summary?.signature_finalized_count)}`,
    `- Controlled failure types: ${controlledFailures.length === 0 ? "not available" : controlledFailures.join(", ")}`,
    `- Live stream evidence: source=${display(stream?.source)}, transport=${display(stream?.transport)}, captured_count=${display(stream?.captured_count)}`,
    "",
    "## Requirement Matrix",
    "",
    "| Requirement | Status | Evidence |",
    "| --- | --- | --- |",
    ...matrix,
    "",
    "## Evidence Inventory",
    "",
    ...inventory.map(inventoryLine),
    "",
    "## Known Risks",
    "",
    ...risks.map((risk) => `- ${risk}`),
    "",
    "## Next Actions",
    "",
    ...nextActions.map((action) => `- ${action}`),
    ""
  ].join("\n");
}

async function main(): Promise<void> {
  const evidenceReportText = await readOptionalText(files.evidenceReport);
  const summary = await readOptionalJson<EvidenceSummary>(files.latestSummary);
  const bundles = await readJsonLines(files.jitoBundles);
  const bundleFailures = await readJsonLines(files.jitoBundleFailures);
  const recovery = await readJsonLines(files.autonomousRecovery);
  const decisions = await readJsonLines(files.agentDecisions);
  const observedLeaders = await readOptionalJson<ObservedJitoLeaders>(files.observedJitoLeaders);
  const streamSummary = await readOptionalJson<StreamSummary>(files.streamSummary);
  const streamEntries = await readJsonLines(files.streamEvidence);
  const report = renderReport({
    evidenceReportText,
    summary,
    bundles,
    bundleFailures,
    recovery,
    decisions,
    observedLeaders,
    streamSummary,
    streamEntries
  });

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report, "utf8");
  console.log(`Wrote ${reportPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown compliance audit error";
  console.error(`Compliance audit generation failed: ${message}`);
  process.exitCode = 1;
});
