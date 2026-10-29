# Private Readiness Follow-Up: 29 October 2026

Scope: one private target update and one authenticated readiness/status check.
No public rehearsal, new session, admission, alarm, container execution, GitHub
comment or redelivery was authorized or performed.

## Source And Deployment

- Committed source: `5f122fe78c518f4b2a189e28ae9d4648ff15625d`.
- A clean `git archive` export was created in an owner-only operational directory.
  Frozen dependencies were installed offline with lifecycle scripts disabled.
  Credentials, `.env`, deployment state and uncommitted research were not copied.
- Pinned Bun 1.4.2 and Alchemy beta.83; existing protected state/profile retained.
- Account: `d95812af050c2e549a3296899b7b43b3`.
- Stack/stage: `CeireanReadOnly` / `smoke-20261029`.
- Worker: `ceireanreadonly-readonlyworker56trhdak554hd5gd7mzqrci7`.
- The 22:24 UTC plan contained exactly one Worker update; DO/container resources
  were unchanged. No create or delete was planned.
- Private apply completed at 22:25:42.214 UTC. Independent readback reported
  deployment `71ec1069-faf5-4592-9605-7e69b34a9cd9`, created at
  `2026-10-29T22:25:39.586621Z`, with version
  `ad6ae8fe-6362-4f45-8346-02e566e7090d` at 100%.
- DO class/namespace remained `ReadOnlyJob` /
  `a2c938f0e2444cb594ce375ad5e87c7a`. Reconciliation reported no new, deleted,
  renamed or transferred classes. No ledger reset or image build/copy occurred.
- Binding-name readback contained neither `CF_TOKEN` nor a GitHub App key.
  Secret bindings were not readable policy evidence; the RPC below provided it.

## Authenticated Observation

One invocation started at 22:27:42.583 UTC and completed successfully by 22:27:48
UTC, exit 0. The approved guard existed only in that child's allowlisted
environment. Implicit dotenv and debug configuration dumping were disabled.
The actual committed command owned the runtime and its cooperative 45-second
deadline. No application retry or wrapper hard timeout occurred.

The command called only `readiness()`, `status()`, then `readiness()`. Its complete
sanitized observation was:

```json
{
  "_tag": "OperatorObservation",
  "protocol": "readonly-policy-v1",
  "policy": {
    "installationId": 173668921,
    "ownerId": 257329185,
    "repositoryId": 1247366304,
    "issueNumber": 57,
    "operatorId": 257329185,
    "sessionId": "readonly-20261029",
    "opensAtMs": 0,
    "closesAtMs": 300000
  },
  "job": {
    "_tag": "Succeeded",
    "sessionId": "readonly-20261029",
    "queuedAtMs": 1793299605229,
    "closesAtMs": 1793299707000,
    "startedAtMs": 1793299605257,
    "runtime": "v22.23.4"
  }
}
```

The Worker checked its DO's protocol/policy; the operator additionally compared
the full descriptor to the local desired expired policy. The original successful
job and timestamps match the [earlier rehearsal](rehearsal-20261029.md) exactly.
The retained job's historical window was not rewritten to match today's expired
admission configuration.

## Exposure And Post-Run State

- Before and after: zero matching target/hostname Worker routes; target
  `workers.dev` and preview URLs both disabled.
- GitHub App settings were observed with Active unchecked and SSL verification
  enabled before the operation. No GitHub settings were changed in this follow-up;
  no fresh post-run reload is claimed.
- Before and after: zero active native instances, with no additional result page.
- Retained instance
  `c7d1d05656b6c9126d6209272c7b63912a8fe2505473cc4b2bcc13e433a725ba`
  remained stopped, exit 0, started at `2026-10-29T18:46:47.048Z` and last
  updated at `2026-10-29T18:46:55.814Z`. No new execution was observed.
- Post-run script registry contained only the target among Ceirean matches;
  `ceirean-private-operator` was not a permanent registered script.
- The operator process exited. A subsequent explicit disabled invocation returned
  exit 2 and only `OperatorRefused` / `Disabled`. No opt-in was persisted.
- No local ingress listener, tunnel connector, Docker/Colima or public route was
  started. Protected operational logs remain local, not committed.

## Limits And Next Gate

The authenticated SDK transport creates an ephemeral preview bridge/capability.
The SDK has no explicit revocation operation or verified server-side token
lifetime. Local disposal, process exit and absence of a permanent registered
script do not prove remote capability revocation. No capability value is in this
record.

This proves point-in-time application protocol/policy agreement and a retained
status read, not native deployment-ID equality or readiness under a future policy.
Accepted-duplicate hosted replay remains unproven. A fresh session/window and
separate activation approval are required before another public rehearsal;
preserve the consumed `readonly-20261029` ledger.

## Repository Verification

After the private observation, `moon run infrastructure:test --concurrency 1`
passed all 93 Bun tests (274 assertions) plus the nine compiled-export Node
acquisition tests. `moon run :typecheck --concurrency 1` passed all 12 workspace
tasks. Root `bun --no-env-file --no-install run check` passed lint and formatting;
all Effect lint rules remain unchanged. These local checks are separate from
the hosted observation above. Unrelated observer research remains uncommitted
and was not included in the operational export or this evidence commit.
