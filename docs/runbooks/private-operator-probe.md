# Private Operator Probe Qualification

**Result:** the application contract, local native RPC path and patched acquisition
ownership pass local qualification. The complete hosted transport is still
**not qualified**. No remote session, deployment, route, webhook action,
admission or container execution occurred during these qualification slices.

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

## Concrete Hosted Blockers

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
   revocation. The preview bridge's service binding is broader than a server-
   enforced readiness/status allowlist; its token is a credential.
4. The previously deployed source `9e5fae7` lacks readiness. Even a working
   transport cannot establish current desired-policy readiness until an approved
   private target update, with expired admission and the consumed ledger intact.

Cloudflare's [service-binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
does not require a public HTTP endpoint. That does not make a newly created
preview bridge a read-only management operation.

The unqualified remote entrypoint was removed before commit. There is no hosted
operator command to accidentally invoke. Existing `CF_TOKEN`, webhook secret,
App key, protected deployment state and cloud resources were not read or changed
for this qualification.

## Next Bounded Decision

Prepare the fixed-target, single-use remote operator boundary with sanitized
CLI-output tests and its runtime layer inside the overall deadline. Keep it
disabled by default. Then explicitly approve the authenticated preview
capability/upload and private target update together; verify desired-policy
readiness and retained status while target routes, workers.dev, previews and
GitHub webhooks stay disabled. The preview token's lifetime/revocation limitation
must remain explicit. A fresh timeboxed hosted rehearsal is a separate later
approval; this ownership fix authorizes no hosted operation.
