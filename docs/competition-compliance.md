# Competition Compliance Audit

Generated at: 2026-06-17T20:39:54.603Z

## Summary

- Overall readiness level: ready with documented constraints
- Main strengths: 10/10 bundle session completed, 3 controlled failure classifications, Yellowstone stream evidence source=yellowstone transport=grpcurl captured_count=25.
- Public architecture document: https://docs.google.com/document/d/1QQVLHkuINdQD3P4VSvLwluTAsynqgvGEfPt_vcSL5LI/edit?usp=sharing
- Remaining documented constraints: Final Jito bundle evidence was collected on Jito testnet. Native Yellowstone client subscribe was unstable, so real Yellowstone evidence was captured through grpcurl against geyser.Geyser/Subscribe. No MEV/profitability claim is made.

## Requirement Matrix

| Requirement | Status | Evidence files | Reproduction command | Notes |
| --- | --- | --- | --- | --- |
| Architecture design document | satisfied | Public architecture document: https://docs.google.com/document/d/1QQVLHkuINdQD3P4VSvLwluTAsynqgvGEfPt_vcSL5LI/edit?usp=sharing, docs/architecture.md, README.md | open docs/architecture.md | Public architecture document is available and local architecture markdown is included. |
| Live slot and leader data | satisfied | data/stream/latest-stream-evidence-summary.json, data/stream/slot-stream-evidence.jsonl, data/lifecycle/observed-jito-leaders.json | pnpm stream:capture && pnpm leaders:learn-jito | stream_source=yellowstone, transport=grpcurl, observed_leaders=2 |
| Yellowstone/Geyser support | satisfied | data/stream/latest-stream-evidence-summary.json, data/stream/slot-stream-evidence.jsonl | SLOT_STREAM_SOURCE=yellowstone_grpcurl pnpm stream:capture | captured_count=25, transport=grpcurl |
| Leader window detection | satisfied | data/lifecycle/observed-jito-leaders.json, data/lifecycle/jito-bundles.jsonl | pnpm leaders:learn-jito | observed_jito_leader_count=2 |
| Jito bundle construction | satisfied | data/lifecycle/jito-bundles.jsonl | pnpm bundle:preview && pnpm bundle:send | Bundle logs include submission_path=jito_only and rpc_rebroadcast=false. |
| Dynamic tip logic | satisfied | docs/evidence-report.md, data/lifecycle/jito-bundles.jsonl | pnpm bundle:preview | Evidence report includes dynamic tip note when bundle evidence is available. |
| Lifecycle tracking | satisfied | docs/evidence-report.md, data/lifecycle/jito-bundles.jsonl | pnpm evidence:bundles 10 | finalized_signatures=10 |
| Failure classification | satisfied | data/lifecycle/jito-bundle-failures.jsonl | pnpm bundle:fault-expired && pnpm bundle:fault-compute && pnpm bundle:fault-invalid-tip | bundle_failure:invalid_tip_account, compute_exceeded, expired_blockhash |
| Retry with blockhash refresh | satisfied | data/lifecycle/agent-decisions.jsonl, data/lifecycle/autonomous-recovery.jsonl | pnpm agent:diagnose && pnpm demo:retry | Scored agent decision selects refresh_blockhash_and_retry when expired_blockhash evidence is present. |
| 10 real bundle submissions | satisfied | data/lifecycle/latest-evidence-summary.json, data/lifecycle/jito-bundles.jsonl, docs/evidence-report.md | pnpm evidence:bundles 10 | completed=10, landed=10, finalized_signatures=10 |
| At least 2 failure cases | satisfied | data/lifecycle/jito-bundle-failures.jsonl | pnpm bundle:fault-expired && pnpm bundle:fault-compute | bundle_failure:invalid_tip_account, compute_exceeded, expired_blockhash |
| AI decision agent | satisfied | data/lifecycle/agent-decisions.jsonl | pnpm agent:diagnose | scored_policy_decisions=3 |
| README questions | satisfied | README.md | open README.md | README includes answers for latency, blockhash commitment, and skipped Jito leader handling. |
| Open-source setup | satisfied | README.md, package.json, LICENSE | pnpm install && pnpm build && pnpm test | Project setup is documented and MIT license file is present. |
| Stream evidence | satisfied | data/stream/latest-stream-evidence-summary.json, data/stream/slot-stream-evidence.jsonl | pnpm stream:capture | source=yellowstone, transport=grpcurl, captured_count=25 |
| Commitment-stage tracking | satisfied | data/lifecycle/jito-bundles.jsonl, docs/evidence-report.md | pnpm evidence:bundles 10 && pnpm report:evidence | Evidence includes processed, confirmed, finalized lifecycle timing where observable. |

## Evidence Inventory

- docs/evidence-report.md: human-readable final evidence report.
- data/lifecycle/latest-evidence-summary.json: final 10-bundle session summary.
- data/lifecycle/jito-bundles.jsonl: raw Jito bundle submission and lifecycle logs; entries=51.
- data/lifecycle/jito-bundle-failures.jsonl: controlled Jito bundle failure logs; types=bundle_failure:invalid_tip_account, compute_exceeded, expired_blockhash.
- data/lifecycle/autonomous-recovery.jsonl: autonomous expired-blockhash recovery demo logs; entries=2.
- data/lifecycle/agent-decisions.jsonl: scored local reasoning decisions; scored_policy_decisions=3.
- data/lifecycle/observed-jito-leaders.json: learned leaders from landed bundle evidence; observed_count=2.
- data/stream/latest-stream-evidence-summary.json: latest live stream summary; source=yellowstone, transport=grpcurl, captured_count=25.
- data/stream/slot-stream-evidence.jsonl: raw live slot stream evidence; entries=75.

## Known Risks

- Final Jito bundle evidence was collected on Jito testnet.
- Native Yellowstone client subscribe was unstable, so real Yellowstone evidence was captured through grpcurl against geyser.Geyser/Subscribe.
- No MEV/profitability claim is made.
