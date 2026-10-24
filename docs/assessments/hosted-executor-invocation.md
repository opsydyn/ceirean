# Executor Invocation Preparation

Status: **offline contract only; hosted activation blocked**.
Base: `aa757ab`; date: 2026-10-24.

Follow-up: the [local Queue/replay proof](local-executor-invocation.md) adds
guarded runtime emulation. The measurements below retain this earlier slice's
offline scope; neither slice qualifies hosted invocation or executor actuation.

The owner approved the private-invocation/offline-runner slice and selected the
signed Queue design. See [the design](../superpowers/specs/2026-10-24-private-executor-invocation-design.md)
for the concrete operator-to-private-Worker transport, alternatives, trust boundary,
required ingress/dead-letter queues and exact remaining gates.

## Delivered Boundary

- Strict signed-worksheet verifier binds identity, current absolute window,
  source/recipe/final-image/toolchain/harness/payload metadata, fixed commands,
  resource tier, bounded allowance and prior cleanup. It does not verify actual
  payload bytes, build provenance, operator identity enrollment or provider caps.
- Domain-separated Ed25519 verification uses an external trusted public key,
  never a worksheet field. Only ephemeral synthetic keys are used in tests.
- An inert `InspectOfflineApproval` Queue envelope shares the verifier. It cannot
  start/cancel/read an executor or acknowledge/publish Queue messages. Duplicate
  inspection is harmless, not proof of durable execution deduplication.
- The runner accepts exact dry-run syntax, bounded regular files and complete
  UTF-8/JSON reads; it rejects final-component symlinks, expanded flags and execution modes.
  Reports contain no file content, signature, key, environment or raw exception.
- The committed policy is unconfigured. No real key/account/session or immutable
  final input inventory has been enrolled. A fully synthetic match is still
  `OfflinePlan`, approval `Matched`, activation `Blocked`; there is no exit 0.

## Measured Verification

Initial red tests: approval 2 failing positive cases, CLI 2 failing cases,
Queue envelope 1 failing positive case against explicit missing implementations.
Existing rejection-only tests also passed the stubs and are not counted as
independent red evidence. The base-image-promotion regression separately failed
with an accepted base digest, then passed after excluding all reviewed input
images from final executor identity.

Independent reviewer Socrates reproduced a BOM exact-byte violation: the decoder
stripped bytes before signature/hash verification. A configured synthetic-policy
regression demonstrated `OfflinePlan` for the incorrectly normalized file, then
passed after preserving BOM bytes for JSON refusal. The regular-file reader was
extracted without changing its I/O contract so this path can be tested directly.

The review's exported-runner bound gap was treated as an important boundary issue:
an oversized worksheet/receipt could reach JSON parsing with unconfigured trust.
The regression first returned `DryRunBlocked`, then passed as `DryRunRefused` after
enforcing character and UTF-8 byte ceilings before parsing either string.

Focused probe verification: **84 pass / 0 fail, 1010 assertions** across ten named
files. This includes 300 new generated exact-byte mutation cases (seeds 0/1/163,
100 each), preserving the previous 1500 probe property cases. Native CLI tests
also cover directories, final-component symlinks, empty/invalid UTF-8 and oversized
receipts, unsupported flags, missing files, redaction and no-dotenv invocation.
Root lint/format and all 12 workspace typechecks pass with unchanged universal
rules and no new declaration exceptions, dependencies or timeout reductions.
Final full serial suite (`moon run :test --concurrency 1`): **12 completed,
exit 0, 9m 0.486s** with all final source/tests present before it started.
The unchanged 3000 native database cases completed in 116500.62ms against their
unchanged 180000ms timeout. All 12 typechecks passed; root lint/format and staged
diff checks passed. No dependency or Alchemy version changed.

Direct negative CLI: a missing approval returned exit 1 and finite
`DryRunRefused`; `--execute` returned exit 64 and `UsageError`. The existing
preparation command still exits 2 with all six blockers, including private
invocation and final image, unchanged. Full local test log:
`/private/tmp/ceirean-private-invocation-tests.log` (not hosted evidence).

Residual nonblocking limits: Queue inputs are decoded JSON, not arbitrary
in-process getters/proxies (which may defect); parent-directory containment and
filesystem race fault-injection are not qualified. Observed short/changed-file
reads fail closed, but those races are not advertised as tested behavior.

## Explicitly Not Delivered

There is no deployed or locally emulated Queue Worker, Alchemy Queue stack,
production signing key, Cloudflare token, real publication, private delivery,
Sandbox adapter, durable execution admission or live cancellation/status/export
path from this work. Pinned beta.83 Queue APIs were inspected in installed source,
not qualified by an SDK compile/deployment. No Alchemy upgrade or SDK install.

Private invocation remains hosted-unverified. Final image and payloads remain
pending, with separate image-build/session approvals required. Listener, tunnel,
webhooks and operational ledger are untouched. No merge or push is authorized.
