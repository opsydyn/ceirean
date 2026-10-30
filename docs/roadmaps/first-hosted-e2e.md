# First Hosted Baseline And Browser Run

Updated 2026-10-30. Active delivery path, replacing
[the historical qualification programme](first-hosted-e2e-history-20261027.md).
The owner reaffirmed baseline/browser evidence before Flue migration. This map
does not authorize source execution, downloads, builds, publication or activation.

## Acceptance

An operator manually requests one private job for a fixed FoldKit revision and
receives a bounded review bundle containing:

- Source, lockfile, acceptance profile, image and toolchain identities.
- All commands in the accepted baseline contract, with exit codes and actual
  suite discovery/results; omitted CI surfaces must be named, never called green.
- Carousel navigation and drag/settle, and promo line editing/settings consistency,
  at desktop 1440x900 and mobile 390x844, with screenshots, traces and errors.
- Evidence digests and explicit missing/refused artifacts.
- Duplicate-delivery behavior, a terminal result and independent stopped-container
  readback. A separate active cancellation case must terminate real live work on
  the same image/runtime and confirm cleanup before the baseline allocation.

No manual shell session is needed to obtain the result. A missing browser case,
zero-test success, altered acceptance threshold or uncertain cleanup is not a pass.
Repository scripts are execution, even during install/typecheck or fixture setup.

## Reuse, Do Not Rebuild

- Reuse signed identity checks, durable admission/alarm ownership, single-job
  deduplication, status/readiness, compare-and-set completion and teardown patterns.
- Reuse the pure qualification/lifecycle model and bounded artifact contracts;
  do not create another orchestrator or make the model the verifier.
- Reuse prepared source/cache tooling and the four-case browser harness where
  compatible. Their historical pins and unexecuted status remain explicit.
- Reuse the manifest inventory as preparation input, not a new hosted milestone.
- Preserve successful smoke ledgers and historical profiles; new baseline work
  must not reset records or reinterpret `runtime: v22...` as a baseline result.

## A. Freeze The Executable Contract: Immediate Slice

- [x] Inspect fixed current source and existing runtime/image/harness preparation:
      [readiness assessment](../assessments/foldkit-baseline-readiness-20261030.md).
- [ ] Explicitly accept a baseline revision. Recommended planning candidate:
      `1183e3c067f873fdd29f14f06030515929c1b956`, already inventoried. Its approval
      for inventory did not silently replace historical execution approval for
      `b7484cb46e66b162c8afddcfba235c9507b4f0ab`.
- [ ] Freeze source/lock hashes, exact consumer toolchain, command ordering,
      generated-consumer requirements, Linux dependencies and browser versions.
- [ ] Preserve root CI checks and Storybook; decide explicitly how the current
      separate effect-three CI job fits the acceptance contract. No omitted job
      may be reported as repository-wide CI parity.
- [ ] Bind server commands/ports, the four browser cases and evidence assertions
      to that revision without editing its protected tests or scripts.

Exit: one implementable versioned baseline contract with no unresolved source or
toolchain choices. Do not spend another slice designing a manifest transport.

## B. Make That Baseline Runnable On Linux

- [ ] Prepare a bounded trusted recipe/input set for the accepted contract, using
      the existing recipe as a starting point rather than treating it as measured.
- [ ] Obtain the exact bounded acquisition/build scope; then build and retain the
      final immutable image digest. Base-image digests are not the final image.
- [ ] Run unchanged source checks and real browser journeys with their sandbox
      enabled, no deployment credentials, controlled networking and fixed fixtures.
- [ ] Capture actual outputs, screenshots/traces and command/test inventories.
      Prove cancellation/overflow cleanup with live processes where required.

Exit: a runnable baseline/browser image and measured evidence, or one concrete
runtime/policy failure for an owner decision. Missing dependencies do not permit
general Internet access, skipped suites or changed expectations. Do not revive
the generic observer/cache programme unless a specific required control needs it.

## C. Deliver It Through The Private Hosted Job

- [ ] Extend the existing hosted job with a typed baseline operation/result;
      preserve the smoke protocol/history and reject mixed operation identities.
- [ ] Separate short admission windows from the persisted baseline execution
      deadline and cleanup budget. Replace smoke-only timing in runner, inactivity
      and recovery alarms coherently; do not merely increase one timeout.
- [ ] Bind source/profile/image digests and finite budgets before allocation.
      Restarts and redelivery must not reset them or start duplicate execution.
- [ ] Export bounded private artifacts and status through the existing approved
      control path; qualify size limits and actual receipt integrity.
- [ ] Obtain deployment and session scopes with a cleanup owner, spend allowance,
      fixed windows and independently verified private readiness.
- [ ] Perform the separately approved active-cancellation case, then the successful
      baseline case, retaining stopped-resource readback and evidence for both.

Exit: the operator receives the acceptance bundle. This is the first hosted
end-to-end milestone; it still does not prove Flue's repair value.

## D. Add The Repair Loop

- [ ] Approve one useful migration target, model/data policy and repair allowance.
- [ ] Let Flue propose a restricted patch inside candidate workers.
- [ ] Independently verify the frozen candidate against the same contract.
- [ ] Return the patch and before/after evidence for maintainer acceptance.

Draft PR publication and organisation discovery follow separately, as described
in [the product roadmap](../roadmap.md).

## Delivery Discipline

Proposed local preparation appetite: one focused implementation day after the
contract is accepted, not a guarantee of hosted readiness or an approved spend.
If blocked, return the exact missing capability, failure evidence and smallest
decision needed. No automatic retries, broader permissions, platform replacement
or fresh generic qualification programme. Confirm cleanup before another run.
