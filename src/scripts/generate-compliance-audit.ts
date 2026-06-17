import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const reportPath = "docs/competition-compliance.md";

const files = {
  readme: "README.md",
  packageJson: "package.json",
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

type Status = "satisfied" | "partial" | "missing" | "risk";
type JsonObject = Record<string, unknown>;

type EvidenceSummary = {
  evidence_session_id?: string;
  completed_count?: number;
  bundle_landed_count?: number;
  signature_finalized_count?: number;
  code_inconsistent_count?: number;
};

type StreamSummary = {
  source?: string;
  transport?: string | null;
  captured_count?: number;
  first_slot?: number | null;
  last_slot?: number | null;
  unique_leader_count?: number;
};

type ObservedJitoLeaders = {
  observed_leader_count?: number;
};

type RequirementRow = {
  requirement: string;
  status: Status;
  evidenceFiles: string[];
  command: string;
  notes: string;
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
  if (value === null || value === undefined || value === "") {
    return "not available";
  }

  return String(value);
}

function escapeCell(value: unknown): string {
  return display(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function hasText(text: string | null, pattern: RegExp): boolean {
  return text !== null && pattern.test(text);
}

function nestedObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function failureTypes(entries: JsonObject[] | null): string[] {
  const types = new Set<string>();

  for (const entry of entries ?? []) {
    const failure = nestedObject(entry.failure);
    const type = failure?.type;
    const subtype = failure?.subtype;

    if (typeof type === "string") {
      types.add(typeof subtype === "string" ? `${type}:${subtype}` : type);
    }
  }

  return [...types].sort();
}

function countScoredDecisions(entries: JsonObject[] | null): number {
  return (entries ?? []).filter(
    (entry) => entry.provider === "local_reasoning" && entry.decision_mode === "scored_policy"
  ).length;
}

function hasRefreshBlockhashRetry(entries: JsonObject[] | null): boolean {
  return (entries ?? []).some(
    (entry) =>
      entry.selected_action === "refresh_blockhash_and_retry" &&
      entry.refresh_blockhash === true &&
      entry.resubmit === true
  );
}

function hasLifecycleStages(entries: JsonObject[] | null): boolean {
  return (entries ?? []).some((entry) => {
    const lifecycle = nestedObject(entry.lifecycle);

    return (
      typeof lifecycle?.processed_at === "string" ||
      typeof lifecycle?.confirmed_at === "string" ||
      typeof lifecycle?.finalized_at === "string" ||
      typeof lifecycle?.submitted_to_processed_ms === "number" ||
      typeof lifecycle?.submitted_to_finalized_ms === "number"
    );
  });
}

function hasJitoOnly(entries: JsonObject[] | null): boolean {
  return (entries ?? []).some((entry) => entry.submission_path === "jito_only" && entry.rpc_rebroadcast === false);
}

function fileList(paths: string[]): string {
  return paths.join(", ");
}

function matrixRow(row: RequirementRow): string {
  return `| ${escapeCell(row.requirement)} | ${row.status} | ${escapeCell(fileList(row.evidenceFiles))} | ${escapeCell(
    row.command
  )} | ${escapeCell(row.notes)} |`;
}

function inventoryLine(path: string, text: string | null, lines?: JsonObject[] | null): string {
  const present = text !== null || lines !== null;
  const count = lines === undefined || lines === null ? "" : `, entries=${lines.length}`;

  return `- ${path}: ${present ? "present" : "missing"}${count}`;
}

function readiness(rows: RequirementRow[]): "ready with documented risks" | "partial" | "not ready" {
  const missing = rows.filter((row) => row.status === "missing").length;
  const satisfied = rows.filter((row) => row.status === "satisfied").length;

  if (missing > 0) {
    return "partial";
  }

  return satisfied >= 10 ? "ready with documented risks" : "partial";
}

function renderReport(input: {
  readme: string | null;
  packageJson: string | null;
  evidenceReport: string | null;
  summary: EvidenceSummary | null;
  bundles: JsonObject[] | null;
  bundleFailures: JsonObject[] | null;
  recovery: JsonObject[] | null;
  decisions: JsonObject[] | null;
  observedLeaders: ObservedJitoLeaders | null;
  streamSummary: StreamSummary | null;
  streamEntries: JsonObject[] | null;
}): string {
  const failureTypesList = failureTypes(input.bundleFailures);
  const stream = input.streamSummary;
  const yellowstoneSatisfied = stream?.source === "yellowstone" && (stream.captured_count ?? 0) > 0;
  const scoredDecisions = countScoredDecisions(input.decisions);
  const architecturePartial = hasText(input.readme, /Architecture Overview/i);
  const readmeQuestionsSatisfied = hasText(input.readme, /README Judging Questions/i);
  const openSourcePartial = input.packageJson !== null && input.readme !== null;
  const licenseMissing = hasText(input.readme, /No license file is currently included/i);
  const leaderEvidence = (input.observedLeaders?.observed_leader_count ?? 0) > 0;
  const lifecycleEvidence = hasLifecycleStages(input.bundles);
  const jitoOnly = hasJitoOnly(input.bundles);
  const completed = input.summary?.completed_count ?? 0;
  const landed = input.summary?.bundle_landed_count ?? 0;
  const finalized = input.summary?.signature_finalized_count ?? 0;

  const rows: RequirementRow[] = [
    {
      requirement: "Architecture design document",
      status: architecturePartial ? "partial" : "missing",
      evidenceFiles: [files.readme],
      command: "open README.md",
      notes: architecturePartial
        ? "README includes an architecture overview; separate public architecture document URL is still pending."
        : "No architecture overview found."
    },
    {
      requirement: "Live slot and leader data",
      status: yellowstoneSatisfied && leaderEvidence ? "satisfied" : yellowstoneSatisfied ? "partial" : "missing",
      evidenceFiles: [files.streamSummary, files.streamEvidence, files.observedJitoLeaders],
      command: "pnpm stream:capture && pnpm leaders:learn-jito",
      notes: `stream_source=${display(stream?.source)}, transport=${display(stream?.transport)}, observed_leaders=${display(
        input.observedLeaders?.observed_leader_count
      )}`
    },
    {
      requirement: "Yellowstone/Geyser support",
      status: yellowstoneSatisfied ? "satisfied" : "partial",
      evidenceFiles: [files.streamSummary, files.streamEvidence],
      command: "SLOT_STREAM_SOURCE=yellowstone_grpcurl pnpm stream:capture",
      notes: `captured_count=${display(stream?.captured_count)}, transport=${display(stream?.transport)}`
    },
    {
      requirement: "Leader window detection",
      status: leaderEvidence ? "satisfied" : "partial",
      evidenceFiles: [files.observedJitoLeaders, files.jitoBundles],
      command: "pnpm leaders:learn-jito",
      notes: `observed_jito_leader_count=${display(input.observedLeaders?.observed_leader_count)}`
    },
    {
      requirement: "Jito bundle construction",
      status: jitoOnly ? "satisfied" : "missing",
      evidenceFiles: [files.jitoBundles],
      command: "pnpm bundle:preview && pnpm bundle:send",
      notes: jitoOnly ? "Bundle logs include submission_path=jito_only and rpc_rebroadcast=false." : "No Jito-only bundle log found."
    },
    {
      requirement: "Dynamic tip logic",
      status: hasText(input.evidenceReport, /Dynamic tip calculation/i) ? "satisfied" : "partial",
      evidenceFiles: [files.evidenceReport, files.jitoBundles],
      command: "pnpm bundle:preview",
      notes: "Evidence report includes dynamic tip note when bundle evidence is available."
    },
    {
      requirement: "Lifecycle tracking",
      status: lifecycleEvidence ? "satisfied" : "partial",
      evidenceFiles: [files.evidenceReport, files.jitoBundles],
      command: "pnpm evidence:bundles 10",
      notes: `finalized_signatures=${finalized}`
    },
    {
      requirement: "Failure classification",
      status: failureTypesList.length >= 2 ? "satisfied" : failureTypesList.length > 0 ? "partial" : "missing",
      evidenceFiles: [files.jitoBundleFailures],
      command: "pnpm bundle:fault-expired && pnpm bundle:fault-compute && pnpm bundle:fault-invalid-tip",
      notes: failureTypesList.length === 0 ? "No controlled bundle failure classifications found." : failureTypesList.join(", ")
    },
    {
      requirement: "Retry with blockhash refresh",
      status: hasRefreshBlockhashRetry(input.decisions) ? "satisfied" : "partial",
      evidenceFiles: [files.agentDecisions, files.autonomousRecovery],
      command: "pnpm agent:diagnose && pnpm demo:retry",
      notes: "Scored agent decision selects refresh_blockhash_and_retry when expired_blockhash evidence is present."
    },
    {
      requirement: "10 real bundle submissions",
      status: completed >= 10 && landed >= 10 && finalized >= 10 ? "satisfied" : "partial",
      evidenceFiles: [files.latestSummary, files.jitoBundles, files.evidenceReport],
      command: "pnpm evidence:bundles 10",
      notes: `completed=${completed}, landed=${landed}, finalized_signatures=${finalized}`
    },
    {
      requirement: "At least 2 failure cases",
      status: failureTypesList.length >= 2 ? "satisfied" : failureTypesList.length > 0 ? "partial" : "missing",
      evidenceFiles: [files.jitoBundleFailures],
      command: "pnpm bundle:fault-expired && pnpm bundle:fault-compute",
      notes: failureTypesList.join(", ") || "not available"
    },
    {
      requirement: "AI decision agent",
      status: scoredDecisions > 0 ? "satisfied" : "missing",
      evidenceFiles: [files.agentDecisions],
      command: "pnpm agent:diagnose",
      notes: `scored_policy_decisions=${scoredDecisions}`
    },
    {
      requirement: "README questions",
      status: readmeQuestionsSatisfied ? "satisfied" : "missing",
      evidenceFiles: [files.readme],
      command: "open README.md",
      notes: readmeQuestionsSatisfied ? "README includes answers for latency, blockhash commitment, and skipped Jito leader handling." : "Section missing."
    },
    {
      requirement: "Open-source setup",
      status: openSourcePartial && licenseMissing ? "partial" : openSourcePartial ? "satisfied" : "missing",
      evidenceFiles: [files.readme, files.packageJson],
      command: "pnpm install && pnpm build && pnpm test",
      notes: licenseMissing ? "Project setup is documented; license file is not included." : "Project setup is documented."
    },
    {
      requirement: "Stream evidence",
      status: yellowstoneSatisfied ? "satisfied" : (stream?.captured_count ?? 0) > 0 ? "partial" : "missing",
      evidenceFiles: [files.streamSummary, files.streamEvidence],
      command: "pnpm stream:capture",
      notes: `source=${display(stream?.source)}, transport=${display(stream?.transport)}, captured_count=${display(stream?.captured_count)}`
    },
    {
      requirement: "Commitment-stage tracking",
      status: lifecycleEvidence ? "satisfied" : "partial",
      evidenceFiles: [files.jitoBundles, files.evidenceReport],
      command: "pnpm evidence:bundles 10 && pnpm report:evidence",
      notes: "Evidence includes processed, confirmed, finalized lifecycle timing where observable."
    }
  ];

  const risks = [
    "Architecture document public URL still pending if not created yet.",
    "Final Jito bundle evidence was collected on Jito testnet; organizer confirmation may be useful if they strictly require devnet/mainnet.",
    "Native Yellowstone client subscribe was unstable, so real Yellowstone evidence was captured through grpcurl against geyser.Geyser/Subscribe."
  ];

  return [
    "# Competition Compliance Audit",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Overall readiness level: ${readiness(rows)}`,
    `- Main strengths: ${completed}/10 bundle session completed, ${failureTypesList.length} controlled failure classifications, Yellowstone stream evidence source=${display(
      stream?.source
    )} transport=${display(stream?.transport)} captured_count=${display(stream?.captured_count)}.`,
    `- Remaining risks: ${risks.join(" ")}`,
    "",
    "## Requirement Matrix",
    "",
    "| Requirement | Status | Evidence files | Reproduction command | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(matrixRow),
    "",
    "## Evidence Inventory",
    "",
    `- ${files.evidenceReport}: human-readable final evidence report.`,
    `- ${files.latestSummary}: final 10-bundle session summary.`,
    `- ${files.jitoBundles}: raw Jito bundle submission and lifecycle logs; entries=${display(input.bundles?.length)}.`,
    `- ${files.jitoBundleFailures}: controlled Jito bundle failure logs; types=${failureTypesList.join(", ") || "not available"}.`,
    `- ${files.autonomousRecovery}: autonomous expired-blockhash recovery demo logs; entries=${display(input.recovery?.length)}.`,
    `- ${files.agentDecisions}: scored local reasoning decisions; scored_policy_decisions=${scoredDecisions}.`,
    `- ${files.observedJitoLeaders}: learned leaders from landed bundle evidence; observed_count=${display(
      input.observedLeaders?.observed_leader_count
    )}.`,
    `- ${files.streamSummary}: latest live stream summary; source=${display(stream?.source)}, transport=${display(
      stream?.transport
    )}, captured_count=${display(stream?.captured_count)}.`,
    `- ${files.streamEvidence}: raw live slot stream evidence; entries=${display(input.streamEntries?.length)}.`,
    "",
    "## Known Risks",
    "",
    ...risks.map((risk) => `- ${risk}`),
    "",
    "## Next Actions",
    "",
    "- Publish architecture document.",
    "- Final README polish.",
    "- Final demo walkthrough.",
    "- Final submission checklist.",
    ""
  ].join("\n");
}

async function main(): Promise<void> {
  const readme = await readOptionalText(files.readme);
  const packageJson = await readOptionalText(files.packageJson);
  const evidenceReport = await readOptionalText(files.evidenceReport);
  const summary = await readOptionalJson<EvidenceSummary>(files.latestSummary);
  const bundles = await readJsonLines(files.jitoBundles);
  const bundleFailures = await readJsonLines(files.jitoBundleFailures);
  const recovery = await readJsonLines(files.autonomousRecovery);
  const decisions = await readJsonLines(files.agentDecisions);
  const observedLeaders = await readOptionalJson<ObservedJitoLeaders>(files.observedJitoLeaders);
  const streamSummary = await readOptionalJson<StreamSummary>(files.streamSummary);
  const streamEntries = await readJsonLines(files.streamEvidence);
  const report = renderReport({
    readme,
    packageJson,
    evidenceReport,
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
