import type { JitoBundleSubmitLog } from "../jito/bundle-sender.js";
import type { BundleEvidenceAuditRow, BundleEvidenceSummary } from "./types.js";

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function normalizedBundleStatus(run: JitoBundleSubmitLog): string | null {
  return run.bundle_status?.final_bundle_status ?? null;
}

function hasLandedSlot(run: JitoBundleSubmitLog): boolean {
  return run.bundle_status?.landed_slot !== undefined && run.bundle_status.landed_slot !== null;
}

export function hasFinalizedSignature(run: JitoBundleSubmitLog): boolean {
  return (
    (run.lifecycle?.finalized_at !== null && run.lifecycle?.finalized_at !== undefined) ||
    run.lifecycle?.finalized_slot !== null && run.lifecycle?.finalized_slot !== undefined
  );
}

export function shouldCountAsLanded(run: JitoBundleSubmitLog): boolean {
  return normalizedBundleStatus(run)?.toLowerCase() === "landed" || hasLandedSlot(run);
}

export function shouldCountAsFailed(run: JitoBundleSubmitLog): boolean {
  const status = normalizedBundleStatus(run)?.toLowerCase();
  return status === "failed" || status === "invalid" || run.failure?.type === "bundle_failure";
}

function hasAnySignatureObservation(run: JitoBundleSubmitLog): boolean {
  return (
    (run.lifecycle?.processed_at !== null && run.lifecycle?.processed_at !== undefined) ||
    (run.lifecycle?.confirmed_at !== null && run.lifecycle?.confirmed_at !== undefined) ||
    hasFinalizedSignature(run)
  );
}

function transactionLifecycleCount(run: JitoBundleSubmitLog): number {
  return run.transaction_lifecycles?.length ?? 0;
}

function allBundleSignaturesFinalized(run: JitoBundleSubmitLog): boolean | null {
  return run.all_bundle_signatures_finalized ?? null;
}

function tipSignatureFinalized(run: JitoBundleSubmitLog): boolean | null {
  return run.tip_signature_finalized ?? null;
}

export function auditBundleEvidenceRun(run: JitoBundleSubmitLog): BundleEvidenceAuditRow {
  const status = normalizedBundleStatus(run);
  const statusLower = status?.toLowerCase();
  const lifecycleFinalized = hasFinalizedSignature(run);
  const shouldLand = shouldCountAsLanded(run);
  const shouldFail = shouldCountAsFailed(run);
  const submissionPath = "submission_path" in run ? run.submission_path : null;
  const rpcRebroadcast = "rpc_rebroadcast" in run ? run.rpc_rebroadcast : null;
  const missingSubmissionMetadata = submissionPath === null || rpcRebroadcast === null;
  const wrongSubmissionPath = !missingSubmissionMetadata && submissionPath !== "jito_only";
  const rebroadcastedThroughRpc = !missingSubmissionMetadata && rpcRebroadcast !== false;
  const cleanJitoOnlyPath = submissionPath === "jito_only" && rpcRebroadcast === false;
  const bundleFailedOrInvalid = statusLower === "failed" || statusLower === "invalid" || run.failure?.type === "bundle_failure";
  const operationalAmbiguity = bundleFailedOrInvalid && lifecycleFinalized && cleanJitoOnlyPath;
  const allSignaturesFinalized = allBundleSignaturesFinalized(run);
  const tipFinalized = tipSignatureFinalized(run);
  const workloadFinalizedButTipMissing =
    bundleFailedOrInvalid && lifecycleFinalized && tipFinalized === false && cleanJitoOnlyPath;
  const invalidWithAllSignaturesFinalized =
    bundleFailedOrInvalid && allSignaturesFinalized === true && cleanJitoOnlyPath;
  const landedStatusWithFailure = shouldLand && run.failure !== null;
  const landedWithoutSignatureObservation = shouldLand && !hasAnySignatureObservation(run);
  const reasons = [
    missingSubmissionMetadata ? "Missing submission_path or rpc_rebroadcast metadata." : null,
    wrongSubmissionPath ? `submission_path is ${submissionPath ?? "missing"}, expected jito_only.` : null,
    rebroadcastedThroughRpc ? "rpc_rebroadcast is not false." : null,
    landedStatusWithFailure ? "Bundle status is landed, but failure is not null." : null,
    landedWithoutSignatureObservation
      ? "Bundle status is landed, but the transaction signature was not observed by lifecycle tracking."
      : null
  ].filter((reason): reason is string => reason !== null);
  const classificationNote = workloadFinalizedButTipMissing
    ? "Bundle invalid; workload signature finalized but tip signature was not observed/finalized."
    : invalidWithAllSignaturesFinalized
      ? "Bundle invalid despite all signatures finalizing; recorded as bundle failure plus finalized signatures."
      : operationalAmbiguity
        ? "Jito reported the bundle as invalid, while the transaction signature finalized. The system records this as bundle failure plus finalized signature, not bundle landing."
        : reasons.length === 0
          ? null
          : reasons.join(" ");

  return {
    run_id: run.run_id,
    evidence_session_id: run.evidence_session_id ?? null,
    bundle_id: run.bundle_id,
    signature: run.transaction_signature,
    submission_path: submissionPath,
    rpc_rebroadcast: rpcRebroadcast,
    final_bundle_status: status,
    landed_slot: run.bundle_status?.landed_slot ?? null,
    timed_out: run.bundle_status?.timed_out ?? false,
    lifecycle_processed: run.lifecycle?.processed_at !== null && run.lifecycle?.processed_at !== undefined,
    lifecycle_confirmed: run.lifecycle?.confirmed_at !== null && run.lifecycle?.confirmed_at !== undefined,
    lifecycle_finalized: lifecycleFinalized,
    all_bundle_signatures_finalized: allSignaturesFinalized,
    tip_signature_finalized: tipFinalized,
    transaction_lifecycle_count: transactionLifecycleCount(run),
    submitted_to_finalized_ms: run.lifecycle?.submitted_to_finalized_ms ?? null,
    failure_type: run.failure?.type ?? null,
    failure_message: run.failure?.message ?? null,
    bundle_landed: shouldLand,
    bundle_failed: shouldFail,
    signature_finalized: lifecycleFinalized,
    code_inconsistent: reasons.length > 0,
    operational_ambiguity: operationalAmbiguity,
    classification_note: classificationNote,
    should_count_as_landed: shouldLand,
    should_count_as_failed: shouldFail,
    missing_submission_metadata: missingSubmissionMetadata,
    inconsistent: reasons.length > 0,
    inconsistency_reason: reasons.length === 0 ? null : reasons.join(" ")
  };
}

