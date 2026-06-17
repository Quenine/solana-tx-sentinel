import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const outputPath = "docs/dashboard.html";
const repositoryUrl = "https://github.com/Quenine/solana-tx-sentinel";
const publicArchitectureUrl =
  "https://docs.google.com/document/d/1QQVLHkuINdQD3P4VSvLwluTAsynqgvGEfPt_vcSL5LI/edit?usp=sharing";

const paths = {
  summary: "data/lifecycle/latest-evidence-summary.json",
  bundles: "data/lifecycle/jito-bundles.jsonl",
  failures: "data/lifecycle/jito-bundle-failures.jsonl",
  decisions: "data/lifecycle/agent-decisions.jsonl",
  recovery: "data/lifecycle/autonomous-recovery.jsonl",
  leaders: "data/lifecycle/observed-jito-leaders.json",
  stream: "data/stream/latest-stream-evidence-summary.json",
  evidenceReport: "docs/evidence-report.md",
  architecture: "docs/architecture.md"
};

type JsonObject = Record<string, unknown>;

type Summary = {
  completed_count?: number;
  bundle_landed_count?: number;
  signature_finalized_count?: number;
  bundle_failed_count?: number;
  average_submitted_to_processed_ms?: number | null;
  average_submitted_to_confirmed_ms?: number | null;
  average_submitted_to_finalized_ms?: number | null;
  tip_lamports_min?: number | null;
  tip_lamports_max?: number | null;
  bundle_ids?: string[];
};

type StreamSummary = {
  source?: string;
  transport?: string | null;
  captured_count?: number;
  first_slot?: number | null;
  last_slot?: number | null;
  unique_leader_count?: number;
  started_at?: string;
  finished_at?: string;
};

type Leaders = {
  leaders?: Array<{
    leader?: string;
    landing_count?: number;
  }>;
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

async function readJsonLines(path: string): Promise<JsonObject[]> {
  const text = await readOptionalText(path);

  if (text === null) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonObject);
}

function objectValue(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "not available";
  }

  return String(value);
}

