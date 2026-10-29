# Private Operator Probe Qualification

**Result:** the application contract, local native RPC path and patched acquisition
ownership pass local qualification. On 29 October, a separately approved private
target update and one authenticated invocation succeeded against the exact expired
policy and retained successful job. See the
[hosted private-readiness evidence](../evidence/readonly-hosted/private-readiness-20261029.md).
The single-use command still defaults to disabled. No route, webhook, admission
or container execution was activated by that follow-up.

## Qualified Contract

`qualifyReadOnlyOperator(source, desiredPolicy)` calls only `readiness()`,
`status()`, then `readiness()` again. It uses the real Alchemy RPC result decoder,
compares the full desired policy, strictly decodes the retained job (or null),
checks the job's session and refuses skew observed after the ledger read. It has
no HTTP fallback, enqueue, repair, alarm or runtime execution path.

A successful result is a point-in-time observation, not approval to run or an
atomic guarantee against later rollout. An old retained job's window may differ
from the current policy for that same consumed session; the probe does not reset
it. Empty and active ledgers are observations, not permission for admission.

Application replies must be strings of at most 16,384 UTF-16 code units before
JSON decoding. Application calls share a cooperative 15-second budget without
retries. The local transport has a 45-second cooperative budget. These are not
hard process-kill or provider-side cancellation guarantees and cannot prevent
transport buffering a reply before application inspection. Failures retain
only a bounded refusal code, not raw transport details or credentials.

`probeLocalReadOnlyOperator(scriptName, policy)` constructs **only** a local
service binding. It accepts neither a remote binding nor an arbitrary method
selector. The pinned runtime's actual local workerd RPC roundtrip passes without
HTTP fallback. The operator proxy socket is independently checked closed before
the shared runtime's fixture is disposed; that fixture socket is then checked
closed too. The test rejects any attempted Cloudflare credential resolution.

Tests cover stale policy, skew during observation, malformed/oversized/wrong-
session status, empty ledger, missing methods, error envelopes, redacted failures
and timeout. An Effect property test varies remote peer identity across 100
cases. The already-locked `@alchemy.run/cloudflare-runtime@2.0.0-beta.83` is
declared directly for its public APIs and now has the narrow ownership patch
below. No lint suppression, API change or dependency upgrade was added.

## Acquisition Ownership Fix

The Bun patch captures the `RemoteBindingsLive` layer's scope and attaches both
prefetch and fallback acquisition fibers using `Effect.forkIn`. Fallback callers
use acquire/use/release to join that fiber and interrupt/join it if the caller
is canceled, even while the runtime stays open. A request that outlives runtime
disposal cannot keep its acquisition running. The existing transport, preview configuration, result
encoding, caching and public API are unchanged. Source and compiled Node exports
carry the same patch.

Nine real-plugin tests use fake `RemoteWorker` and `Loopback` services to verify:
owner-scope return, startup failure, explicit interruption, a deadline wrapping
the whole owning runtime layer, successful bridge handoff without a second
acquisition, a fallback caller outliving its runtime, caller cancellation while
the runtime stays open, delayed finalizers, and a fallback arriving after
disposal. Scope-close, fallback ownership and caller-cancellation regressions
were observed failing before their respective fixes. Pending acquisition
finalizers finish before the owner returns; releasing
the fake provider afterwards does not complete canceled acquisition or retry it.

The owner is the runtime **layer**, not an individual binding request. The future
single-use operator boundary must provision that layer inside its overall
operation/deadline. Timing out one request while retaining a shared runtime does
not dispose that runtime or cancel every acquisition it owns. Interruption is
cooperative: it is not rollback of an API request already accepted remotely,
revocation of an issued token, or a hard guarantee for noninterruptible providers.

Run `moon run infrastructure:test --concurrency 1` for the Bun infrastructure
suite and its Node acquisition-test prerequisite. The same nine tests execute
through Bun source and Node compiled exports, under the existing pinned runtimes.
All provider calls are fake; no Cloudflare token is supplied to this harness.

## Prepared Command, Disabled By Default

From the Ceirean checkout, this explicit disabled check performs no hosted work:

```sh
CEIREAN_OPERATOR_PREVIEW=disabled bun --no-env-file --no-install \
  packages/infrastructure/src/readonly/operator/main.ts probe
```

It exits 2, leaves stdout empty and emits exactly one JSON refusal on stderr:

```json
{ "_tag": "OperatorRefused", "code": "Disabled" }
```

The workspace also has an `operator:probe` script. Disable implicit dotenv
loading on the parent Bun invocation too; do not rely only on a child command's
`--no-env-file`. The command accepts only the single argument `probe`; there is
no target, arbitrary method, HTTP, retry, watch, deployment or ingress selector.
Unknown arguments exit 64 before evaluating the preview guard.
An enabled invocation also refuses any configured `WORKERD_DUMP_CONFIG` through
Effect Config before policy, credentials or runtime construction: the pinned SDK
otherwise writes full native configuration, including a local bearer token,
outside the output sink and potentially outside the temporary state root.

