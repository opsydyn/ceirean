# Private Operator Probe Qualification

**Result:** the application contract and local native RPC path pass. The proposed
hosted transport is **not qualified**. No remote session, deployment, route,
webhook action, admission or container execution occurred in this slice.

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
HTTP fallback. After scope disposal, the fixture endpoint refuses connections;
the operator proxy endpoint's teardown is not independently asserted. The test
rejects any attempted Cloudflare credential resolution. Native acquisition-
failure/timeout cleanup tests remain open alongside hosted qualification.

Tests cover stale policy, skew during observation, malformed/oversized/wrong-
session status, empty ledger, missing methods, error envelopes, redacted failures
and timeout. An Effect property test varies remote peer identity across 100
cases. No lint suppression, provider patch or dependency upgrade was added; the
already-locked `@alchemy.run/cloudflare-runtime@2.0.0-beta.83` is now declared
directly for its public APIs.

## Concrete Hosted Blockers

Source inspection and independent review of the pinned runtime found:

1. `Service.remote` uses Cloudflare's authenticated ephemeral edge-preview
   session. `RemoteWorker.ts` creates that session and uploads an auxiliary
   executable bridge. This is a remote control-plane write, not a management
   GET. It need not enable the target's workers.dev URL, preview URLs or routes,
   but needs explicit operational scope accepting that upload/capability.
2. `RemoteBindings.ts` starts acquisition with `Effect.forkDetach`. Closing the
   local scope or hitting the timeout does not establish that credential-bearing
   preview creation has stopped. The native local test does not exercise this
   branch. A remote implementation must supervise acquisition before use.
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

Qualify a narrowly scoped acquisition fix (or an existing upstream fixed
version), including cancellation/startup-failure and sanitized CLI-output tests.
Do not replace the product path with a new general infrastructure framework.
Then explicitly approve the authenticated preview capability/upload and private
target update together; verify desired-policy readiness and retained status
while target routes, workers.dev, previews and GitHub webhooks stay disabled.
A fresh timeboxed hosted rehearsal remains a separate later approval.
