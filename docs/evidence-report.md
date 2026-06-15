# Solana Tx Sentinel Evidence Report

Generated at: 2026-06-15T22:54:31.796Z

## Evidence Session

- Evidence session ID: not available
- Network: not available
- Started at: not available
- Finished at: not available

## Bundle Submission Summary

- Requested count: not available
- Completed count: not available
- Bundle landed count: not available
- Signature finalized count: not available
- Bundle failed count: not available
- Bundle invalid count: not available
- Bundle timed out count: not available
- Code inconsistent count: not available
- Operational ambiguity count: not available

## Final Bundle Submissions

not available

## Average Latency Summary

- Average submitted to processed: not available ms
- Average submitted to confirmed: not available ms
- Average submitted to finalized: not available ms

## Tip Range

- Minimum tip: not available lamports
- Maximum tip: not available lamports

## Live Slot Stream Evidence

- Source: yellowstone
- Transport: grpcurl
- Requested count: 25
- Captured count: 25
- First slot: 426728541
- Last slot: 426728565
- Unique leader count: 6
- Started at: 2026-06-15T22:52:20.226Z
- Finished at: 2026-06-15T22:52:32.536Z
- Note: Captured through grpcurl against geyser.Geyser/Subscribe using Solinfra Yellowstone gRPC.

## Failure Evidence Summary

- Expired blockhash fault injection: not available
- Autonomous retry recovery: not available
- Bundle failure classification: none recorded in the selected final evidence session.

## Controlled Jito Bundle Failure Evidence

not available

The expired-blockhash case may be rejected before bundle acceptance; invalid-tip and compute-exceeded cases are used as additional Jito bundle failure evidence.

## AI Decision Evidence

not available

The local reasoning agent evaluates multiple candidate recovery actions and the recovery runner follows the selected decision.
Older pre-scored local decisions are retained in raw logs but omitted from this table.

## Notes

- Jito-only submission path: not available.
- RPC rebroadcast: not available.
- Bundle status polling: every observation is recorded; early inflight Invalid is not treated as final when later Landed/final status data arrives. Example final_status_source: not available.
- Dynamic tip calculation: not available
- Observed leader timing: not available
- Stale-blockhash bundle failures may be rejected before a bundle_id is produced.
