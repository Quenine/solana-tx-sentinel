# Competition Compliance Audit

Generated at: 2026-06-15T23:03:31.296Z

## Summary

- Evidence session ID: 297d1dc7-dc1d-44dd-9bc2-f0aed3d26cd3
- Final bundle submissions completed: 10
- Landed bundles: 10
- Finalized signatures: 10
- Controlled failure types: bundle_failure:invalid_tip_account, compute_exceeded, expired_blockhash
- Live stream evidence: source=yellowstone, transport=grpcurl, captured_count=25

## Requirement Matrix

| Requirement | Status | Evidence |
| --- | --- | --- |
| At least 10 real bundle submissions | satisfied | completed=10, landed=10, finalized_signatures=10 |
| At least 2 controlled failure cases | satisfied | bundle_failure:invalid_tip_account, compute_exceeded, expired_blockhash |
| Yellowstone/Geyser live slot stream | satisfied | source=yellowstone, transport=grpcurl, captured_count=25 |
| Jito-only bundle submission evidence | satisfied | 51 bundle log entries in data/lifecycle/jito-bundles.jsonl |
| Transaction and bundle lifecycle tracking | satisfied | evidence_report=present, finalized_signatures=10 |
| Failure classification | satisfied | bundle_failure:invalid_tip_account, compute_exceeded, expired_blockhash |
| AI operational decision ownership | satisfied | scored local decisions=3 |
| Autonomous recovery evidence | satisfied | autonomous recovery entries=2 |
| Observed Jito leader timing evidence | satisfied | observed_jito_leader_count=2 |

## Evidence Inventory

- docs/evidence-report.md: present
- data/lifecycle/latest-evidence-summary.json: present
- data/lifecycle/jito-bundles.jsonl: present, entries=51
- data/lifecycle/jito-bundle-failures.jsonl: present, entries=4
- data/lifecycle/autonomous-recovery.jsonl: present, entries=2
- data/lifecycle/agent-decisions.jsonl: present, entries=5
- data/lifecycle/observed-jito-leaders.json: present
- data/stream/latest-stream-evidence-summary.json: present
- data/stream/slot-stream-evidence.jsonl: present, entries=75

## Known Risks

- Yellowstone evidence is present via transport=grpcurl.
- Native @triton-one/yellowstone-grpc subscribe is not claimed as working unless separately captured; grpcurl transport is documented for Solinfra Subscribe evidence.
- Testnet Jito Block Engine behavior may differ from mainnet.
- Controlled failures are logged separately from the successful 10/10 final session.

## Next Actions

- Keep the latest Yellowstone stream summary and raw JSONL in the submission package.
- Run `pnpm report:evidence` and `pnpm report:compliance` after any new evidence capture.
- Do not edit historical evidence logs; append new runs instead.
