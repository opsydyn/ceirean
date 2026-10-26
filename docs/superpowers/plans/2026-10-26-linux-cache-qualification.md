# Standalone Linux Cache Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an offline-tested qualification harness and unpublished manual workflow that can later establish fresh, script-disabled Linux Bun installation from an isolated native cache.

**Architecture:** A trusted host controller stages independently verified inputs and owns Docker supervision. A bundled Node harness admits archives, serves an exact loopback allowlist, seals Bun-created cache state and runs isolated cases. Qualification receipts never authorize hosted activation.

**Tech Stack:** Effect 4.0.5, TypeScript, controller Bun 1.4.2, installer Bun 1.3.11, Node 22.23.4, existing npm 10.9.9 tar parser, Docker, GitHub-hosted Ubuntu 24.04 amd64.

**Spec:** [Approved design](../specs/2026-10-24-linux-cache-consumer-design.md). Owner accepted the design on 2026-10-26. Implementation, publication and execution are separate approvals.

## Global Constraints

- Hosted approval remains `Option.none()`; Alchemy migration stays paused.
- Do not modify historical source revision `b7484cb46e66b162c8afddcfba235c9507b4f0ab`, tree `8fcd5b7960541679a163dcbfbf60393e1e256241`, inventory SHA-256 `d416b758e7410ad2069120b58df9272bed86c4ef9d24a3088d4904e46d7308cb`, dependencies or baseline command pins.
- Fixed qualification argv: `bun install --frozen-lockfile --ignore-scripts --backend=copyfile --registry=http://127.0.0.1:4873`.
- No consumer build/test/import, package binaries, native postinstall, browser, npm profile, final image build/publication or hosted invocation.
- No Docker, real retrieval or consumer install in ordinary tests. No active workflow until separate publication approval; no run until a one-attempt worksheet is approved.
- Preserve all lint rules; infer Effect channels and service ports. Provision dependencies at owning services or exported boundaries only. Static imports; no new declaration exceptions.
- One manual job, 15 minutes, no retries; compartment 9 minutes; commands 90 seconds; cleanup grace 30 seconds followed by forced removal/readback.
- 2 CPUs, 4 GiB memory with equal memory-swap, 128 PIDs. Combined writable tmpfs 3 GiB, including source/cases/cache and HOME/TMPDIR.
- Raw limits 64 MiB/artifact and 512 MiB total; expanded limits 256 MiB/package, 192 MiB/entry, 2 GiB total; 10,000 entries/package, 200,000 total, 512-byte paths.
- Evidence maximum 16 MiB total and 256 KiB per output stream; fixed sanitized JSON allowlist, seven-day retention. Missing or truncated required evidence cannot pass.
- Fresh independent physical cache copies, no shared hardlinks; stopped replay server before offline cases; no external networking, inherited config or credentials.

## Review Focus

1. A negative case fails for an unrelated startup error: require its exact intended refusal and stage, not merely a nonzero exit (Tasks 1, 5).
2. Archive limits are exceeded across chunks or concurrent packages: reserve aggregate expanded bytes before accepting data, including malformed termination (Task 3).
3. Bun falls back to a different cache, configuration or runtime: assert the complete environment, source inventory, flags and initial workspace state (Tasks 2, 5).
4. Cancellation arrives between container creation and receipt export: register ownership before starting work and require removal readback before success (Task 6).
5. A partial receipt or supplied manifest certifies its own bytes: bind external pinned inputs, full mandatory case set and before/after digests (Tasks 1, 2, 6).

## File Map And Interfaces

All paths below are relative to the Ceirean checkout, not FoldKit. New modules live under `probes/cloudflare-executor/src/linux-qualification/`; do not expand the existing public probe exports.

