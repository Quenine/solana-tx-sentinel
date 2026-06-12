import { readFile } from "node:fs/promises";

import { auditBundleEvidenceRun } from "../evidence/evidence-summary.js";
import type { JitoBundleSubmitLog } from "../jito/bundle-sender.js";
import { jitoBundleLogPath } from "../lifecycle/log-writer.js";

function parseCount(value: string | undefined): number {
  if (value === undefined) {
    return 15;
  }

  const count = Number(value);

  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error("Audit count must be a positive integer.");
  }

  return count;
}

async function readBundleLogs(): Promise<JitoBundleSubmitLog[]> {
  const content = await readFile(jitoBundleLogPath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as JitoBundleSubmitLog;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parse error";
      throw new Error(`Could not parse ${jitoBundleLogPath} line ${index + 1}: ${message}`);
    }
  });
}

async function main(): Promise<void> {
  const count = parseCount(process.argv[2]);
  const runs = await readBundleLogs();
  const selected = runs.slice(-count);
  const entries = selected.map(auditBundleEvidenceRun);
  const codeInconsistent = entries.filter((entry) => entry.code_inconsistent);
  const operationalAmbiguous = entries.filter((entry) => entry.operational_ambiguity);

  console.log(
    JSON.stringify(
      {
        source: jitoBundleLogPath,
        requested_count: count,
        audited_count: entries.length,
        code_inconsistent_count: codeInconsistent.length,
        operational_ambiguity_count: operationalAmbiguous.length,
        entries
      },
      null,
      2
    )
  );

  if (codeInconsistent.length > 0) {
    console.error(`Found ${codeInconsistent.length} code-inconsistent bundle log entries.`);
  }

  if (operationalAmbiguous.length > 0) {
    console.error(`Found ${operationalAmbiguous.length} operationally ambiguous bundle log entries.`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bundle log audit error";
  console.error(`Bundle log audit failed: ${message}`);
  process.exitCode = 1;
});