function escapeHtml(value: unknown): string {
  return display(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function short(value: unknown, size = 12): string {
  const text = display(value);

  if (text === "not available" || text.length <= size * 2 + 3) {
    return text;
  }

  return `${text.slice(0, size)}...${text.slice(-size)}`;
}

function card(label: string, value: unknown, detail?: string): string {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(
    value
  )}</div>${detail ? `<div class="detail">${escapeHtml(detail)}</div>` : ""}</div>`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return `<p class="muted">not available</p>`;
  }

  return `<div class="table-wrap"><table><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

function latestFinalBundles(summary: Summary | null, bundles: JsonObject[]): JsonObject[] {
  const ids = new Set(summary?.bundle_ids ?? []);
  const selected = ids.size === 0 ? bundles : bundles.filter((bundle) => ids.has(display(bundle.bundle_id)));

  return selected
    .filter((bundle) => bundle.bundle_id !== null && bundle.bundle_id !== undefined)
    .sort((left, right) => display(right.submitted_at).localeCompare(display(left.submitted_at)))
    .slice(0, 10);
}

function simulationStatus(entry: JsonObject): string {
  const scenario = entry.failure_scenario;

  if (scenario === "expired_blockhash_bundle") {
    return `before_expiry_passed=${display(entry.simulation_passed)}`;
  }

  return `passed=${display(entry.simulation_passed)}`;
}

function rejectedAlternatives(entry: JsonObject): string {
  const selected = entry.selected_action;
  const candidates = Array.isArray(entry.candidate_actions) ? entry.candidate_actions : [];

  return candidates
    .flatMap((candidate): string[] => {
      const item = objectValue(candidate);

      if (!item || item.action === selected) {
        return [];
      }

      return [`${display(item.action)} (${display(item.score)})`];
    })
    .slice(0, 3)
    .join(", ");
}

function link(path: string, label?: string): string {
  return `<a href="${escapeHtml(path.replace(/^docs\//, ""))}">${escapeHtml(label ?? path)}</a>`;
}

function rawLink(path: string): string {
  return `<a href="../${escapeHtml(path)}">${escapeHtml(path)}</a>`;
}

function externalLink(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

function render(input: {
  summary: Summary | null;
  bundles: JsonObject[];
  failures: JsonObject[];
  decisions: JsonObject[];
  recovery: JsonObject[];
  leaders: Leaders | null;
  stream: StreamSummary | null;
  evidenceReportPresent: boolean;
  architecturePresent: boolean;
}): string {
  const generatedAt = new Date().toISOString();
  const bundleRows = latestFinalBundles(input.summary, input.bundles).map((bundle) => {
    const status = objectValue(bundle.bundle_status);
    const lifecycle = objectValue(bundle.lifecycle);

    return [
      short(bundle.bundle_id),
      short(bundle.transaction_signature),
      display(status?.landed_slot),
      display(status?.final_bundle_status),
      display(bundle.tip_lamports),
      display(bundle.submitted_at),
      display(lifecycle?.finalized_at)
    ];
  });
  const failureRows = input.failures.map((entry) => {
    const failure = objectValue(entry.failure);

    return [
      display(failure?.type),
      display(failure?.subtype),
      short(entry.transaction_signature),
      short(entry.bundle_id),
      simulationStatus(entry),
      display(failure?.message)
    ];
  });
  const decisionRows = input.decisions
    .filter((entry) => entry.provider !== undefined || entry.decision_mode !== undefined)
    .sort((left, right) => display(right.created_at).localeCompare(display(left.created_at)))
    .slice(0, 8)
    .map((entry) => [
      display(entry.decision_mode),
      display(entry.selected_action),
      display(entry.confidence),
      display(entry.failure_type),
      rejectedAlternatives(entry) || "not available"
    ]);
  const leaderRows = (input.leaders?.leaders ?? []).map((leader) => [
    display(leader.leader),
    display(leader.landing_count)
  ]);
  const risks = [
    "Jito final bundle evidence was collected on testnet unless mainnet evidence exists.",
    "Native Yellowstone client subscribe was unstable; grpcurl transport was used for Yellowstone/Geyser Subscribe evidence.",
    "No MEV or profitability claim is made."
  ];
  const files = [
    externalLink(repositoryUrl, "GitHub repository"),
    externalLink(publicArchitectureUrl, "Public architecture document"),
    link("docs/dashboard.html", "docs/dashboard.html"),
    input.evidenceReportPresent ? link("docs/evidence-report.md", "docs/evidence-report.md") : "docs/evidence-report.md (missing)",
    link("docs/competition-compliance.md", "docs/competition-compliance.md"),
    input.architecturePresent ? link("docs/architecture.md", "docs/architecture.md") : "docs/architecture.md (missing)",
    rawLink(paths.summary),
    rawLink(paths.bundles),
    rawLink(paths.failures),
    rawLink(paths.decisions),
    rawLink(paths.recovery),
    rawLink(paths.leaders),
    rawLink(paths.stream),
    rawLink("data/stream/slot-stream-evidence.jsonl")
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Solana Tx Sentinel Evidence Dashboard</title>
  <style>
    :root { color-scheme: light; --text: #172026; --muted: #5f6b75; --line: #d8dee4; --bg: #f7f8fa; --panel: #ffffff; --accent: #2457c5; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: var(--text); background: var(--bg); }
    header { padding: 32px 40px 20px; background: var(--panel); border-bottom: 1px solid var(--line); }
    main { padding: 24px 40px 48px; max-width: 1280px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    h2 { margin: 32px 0 12px; font-size: 20px; }
    p { line-height: 1.5; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .subtle, .muted, .detail, .label { color: var(--muted); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 14px; }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: .02em; }
    .value { margin-top: 8px; font-size: 24px; font-weight: 700; }
    .detail { margin-top: 6px; font-size: 13px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 16px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #eef2f6; font-weight: 700; white-space: nowrap; }
    tr:last-child td { border-bottom: 0; }
    ul { margin-top: 8px; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <header>
    <h1>Solana Tx Sentinel</h1>
    <p class="subtle">AI-assisted transaction reliability stack for Jito bundles</p>
    <p class="subtle">Generated at ${escapeHtml(generatedAt)}</p>
  </header>
  <main>
    <section>
      <h2>Final Evidence Summary</h2>
      <div class="cards">
        ${card("completed_count", input.summary?.completed_count)}
        ${card("bundle_landed_count", input.summary?.bundle_landed_count)}
        ${card("signature_finalized_count", input.summary?.signature_finalized_count)}
        ${card("bundle_failed_count", input.summary?.bundle_failed_count)}
        ${card("avg submitted_to_processed", input.summary?.average_submitted_to_processed_ms, "ms")}
        ${card("avg submitted_to_confirmed", input.summary?.average_submitted_to_confirmed_ms, "ms")}
        ${card("avg submitted_to_finalized", input.summary?.average_submitted_to_finalized_ms, "ms")}
        ${card("tip range", `${display(input.summary?.tip_lamports_min)} - ${display(input.summary?.tip_lamports_max)}`, "lamports")}
      </div>
    </section>

    <section>
      <h2>Yellowstone/Geyser Stream Evidence</h2>
      <div class="cards">
        ${card("source", input.stream?.source)}
        ${card("transport", input.stream?.transport)}
        ${card("captured_count", input.stream?.captured_count)}
        ${card("first_slot", input.stream?.first_slot)}
        ${card("last_slot", input.stream?.last_slot)}
        ${card("unique_leader_count", input.stream?.unique_leader_count)}
        ${card("started_at", input.stream?.started_at)}
        ${card("finished_at", input.stream?.finished_at)}
      </div>
      <p class="muted">grpcurl transport connects to geyser.Geyser/Subscribe. This dashboard does not claim native Yellowstone client subscribe evidence.</p>
    </section>

    <section>
      <h2>Bundle Evidence</h2>
      ${table(["bundle_id", "signature", "landed_slot", "final_status", "tip_lamports", "submitted_at", "finalized_at"], bundleRows)}
    </section>

    <section>
      <h2>Failure Evidence</h2>
      ${table(["failure_type", "subtype", "signature", "bundle_id", "simulation", "classification"], failureRows)}
    </section>

    <section>
      <h2>AI Decision Evidence</h2>
      ${table(["decision_mode", "selected_action", "confidence", "failure_type", "rejected alternatives"], decisionRows)}
    </section>

    <section>
      <h2>Observed Jito Leaders</h2>
      ${table(["leader identity", "landing_count"], leaderRows)}
    </section>

    <section>
      <h2>Known Risks</h2>
      <div class="panel"><ul>${risks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")}</ul></div>
    </section>

    <section>
      <h2>Evidence File Links</h2>
      <div class="panel"><ul>${files.map((item) => `<li>${item}</li>`).join("")}</ul></div>
    </section>
  </main>
</body>
</html>
`;
}

async function main(): Promise<void> {
  const summary = await readOptionalJson<Summary>(paths.summary);
  const bundles = await readJsonLines(paths.bundles);
  const failures = await readJsonLines(paths.failures);
  const decisions = await readJsonLines(paths.decisions);
  const recovery = await readJsonLines(paths.recovery);
  const leaders = await readOptionalJson<Leaders>(paths.leaders);
  const stream = await readOptionalJson<StreamSummary>(paths.stream);
  const evidenceReport = await readOptionalText(paths.evidenceReport);
  const architecture = await readOptionalText(paths.architecture);
  const html = render({
    summary,
    bundles,
    failures,
    decisions,
    recovery,
    leaders,
    stream,
    evidenceReportPresent: evidenceReport !== null,
    architecturePresent: architecture !== null
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown dashboard generation error";
  console.error(`Dashboard generation failed: ${message}`);
  process.exitCode = 1;
});
