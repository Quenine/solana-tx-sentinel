# Solana Tx Sentinel

Solana Tx Sentinel is an AI-assisted Solana transaction reliability stack for Jito bundle submission and lifecycle tracking. It builds and simulates signed bundle transactions, submits them through the Jito Block Engine only, tracks bundle and signature lifecycle outcomes, classifies failures, and uses a local scored reasoning agent to demonstrate retry recovery from an expired blockhash.

## What It Does

- Streams live slots
- Tracks leader schedule
- Learns observed Jito-compatible leaders from landed bundle evidence
- Builds Jito bundles
- Calculates dynamic tips from recent prioritization fees
- Adds compute budget priority fee
- Simulates signed transactions before bundle submission
- Submits through Jito Block Engine only
- Tracks bundle status and transaction lifecycle
- Classifies failures
- Uses a local scored reasoning agent for retry decisions
- Demonstrates autonomous recovery from expired blockhash

## Final Evidence Summary

- Evidence session ID: `297d1dc7-dc1d-44dd-9bc2-f0aed3d26cd3`
- Network: `testnet`
- Requested: `10`
- Completed: `10`
- Landed bundles: `10`
- Finalized signatures: `10`
- Failed bundles: `0`
- Invalid bundles: `0`
- Code inconsistencies: `0`
- Average submitted to processed: `7011 ms`
- Average submitted to confirmed: `7237 ms`
- Average submitted to finalized: `15734 ms`

## Key Evidence Files

- `docs/evidence-report.md`
- `data/lifecycle/latest-evidence-summary.json`
- `data/lifecycle/jito-bundles.jsonl`
- `data/lifecycle/jito-bundle-failures.jsonl`
- `data/lifecycle/autonomous-recovery.jsonl`
- `data/lifecycle/devnet-failures.jsonl`
- `data/lifecycle/agent-decisions.jsonl`
- `data/lifecycle/observed-jito-leaders.json`
- `data/stream/slot-stream-evidence.jsonl`
- `data/stream/latest-stream-evidence-summary.json`

## How To Run

```bash
pnpm install
cp .env.example .env
```

Configure `.env` with the wallet path, Solana RPC/WS endpoints, and Jito Block Engine URL.

```bash
pnpm check:rpc
pnpm check:jito
pnpm stream:capture
pnpm leaders:learn-jito
pnpm config:final
pnpm bundle:preview
pnpm bundle:send
pnpm evidence:bundles 10
pnpm report:evidence
```

Controlled Jito bundle failure cases are logged separately and do not modify the successful final evidence session:

```bash
pnpm bundle:fault-expired
pnpm bundle:fault-compute
pnpm bundle:fault-invalid-tip
pnpm report:evidence
```

## Final Profile Config

```text
NETWORK=testnet
JITO_BLOCK_ENGINE_URL=https://testnet.block-engine.jito.wtf
SLOT_STREAM_SOURCE=solana_ws
BUNDLE_LAYOUT=combined_tip_instruction
EVIDENCE_PROFILE=final
ENABLE_SUBMISSION_TIMING=true
ENABLE_OBSERVED_JITO_LEADERS=true
MIN_JITO_TIP_LAMPORTS=100000
MAX_JITO_TIP_LAMPORTS=300000
PRIORITY_FEE_MICRO_LAMPORTS=200000
COMPUTE_UNIT_LIMIT=200000
BUNDLE_STATUS_TIMEOUT_MS=45000
BUNDLE_STATUS_POLL_INTERVAL_MS=1500
STOP_ON_FIRST_INVALID=false
```

## Stream Source Configuration

Yellowstone/Geyser is the preferred competition path for live slot evidence. Configure it when provider credentials are available:

```text
SLOT_STREAM_SOURCE=yellowstone
YELLOWSTONE_GRPC_ENDPOINT=https://your-yellowstone-endpoint
YELLOWSTONE_GRPC_TOKEN=your-token
YELLOWSTONE_COMMITMENT=processed
STREAM_EVIDENCE_EVENT_COUNT=25
STREAM_RECONNECT_MAX_ATTEMPTS=5
STREAM_RECONNECT_BACKOFF_MS=1000
```

For local development, set `SLOT_STREAM_SOURCE=solana_ws`. `pnpm stream:capture` writes stream evidence to `data/stream/slot-stream-evidence.jsonl` and `data/stream/latest-stream-evidence-summary.json`. The report should only be read as Yellowstone evidence when the summary file has `"source": "yellowstone"`.

## Important Implementation Note

The bundle status poller does not treat the first inflight `Invalid` response as terminal. It keeps polling both inflight and final bundle status until `Landed`, final status confirmation, or timeout. This matters because the successful final evidence session showed bundle status can move from early `Invalid` or `Pending` observations to `Landed`.

## Failure And AI Recovery

The devnet fault injection signs a transaction with an expired blockhash and records the resulting failure. The classifier identifies this as `expired_blockhash`. The local scored reasoning agent evaluates multiple candidate actions, selects `refresh_blockhash_and_retry`, and returns `refresh_blockhash=true` with `resubmit=true`. The autonomous recovery runner follows that selected decision, rebuilds the transaction with a fresh blockhash, resubmits it, tracks lifecycle stages, and persists the recovery log.

OpenAI is not required for the submitted demo. The decision layer is isolated behind an agent interface and can be extended to another provider without changing the recovery runner contract.

Controlled Jito bundle failure evidence is written to `data/lifecycle/jito-bundle-failures.jsonl`. `pnpm bundle:fault-expired` waits for a signed combined-tip bundle transaction blockhash to expire, then submits the stale transaction through Jito `sendBundle` only. `pnpm bundle:fault-compute` builds a combined-tip bundle with a deliberately low compute unit limit, records the failed simulation, and only submits through Jito when `SUBMIT_BUNDLE_ON_SIMULATION_FAILURE=true`. `pnpm bundle:fault-invalid-tip` uses a valid Solana public key that is not in the current Jito tip account set, then records whether Jito rejects, times out, fails, or unexpectedly lands the bundle.

The expired-blockhash case may be rejected before bundle acceptance and may not produce a `bundle_id`. The invalid-tip and compute-exceeded cases provide additional controlled Jito bundle failure evidence while staying separate from the successful 10/10 final session.

`pnpm agent:diagnose` reads failure evidence in this order: controlled Jito bundle failures first, then devnet transaction failures. It prefers `expired_blockhash` entries and records the selected source file in `data/lifecycle/agent-decisions.jsonl`. The autonomous retry demo still uses the devnet recovery path; it does not fake Jito recovery.

## Architecture Overview

```text
Wallet -> Bundle Builder -> Simulation -> Jito Block Engine
Yellowstone/Solana WS Slot Stream -> Leader Tracker -> Timing Controller
Recent Fees -> Tip Engine
Bundle Status Poller -> Lifecycle Tracker -> Evidence Logs
Failure Classifier -> Scored Reasoning Agent -> Recovery Runner
```

## README Judging Questions

- The `processed_at` to `confirmed_at` delta shows propagation and confirmation latency after the transaction is first processed.
- Do not fetch a blockhash at `finalized` for time-sensitive transactions because finalized commitment lags and can reduce usable blockhash lifetime.
- If the Jito leader skips the slot, refresh the blockhash, recalculate the tip, and resubmit for a later favorable leader window.

## Limitations

- Testnet Block Engine behavior may differ from mainnet.
- Yellowstone/Geyser streaming requires provider credentials. Without them, the project uses `solana_ws` fallback evidence for local development.
- This project does not claim MEV strategy profitability; it focuses on reliability, observability, and recovery.

## License

No license file is currently included.