| File                                         | Responsibility                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `contract.ts`                                | Schema-derived request, case observations, receipt and fixed budgets    |
| `tool-pins.ts`                               | Immutable runtime/acquisition identities and qualification-only command |
| `inputs.ts`                                  | Linux public Git/blob validation and frozen raw-input staging           |
| `archives.ts`                                | Streaming archive admission, without extraction on the host             |
| `registry.ts`                                | Fixed loopback tarball-only replay server                               |
| `cache.ts`                                   | Native cache inventory, admission and independent copies                |
| `cases.ts`                                   | Ordered canaries, warm-up and offline cases; installed metadata audit   |
| `supervisor.ts`                              | Fixed Docker lifecycle, effective controls, deadlines and cleanup       |
| `receipt.ts`                                 | Strict aggregation, sanitization, bounded export and exit decision      |
| `scripts/qualify-linux.ts`                   | Host entrypoint; only `--check` or worksheet-bound `--run`              |
| `scripts/linux-qualification-worker.ts`      | Bundled Node entrypoint; no dynamic dependency loading                  |
| `qualification/linux-cache.workflow.yml`     | Inert workflow draft outside `.github/workflows`                        |
| `qualification/linux-cache-run-worksheet.md` | Exact one-attempt approval/evidence checklist                           |

Use `Schema.Struct` and literal unions for `QualificationRequest`, `CaseObservation` and `QualificationReceipt`; infer types from schemas. `QualificationRequest` contains the approved Ceirean commit, immutable input identities and fixed limits, not arbitrary argv/URLs/environment. `CaseObservation` contains `caseId`, `stage`, `outcome`, `reason`, bounded evidence references and identity digests. `QualificationReceipt` contains all mandatory observations, control readbacks, source/seed before/after digests, cleanup result and `activation: 'Blocked'`.

Functions below return inferred Effects unless explicitly synchronous. Services expose inferred methods from their implementations; do not introduce manually annotated Effect success/error channels. Fake adapters must use these same inferred ports, not a second mock-only contract.

## Acquisition Pins

Copy the two full OCI references from the approved spec into `tool-pins.ts`; assert exact equality in tests. No tag-only image references.

- Controller: `@oven/bun-linux-x64@1.4.2`, URL `https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.4.2.tgz`, SRI `sha512-9/E/UXOTpSo3YsV5g+FhtTd/qTpiWoKuxS12cqtuYA1ssu9fRAoPQnipFgGyck3tWO63iUdxBiygq+kELFawng==`. Read from public registry version metadata on 2026-10-26; no artifact downloaded or executed for this plan.
- Artifact action: `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` (resolved `v4.6.2` using public `git ls-remote` on 2026-10-26). No other actions are required: use anonymous Git checkout of the reviewed Ceirean SHA, with credentials/config/hooks disabled.
- Harness bundling dependencies: exact reviewed Ceirean `bun.lock`, its Git blob identity and lock integrity entries. Bootstrap installs are trusted-host preparation only, frozen and script-disabled; never run consumer lifecycle scripts to prepare tooling. Bundle statically for Node and record emitted file inventory/digests. No install occurs in the compartment.
- A run worksheet must bind the implementation commit, current lock blob, emitted harness/tool capsule digests and source/catalog identities. Those output hashes cannot be known before implementation; never substitute the design commit or a self-declared manifest as authority.
- Runner Git/Docker/OS are measured infrastructure, not immutable acquisition claims. Mismatch with required capabilities blocks execution.

The controller bootstrap tarball is trusted tooling, not permission to unpack consumer archives on the runner. Verify its SRI before bounded extraction of the fixed executable member; record the executable hash and verify version. Node is copied from the pinned, created-but-never-started image container. If libc compatibility fails, block without additional libraries or alternate runtimes.

## Task 1: Contracts And Fail-Closed Receipt Algebra

**Files:** Create `contract.ts`, `tool-pins.ts`, `receipt.ts`, and `tests/linux-contract.test.ts`. Modify probe `package.json` and `moon.yml` test lists to include each new offline test as it is added.

**Interfaces:** Produce `decodeRequest(input: unknown)`, `makeReceipt(request: QualificationRequest, observations: readonly CaseObservation[], cleanup: CleanupObservation)` and synchronous `qualificationExitCode(receipt: QualificationReceipt)`. Decode with Effect Schema. `CleanupObservation` is schema-derived and distinguishes confirmed removal, remaining resources and unknown state.