The only recognized opt-in value is `CEIREAN_OPERATOR_PREVIEW=approved`.
It is an accidental-invocation guard, **not human authorization**. It was set only
in one approved operational child's environment for the hosted check. It was not
written to `.env` or enabled in deployed configuration; the disabled refusal was
checked again afterwards. Each further opt-in needs its own approved scope.
Synthetic tests may use it only with injected fake operations; subprocess tests
remain disabled or refuse invalid arguments before the live operation.

For an approved opt-in, `CEIREAN_OPERATOR_POLICY_FILE` identifies the
desired policy JSON file. The file is read locally, then rejected if its text
exceeds 16,384 UTF-16 code units or fails the strict real `Policy` schema. This
is a validation bound after reading, not a streaming filesystem allocation
limit. Policy validation precedes runtime construction and token resolution.
The existing Effect Config `CF_TOKEN` validator supplies redacted API-token
credentials; no OAuth/profile fallback, webhook secret, App key or Alchemy
deployment state is used. Account and target Worker are pinned in source.

One invocation owns one runtime. Its XDG cache/config/data/state roots are a
fresh temporary directory, explicitly 0700, removed on scoped disposal. No
shared developer registry/cache is used. Abrupt process termination is not proof
of temporary-file cleanup or remote-token revocation. Only readiness/status
RPCs are issued, with the existing desired-policy checks and application budget.

A single **45-second cooperative deadline** wraps argument/guard handling,
policy loading, runtime-layer construction, RPC work, output validation and
runtime disposal. Delayed uninterruptible finalizers are joined before returning,
so cleanup can exceed that deadline; this is not a hard wall-clock process kill.
Tests cover expiry during layer construction, probe work and disposal, failed
probe disposal and fresh ownership on successive synthetic invocations.

Successful output is one strict `OperatorObservation` JSON line with only the
protocol, validated desired policy and retained job/null. It is an observation,
not an activation or readiness authorization. Extra fields and encoded output
over 16,384 bytes are refused; nothing is partially written. Failure stdout is
always empty. Stderr contains only `OperatorRefused` and a finite code: `Usage`,
`Disabled`, `InvalidConfiguration`, `TimedOut`, `Mismatch`, `InvalidStatus`,
`Unavailable` or `InvalidReport`. Success exits 0; operational refusals exit 1.

The boundary disables upstream Effect logs and intercepts native workerd
stdout/stderr before SDK forwarding. The main entrypoint disables automatic
error reporting and writes only the prepared result. Tests check raw defects,
typed errors, output-field leakage, configuration-dump refusal before operation,
a 100-case non-approved-guard property and
real disabled CLI subprocess output. A local workerd subprocess emits stdout
and stderr canaries; the silent runtime is verified to discard both. None of
these tests creates a remote preview or contacts Cloudflare.

## Hosted Transport Scope And Limits

Source inspection and independent review of the pinned runtime found:

1. `Service.remote` uses Cloudflare's authenticated ephemeral edge-preview
   session. `RemoteWorker.ts` creates that session and uploads an auxiliary
   executable bridge. This is a remote control-plane write, not a management
   GET. It need not enable the target's workers.dev URL, preview URLs or routes,
   but needs explicit operational scope accepting that upload/capability.
2. The original `forkDetach` ownership blocker is fixed locally by the pinned
   patch and cancellation tests above. This is not evidence that a real provider
   request was canceled or rolled back, or that hosted transport is ready.
3. The pinned runtime exposes no explicit remote-preview revocation operation
   or verified server-side token lifetime. Local disposal is not proof of remote
   revocation. This limitation remains after the successful private check.
   The preview bridge's service binding is broader than a server-
   enforced readiness/status allowlist; its token is a credential.
4. The old deployed source `9e5fae7` lacked readiness. The approved private update
   to `5f122fe` resolved that blocker without DO migration, fresh admission or
   ledger reset. The real probe compared the full desired expired policy and
   observed the original successful job unchanged. This is not a readiness claim
   for a future policy or session.

Cloudflare's [service-binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
does not require a public HTTP endpoint. That does not make a newly created
preview bridge a read-only management operation.

The earlier unqualified entrypoint was removed; its replacement is the guarded,
disabled-by-default command above. The initial qualification slices were local
only. The later approved hosted check used the protected operational state and
credentials, updated only the existing Worker, and invoked that command once.
No permanent auxiliary operator script was registered in the post-run readback;
this does not establish server-side preview-token revocation.

## Next Bounded Decision

The private target update and authenticated readiness/status check are complete.
Keep the command disabled and preserve the consumed ledger. Accepted-duplicate
delivery without reexecution remains the next bounded hosted proof: select a
fresh session and timebox, prepare it privately, then check that exact desired
policy before any separately approved route/webhook activation. The preview
token's lifetime/revocation limitation remains explicit. This runbook authorizes
no further operation.
