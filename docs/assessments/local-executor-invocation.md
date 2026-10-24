# Local Queue And Durable Inspection Replay

Status: **local-only proof; hosted activation blocked**. Date: 2026-10-24.
Base: `63d7858` on `codex/hosted-executor-preflight`.

## Boundary

The existing isolated Cloudflare runtime probe now hosts a separate
`CeireanLocalInvocation` stack. It uses local ingress/dead-letter queues, a Worker
and a SQLite-backed `InspectionReplay` Durable Object. The original ledger proof
and the operational/native application ledger are unchanged.

The executor workspace exports only the private schemas/verification/replay
entrypoints needed by that runtime probe; a workspace-only dependency links them.
No external dependency versions, lint policies or declaration exceptions changed.
The existing local-runtime probe's declaration setting remains as previously
approved; executor source still uses strict declaration checking.

`invocation.alchemy.ts` refuses non-dev assembly before resources and requires
the isolated-test flag. The Worker has workers.dev/previews disabled, no domain
or route, and a loopback dev address. Test children have an isolated HOME/state
directory and a sanitized environment containing only synthetic public policy.
Real Cloudflare/GitHub/model tokens, root dotenv and operator PEMs are not read.

The HTTP bridge is **local test instrumentation**, not a hosted private control
API. It can publish only to the local bound queue, inspect the fixed test scope,
or inject transactional/corruption faults. Request streaming is bounded to 128 KiB.
Do not promote this bridge or its fault hooks to deployment. Actual private
Cloudflare REST publication/authentication is still unverified.

## Replay Semantics

Both the consumer and DO verify the signed immutable inspection envelope against
independent configured trust. Invalid/expired messages are refused before the
consumer calls the DO. Routing is derived from the verified worksheet, not a
Queue message ID or sender-selected object name. The DO rechecks authorization
before any storage write. All outcomes retain activation `Blocked`.

One receipt is retained per namespace/session. Empty state records once; an exact
operation/digest redelivery returns `Replay`; changed content under that operation
is `Conflict`; another operation is `Busy`; foreign sessions cannot replace it.
There is no release/reset or executor capability. This protects inspection
recording only, not production execution ownership across arbitrary namespaces.

SQLite state and its one event commit synchronously in one transaction. Reads
validate schema, bounded row counts and state/event agreement; observed corruption
fails closed, without resetting the slot. A deliberately injected failure between
state and event demonstrates rollback. The consumer acknowledges only after the
DO returns a durable result. A deliberate post-commit acknowledgement failure
causes actual local Queue redelivery, which must return a reference rather than
record again. In-memory metrics are diagnostic only, never replay authority.

## Pinned Runtime Findings

The installed workerd rejects compatibility dates newer than **2026-10-09**.
This local Worker uses that newest supported date, not an Alchemy/workerd upgrade
or a claim of testing later compatibility behavior.

Declaring the same JSON Config binding explicitly in `env` and implicitly through
the Effect initializer failed runtime String decoding in this pinned version.
The documented implicit Config binding alone passed. The test checks real Worker
startup and signed Queue delivery; no validation was weakened. Temporary binding
diagnostics were removed and no config values are logged.

## Verification

Replay unit/property tests initially failed 0/4 against the placeholder policy.
The routing proof test also failed against a placeholder. Actual runtime wiring
then reached the expected missing-store failure after the compatibility/config
setup issues above were diagnosed. The implemented local suite passes guard,
rollback, duplicate/concurrent publication, lost acknowledgement, conflict, busy,
expiry, corruption and complete separate-process restart checks.

The seeded runtime is closed and its recorded child processes reaped before a
different process opens the same retained local store. The new process reads the
original record before redelivery, then observes `Replay` with zero new records.
This is not simulated persistence within one Ref or one workerd instance.

Independent review found no blocking security or correctness issues. It also
independently ran the focused tests and full local runtime runner. Three remaining
test gaps are deliberately not claimed as proof: overlapping same-object RPC
admission (the Queue consumer is serialized), direct DO refusal of invalid or
expired envelopes independently of consumer refusal, and runtime rejection of
oversized/malformed-UTF-8 bridge bodies. These are follow-up hardening coverage,
not hosted readiness. Pure replay laws cover 300 generated sequences.

Final repository-wide measurements:

- `bun --no-env-file run check`: exit 0, universal lint and format (403 files).
- `moon run :typecheck --concurrency 1`: exit 0, all 12 workspace tasks.
- `moon run :test --concurrency 1`: exit 0, all 12 tasks in 10m 8.642s,
  including all four invocation phases and the original seven ledger phases.
- Native refinement retained all 3000 generated cases; owned local runtime
  processes were reaped after every generation, including expected-failure cases.
- Frozen offline install with lifecycle scripts disabled: exit 0, no version
  changes. The lockfile adds only the private workspace dependency edge.
- `git diff --check`: exit 0.

The proposed hosted image, payloads, private invocation entitlement,
remote deadlines/cancellation, provider caps and session/build approvals remain
unresolved. No deployment, spending, merge, push or operational activation.