- [x] Write tests named `rejects_configurable_execution`, `requires_all_cases`, `rejects_unrelated_negative_failure`, `requires_independent_pins`, `never_enables_activation`, and `cleanup_unknown_cannot_pass`. Assert activation is always `Blocked`; only all intended case outcomes plus confirmed cleanup produce exit 0; incomplete/failed/blocked produce nonzero; unsupported invocation is 64.
- [x] Run `bun --no-env-file test probes/cloudflare-executor/tests/linux-contract.test.ts`; confirm missing-module/API failure before implementation.
- [x] Implement schemas, exact limits, mandatory case IDs from the spec and pure aggregation. Reasons include `BlockedMissingBunMetadata`, `BlockedRuntime`, `BlockedControls`, `BlockedChildObservation`, `InputChanged`, `ArchiveRefused`, `EvidenceIncomplete` and `CleanupUnknown`. Existing offline exit-2 semantics stay unchanged.
- [x] Property-test permutations, omissions, duplicate case IDs, unexpected fields, lowered/raised/NaN budgets and malformed digest values using `Arbitrary.schema`/`Arbitrary.checkEffect`, fixed seed and 100 runs. Reject duplicate observations rather than selecting the last one.
- [x] Rerun the focused tests and root `bun --no-env-file run check`; commit `feat: define Linux qualification contracts` after both pass.

Task 1 verified in `fc8c00d` and `7071e01`; task review and scoped re-review are clean. Review added independent admission to `makeReceipt(request, observations, cleanup, admission?)` and `qualificationExitCode(receipt, admission?)`; absent admission fails closed. Tasks 2/4/6 supply validated-source, trusted-seed and actual-file evidence, never receipt-derived authority.

## Task 2: Trusted Input And Tool Capsule Preparation

**Files:** Create `inputs.ts`, `tests/linux-inputs.test.ts`; reuse `dependency-pins.ts`, `dependency-inventory.ts`, `cache-download.ts`, `source-payload.ts` validation logic. Do not broaden the macOS `runPreparationProcess` executable union merely to accept arbitrary tools.

**Interfaces:** Produce `prepareLinuxInputs(request: QualificationRequest)` through an inferred owning service, and `validateToolCapsule(input: unknown)`. Return a schema-derived `PreparedInputs` containing admitted source/blob/catalog/tool inventories and independently checked digests. Later tasks consume `PreparedInputs`, never unvalidated paths from dispatch.

- [x] Write failing tests for changed Git tree/blob, private/inaccessible target, source secret/config paths, unsupported modes, bad SRI, redirected GET, changed lock/tool capsule and Linux tool discovery. Fakes must prove no consumer tarball extraction or executable import occurs on the host.
- [x] Run `bun --no-env-file test probes/cloudflare-executor/tests/linux-inputs.test.ts`; confirm RED.
- [x] Implement fixed anonymous Git retrieval with the existing tree/blob model, isolated HOME/config/hooks and portable owned temp roots. Resolve only fixed Git/Docker paths on the trusted runner and record their readbacks. Keep macOS behavior unchanged.
- [x] Implement public allowlisted artifact staging with existing byte/integrity budgets. Build a minimal source/tool/input handoff excluding `.git`, dotenv, package-manager host configuration, operational state and credentials. Verify each capsule file against build provenance plus the approved lock, not just sibling manifest entries.
- [x] Add synthetic SRI mismatch and one-byte capsule mutation tests; use fake acquisition/process ports only. Rerun focused tests and root check; commit `feat: prepare verified Linux qualification inputs`.

Task 2 verified in `4d964ce`; review approved. Trusted tools have separate conservative bounds of 192 MiB per file and 256 MiB total; the raw consumer caps are unchanged. Actual tool size/build provenance remain runtime/controller gates. Successful final-staging test coverage is a deferred non-blocking review item, not a Linux qualification claim.

## Task 3: Archive Admission And Exact Replay

Execution checkpoint: on 2026-10-26 the owner approved exactly one native HTTP
application boundary, `scripts/linux-replay-platform.ts`, registered in the
existing Node-platform lint rule. Other rules and boundaries stay unchanged.
Task 3 implementation resumes; no Linux qualification or activation is implied.