export function summarizeBundleEvidence(
  requestedCount: number,
  runs: JitoBundleSubmitLog[],
  options: { evidenceSessionId: string; evidenceProfile: string | null; startedAt: string; finishedAt: string }
): BundleEvidenceSummary {
  const tips = runs.map((run) => run.tip_lamports);
  const submittedToProcessed = runs
    .map((run) => run.lifecycle?.submitted_to_processed_ms)
    .filter((value): value is number => value !== null && value !== undefined);
  const submittedToConfirmed = runs
    .map((run) => {
      const submittedToProcessedMs = run.lifecycle?.submitted_to_processed_ms;
      const processedToConfirmedMs = run.lifecycle?.processed_to_confirmed_ms;

      if (submittedToProcessedMs === null || submittedToProcessedMs === undefined) {
        return null;
      }

      if (processedToConfirmedMs === null || processedToConfirmedMs === undefined) {
        return null;
      }

      return submittedToProcessedMs + processedToConfirmedMs;
    })
    .filter((value): value is number => value !== null);
  const submittedToFinalized = runs
    .map((run) => run.lifecycle?.submitted_to_finalized_ms)
    .filter((value): value is number => value !== null && value !== undefined);
  const failuresByType: BundleEvidenceSummary["failures_by_type"] = {};
  const auditRows = runs.map(auditBundleEvidenceRun);
  const notes = auditRows
    .filter((row) => row.classification_note !== null)
    .map((row) => `${row.run_id}: ${row.classification_note}`);

  for (const run of runs) {
    if (run.failure && shouldCountAsFailed(run)) {
      failuresByType[run.failure.type] = (failuresByType[run.failure.type] ?? 0) + 1;
    }
  }

  return {
    evidence_session_id: options.evidenceSessionId,
    evidence_profile: options.evidenceProfile,
    requested_count: requestedCount,
    completed_count: runs.length,
    bundle_landed_count: auditRows.filter((row) => row.bundle_landed).length,
    bundle_failed_count: auditRows.filter((row) => row.bundle_failed).length,
    bundle_invalid_count: auditRows.filter((row) => row.final_bundle_status?.toLowerCase() === "invalid").length,
    bundle_timed_out_count: runs.filter((run) => run.bundle_status?.timed_out === true).length,
    signature_finalized_count: auditRows.filter((row) => row.signature_finalized).length,
    signature_not_observed_count: auditRows.filter(
      (row) => !row.lifecycle_processed && !row.lifecycle_confirmed && !row.lifecycle_finalized
    ).length,
    all_bundle_signatures_finalized_count: auditRows.filter((row) => row.all_bundle_signatures_finalized === true).length,
    tip_signature_finalized_count: auditRows.filter((row) => row.tip_signature_finalized === true).length,
    code_inconsistent_count: auditRows.filter((row) => row.code_inconsistent).length,
    operational_ambiguity_count: auditRows.filter((row) => row.operational_ambiguity).length,
    landed_count: auditRows.filter((row) => row.should_count_as_landed).length,
    failed_count: auditRows.filter((row) => row.should_count_as_failed).length,
    timed_out_count: runs.filter((run) => run.bundle_status?.timed_out === true).length,
    inconsistent_count: auditRows.filter((row) => row.code_inconsistent).length,
    finalized_signature_count: auditRows.filter((row) => row.lifecycle_finalized).length,
    landed_bundle_count: auditRows.filter((row) => row.final_bundle_status?.toLowerCase() === "landed").length,
    invalid_bundle_count: auditRows.filter((row) => row.final_bundle_status?.toLowerCase() === "invalid").length,
    average_submitted_to_processed_ms: average(submittedToProcessed),
    average_submitted_to_confirmed_ms: average(submittedToConfirmed),
    average_submitted_to_finalized_ms: average(submittedToFinalized),
    tip_lamports_min: tips.length === 0 ? null : Math.min(...tips),
    tip_lamports_max: tips.length === 0 ? null : Math.max(...tips),
    bundle_ids: runs.flatMap((run) => (run.bundle_id ? [run.bundle_id] : [])),
    signatures: runs.map((run) => run.transaction_signature),
    failures_by_type: failuresByType,
    started_at: options.startedAt,
    finished_at: options.finishedAt,
    notes
  };
}