**Files:** Create `archives.ts`, `registry.ts`, `tests/linux-archives.test.ts`, `tests/linux-registry.test.ts`; use a narrow static declaration/import for the existing npm distribution parser if needed. No new dependency version or broad `any` shim.

**Interfaces:** Produce `admitArchives(inputs: PreparedInputs)` returning `AdmittedArtifacts`, and scoped `startReplay(artifacts: AdmittedArtifacts)` returning a handle with `stop()` and `snapshotRequests()`. Bind only `127.0.0.1:4873`; supplied URLs cannot change it.

- [x] Write failing synthetic tests for traversal/absolute/ambiguous paths, duplicate destinations, file-directory conflicts, links, devices, ownership/setuid metadata, unsupported extended headers, malformed/truncated gzip/tar and expansion limits. Assert no entry is handed to Bun before admission completes.
- [x] Write registry tests for exact GET/path mapping, absent blob, HEAD/POST, query/encoding ambiguity, packument request and oversized request logs. Assert unknown metadata yields `BlockedMissingBunMetadata`, not proxy/fetch behavior.
- [x] Run both focused files and confirm RED; implement streaming admission using the pinned proven parser, with aggregate reservation before accepting chunk bytes. Reject unsupported package formats wholesale, never silently strip entries.
- [x] Property-test chunk partitioning and boundary sizes (100 runs, fixed seed): the same bytes yield the same admission, aggregate caps cannot overflow and every accepted path stays inside its root. Use reduced injected limits in synthetic fixtures, never allocate gigabyte fixtures.
- [x] Implement replay with a scoped release that waits for listener termination. Synthetic tests may bind ephemeral loopback ports through a private adapter; exported production configuration remains fixed. No external requests in tests.
- [x] Run both focused tests and root check; commit `feat: admit archives and restrict Linux replay`.

Task 3 verified in `1c14a78` and `885c78b`; task review and scoped re-review passed. Full serialized replay evidence is limited to 256 KiB and 1,024 records; the frozen 661-path one-GET projection is 58,257 bytes, not actual warm-up proof. Local Node/macOS smoke is not pinned Linux proof. Larger multi-block property fixtures remain a deferred non-blocking review item.

## Task 4: Sealed Cache And Physical Case Isolation

Execution checkpoint: Effect 4.0.5 has no `lstat` service operation. On 2026-10-26
the owner approved exactly one `scripts/linux-cache-platform.ts` native boundary,
limited to `node:fs/promises` `lstat` metadata. All other operations and lint rules
remain unchanged. Do not substitute target metadata for link metadata or omit
link modes/inodes.

**Files:** Create `cache.ts`, `tests/linux-cache.test.ts`.

**Interfaces:** Produce `sealCache(root: string)`, `copyCaseCache(seed: SealedCache, destination: string)` and `admitCaseCache(seed: SealedCache, copy: CaseCache)`. `SealedCache` includes full path/mode/content/link inventory and root digest; `CaseCache` binds the source seed digest and its independent destination.

- [x] Write failing tests for one-byte mutation, omitted/extra files, escaping links, special files, duplicate/case-conflicting destinations and mode changes. Assert corruption is refused by hash admission before any install invocation.
- [x] Run `bun --no-env-file test probes/cloudflare-executor/tests/linux-cache.test.ts`; confirm RED.
- [x] Implement deterministic inventory and physical copies with no hardlink sharing. Preserve only admitted internal cache links and verify their destinations; unlike raw tarballs, cache links have a distinct policy. Avoid hand-rolling Bun directory names.
- [x] Test mutation of one case cache and installed-file copy leaves the seed and second case unchanged; verify inode separation where supported. Rehash seed after every case. Synthetic platform limitations are reported, not represented as Linux proof.
- [x] Rerun focused tests and root check; commit `feat: seal and isolate Linux cache cases`.

Task 4 verified in `5788d12` and `c043fd3`; task review and scoped re-review passed. Cache inventories include explicit original, sealed and writable-case modes; inode isolation and actual seed rehashing use the approved metadata port. Local synthetic filesystem evidence does not establish native Bun layout or Linux usability.

## Task 5: Ordered Worker Cases And Script-Suppression Gates

**Files:** Create `cases.ts`, `scripts/linux-qualification-worker.ts`, `tests/linux-cases.test.ts`.

**Interfaces:** Produce `runWorkerCases(inputs: PreparedInputs)` through an inferred service consuming archive/replay/cache/process capabilities. Return ordered `CaseObservation` values. Keep process execution fixed to the trusted Node harness and installer Bun; no dispatch-defined shell, command or environment.

- [x] Write failing fake-process tests asserting order: runtime/control checks, archive negatives, canaries, tarball-only warm-up, seal, replay stop, fresh positive, empty cache, missing direct required artifact, corrupt admission, two-case isolation, cancellation/deadline. Later cases cannot run after prerequisite refusal.
- [x] Run `bun --no-env-file test probes/cloudflare-executor/tests/linux-cases.test.ts`; confirm RED.
- [x] Implement Node-compatible static bundling boundaries; replace Bun-only hashing inside the worker with Node-compatible Effect/platform or standard crypto APIs. Host-only Bun hashing may remain unchanged.
- [x] Require effective Bun 1.3.11 flag support, Node 22.23.4/libc readback, fresh HOME/TMPDIR/cache/workspace, source/lock invariance and exact qualification argv. Warm-up node_modules is never reused. Stop replay and confirm termination before the positive case.
- [x] Add root and trusted-dependency script canaries. Require a trustworthy child/native-execution observation capability, not process polling or marker absence alone. Its admission returns `BlockedChildObservation` if unavailable; no historical source install may run in that state. Tests inject observed allowlisted/unexpected executions and an unavailable observer.
- [ ] Before proposing a live run, separately review any additional tracing/enforcement tool and its immutable acquisition identity. This plan does not authorize fetching an unpinned tracer or weakening the observation requirement. Synthetic tests cannot close this live capability gate.
- [x] Audit installed package metadata and workspace links as bounded data against the historical lock/platform. Choose the missing-artifact negative from a demonstrated installed, direct nonoptional dependency; assert the intended cache miss, not a runtime startup failure. Explain GNU/musl exclusions without requiring all 661 packages to install.
- [x] Rerun focused tests and root check; commit `feat: orchestrate fail-closed Linux cache cases`.

Task 5 verified in `f76544a` and `7a7dd0e`; task review and scoped re-review passed. Negative cases require a narrow identity-bound normal refusal, and workspace links bind full scoped names and canonical targets. The unchecked observer-tool review is a future live-run prerequisite, not unfinished acquisition authority for this implementation. Real runtime/control/canary/cache behavior is still unqualified; defaults refuse and early failures emit no invented seal or full receipt.

## Task 6: Host Supervisor, Bounded Evidence And Inert Workflow

Verified offline: ownership, host cancellation finalization, live collection,
effective control adapters, production composition and durable bounded output
are implemented. The final probe suite (425), root lint/format, all 12 Moon
typecheck tasks and all 12 Moon test tasks pass. Independent task review, scoped
fix re-review and whole-branch review have no blockers. Two P3 coverage gaps from
Tasks 2/3 remain explicitly deferred, not demonstrated by existing tests.
The owner approved exactly one
`scripts/linux-control-platform.ts` DNS/raw-TCP boundary using `node:dns/promises`
and `node:net`; all other lint rules remain unchanged. The observer, reviewed
worksheet/capsule provenance and effective Linux proofs remain unavailable.
External probes, Docker, workflow publication and CI execution are not authorized.

**Files:** Create `supervisor.ts`, `scripts/qualify-linux.ts`, `tests/linux-supervisor.test.ts`, `tests/linux-cli.test.ts`, `qualification/linux-cache.workflow.yml`, `qualification/linux-cache-run-worksheet.md`. Extend `receipt.ts`; update probe README and roadmap.

**Interfaces:** Produce `runQualification(request: QualificationRequest)` consuming Tasks 1-5, and an offline `--check` path. `--run` requires an exact reviewed worksheet, platform/capability preflight and fixed invocation; it cannot infer authority from an environment boolean. Ordinary Moon tests invoke only fakes/`--check`.

- [x] Write failing tests for interruption after create/before start, interrupted warm-up, deadline, stream overflow, missing receipt, failed removal, forged run identity and unknown Docker state. Use fake Docker operations; assert register-ownership-before-start and unconditional cleanup/readback.
- [x] Run the two focused test files; confirm RED. Implement fixed Docker argv/readback with network none, read-only root, explicit UID/GID, cap-drop ALL, no-new-privileges, isolated PID/IPC, no devices/ports/socket and 2 CPU/4 GiB/128 PID limits. Assign tmpfs `/work` 2816 MiB, `/home` 128 MiB and `/tmp` 128 MiB, all noexec/nosuid/nodev; total 3072 MiB.
- [x] Add behavioral network/DNS/raw-TCP negatives and effective mount/UID/security checks to the runtime contract. Unsupported or unverifiable controls block before historical inputs. Enforce 90-second commands, nine-minute worker deadline and 30-second cleanup grace; force removal then inspect absence. Unknown cleanup never passes.
- [x] Implement bounded sanitized receipt export. Treat stdout as untrusted data, not GitHub workflow commands. Export only fixed JSON/diagnostic paths; no environment, source, cache, node_modules or symlink-following artifact discovery. Test truncation and aggregate overflow invalidate success.
- [x] Write the inert workflow: `workflow_dispatch` only, fixed reviewed implementation SHA, `contents: read`, no secrets/OIDC/cache restore/dispatch parameters, `ubuntu-24.04`, `timeout-minutes: 15`, no retries, artifact action at the pinned SHA with seven-day retention. No active `.github/workflows` change. Fail if approved SHA/pins/worksheet are absent; never run an arbitrary branch tip.
- [x] Add a static workflow test asserting all restrictions and absence of an active qualification workflow. Add worksheet fields for exact run attempt, implementation/tool/input/harness hashes, public retrieval authorization, child-observer capability, effective budgets, billing/entitlement check, evidence recipient, cleanup owner and final status. Documentation must distinguish offline verification from Linux proof.
- [x] Rerun focused tests, then `bun --no-env-file run check`, `moon run :typecheck --concurrency 1`, and `moon run :test --concurrency 1`. Confirm no test starts Docker, fetches real artifacts or installs consumers. Review the entire branch independently and resolve findings before committing `feat: prepare guarded Linux qualification controller`.

The task review fixed malformed Docker UTF-8 cleanup continuation and effective
aggregate tmpfs accounting with RED/GREEN regressions; scoped re-review is clean.
The final full test graph passed in 10m20s. Actual Linux controls, a compatible
auxiliary-mount layout, observer and tool/worksheet authority remain live gates.

## Completion And Separate Next Gates

- [x] Verify `activation-policy.ts`, historical `pins.ts`, frozen inputs and active workflows unchanged; inspect final diff and clean status. Commit every verified task, never unverified work merely to clear the worktree.
- [x] Report only offline implementation/test status. No Linux qualification claim follows from synthetic tests or an unpublished workflow.
- [ ] Stop for publication approval. After publication is approved, verify the published workflow/ref/permissions without dispatching it.
- [ ] Stop for one-attempt run approval. Missing child-execution observation, tool provenance, runner controls, resource allowance or reviewed capsule hashes are explicit blockers. A deliberately blocked run is not worth spending the rehearsal budget merely to rediscover a known missing capability.
- [ ] Only a separately approved run can retrieve real inputs, pull pinned images, stage source and execute the fixed cases. Failed/uncertain attempts do not authorize retries. A measured pass still leaves hosted activation, final image and private invocation blocked.

## Plan Self-Review

Spec coverage: contracts/evidence (Task 1), independent trust and Linux source/tool preparation (Task 2), raw admission/replay (Task 3), cache isolation (Task 4), all mandatory cases/metadata auditing (Task 5), effective controls/supervision/worksheet/workflow (Task 6). Review Focus conditions are assigned above. No public package API changes, new runtime cohort, hosted policy change or workflow activation is included.

Remaining evidence is intentionally runtime-specific, not silently assumed: libc compatibility, Bun flags/cache behavior, effective controls and reliable child-execution observation. Output digests are bound after implementation; any extra observer acquisition needs review before publication/run. The implementation can be verified offline without claiming those gates are closed.
