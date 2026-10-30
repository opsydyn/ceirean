# Ceirean Roadmap

Updated 2026-10-30. This is the active product delivery map. Historical records
live in [the previous roadmap](roadmap-history-20261027.md); checkboxes record
evidence, not permission to execute. The local folder may remain `Leviathan`.

## Product Outcome

Help a maintainer finish a dependency/source-API upgrade with less supervision:

```text
Approved request -> pinned repository -> isolated baseline + browser evidence
  -> Flue migration patch -> independent verification -> maintainer review
  -> separately authorized draft PR
```

The first customer is us, using `opsydyn/fold-kit-experiments`. Prove one useful
upgrade before broadening repositories or automating discovery. A queued event,
runtime version, inventory report or passing synthetic suite is not that outcome.

Keep Bun, TypeScript, Effect, the Moon monorepo, Flue and Cloudflare/Alchemy.
Effect owns application composition and resource lifetimes; the ledger owns
durable authority. No framework/platform migration is needed to advance.

## What Is Actually Proven

| Capability                                                               | Evidence                                                                               | Limit                                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Domain, ledger, worker lifecycle and Flue compatibility foundations      | [Historical delivery record](roadmap-history-20261027.md)                              | Local/offline proof, not a hosted repair run               |
| Signed GitHub admission, durable execution, accepted replay and teardown | [30 October hosted smoke](evidence/readonly-hosted/accepted-replay-20261030-084800.md) | Fixed `node --version`, not repository checks              |
| Pinned dependency declaration inventory                                  | [Manifest evidence](evidence/manifest-report/baseline-1183e3c.md)                      | Local Git objects, not installed versions or compatibility |
| Repository baseline, browser evidence and accepted migration             | Not yet demonstrated                                                                   | This is the remaining product delivery work                |

The last hosted teardown was verified private/expired. This is retained evidence,
not a fresh provider-state read. No current roadmap entry authorizes activation.
Preview-token revocation/lifetime remains an explicit transport limitation.

## Delivery Order

### 1. Real FoldKit Baseline And Browser Evidence: Now

**User result:** one manually requested private job returns a reviewable bundle
from actual repository checks and desktop/mobile interactions, with source,
toolchain, image and cleanup identities attached.

- [x] Establish hosted admission, single execution, replay and teardown smoke.
- [x] Inventory a current fixed source without executing repository code.
- [x] Reconcile the old executor preparation with the current source and record
      [the concrete readiness gaps](assessments/foldkit-baseline-readiness-20261030.md).
- [x] Freeze the approved `1183e3c` baseline acceptance contract, all 16 checks,
      four browser cases and source/toolchain identity.
- [x] Prepare the pinned Linux image recipe and strict preparation validator;
      [inputs remain Pending and the image Unbuilt](runbooks/current-foldkit-baseline.md).
- [x] Resolve the 3D helper's default `--no-sandbox` option through the explicit
      sandbox-only descendant `be0427e`; preserve every check and the unchanged lock.
- [x] Materialize and independently read back local source/harness-source candidates;
      [exact identities and remaining blockers](evidence/current-baseline/sandbox-inputs-20261030.md).
- [ ] Prepare the actual executor inputs/image and demonstrate the unchanged
      baseline plus required browser journeys on controlled Linux.
- [ ] Connect the proven private job path to that executor with durable deadlines,
      bounded evidence export, restart recovery and cleanup.
- [ ] Run separately approved hosted cancellation and successful-baseline cases;
      return artifacts without manual container access or stitched-together logs.

See [the active execution path](roadmaps/first-hosted-e2e.md). Do not substitute a
hosted manifest/stdin demo for this milestone. No new hosted run is approved here.

### 2. Useful Migration Patch: Next

- [ ] Select one real dependency/source-API upgrade, exact targets and allowed paths.
- [ ] Give Flue only the existing restricted worker tools and approved model budget.
- [ ] Freeze a scope-valid patch and independently rerun the baseline contract.
- [ ] Return the patch, before/after browser evidence and concise review report.
- [ ] Record maintainer acceptance and active supervision/review effort.

Success means an accepted, verified migration, not merely a version bump or a PR.
No model key, provider call or repository write is authorized by this roadmap.

### 3. Reliable Publication: After Patch Acceptance

- [ ] Add an isolated least-privilege publisher with explicit owner authorization.
- [ ] Create one draft PR from the verified immutable bundle; reconcile uncertain
      outcomes without duplicates or overwriting human changes.
- [ ] Observe required CI and leave merge/release decisions with the maintainer.

### 4. Repeatable Service: Later

- [ ] Onboard the postcode client through a second profile, not a new orchestrator.
- [ ] Qualify unattended recovery, retention, spending and operational ownership.
- [ ] Discover new organisation repositories and propose disabled configuration
      through a Ceirean self-PR; do not auto-run newly discovered repositories.
- [ ] Evaluate useful repairs and maintainer effort before wider rollout.

## Focus And Guardrails

Park the standalone hosted manifest-report run, custom observer/tracer programme,
generic cache-qualification expansion, Alchemy upgrade, Rust rewrite, dashboards,
campaigns, broad discovery automation and auto-merge. Retain reusable work and
existing evidence. Reopen parked research only for a concrete blocker on the
baseline/repair path, with a bounded question and exit condition.

Keep the safety requirements: immutable source, no credentials in repository
processes, controlled egress, actual process/browser cleanup, bounded costs and
artifacts, preserved tests, and independently verified frozen candidates. Cut
breadth, not these controls. Existing research limits are not silently relaxed.

Use one short readiness/contract pass, then implement against its acceptance.
Every further slice must advance actual repository execution, evidence delivery
or the repair loop. If it yields only another simulated/inspection checkpoint,
state why it is indispensable before spending another slice on it.

Source/toolchain changes, external acquisition, image build/publication,
deployment, live execution and GitHub writes retain their own explicit scopes.
An implementation approval must not become another unbounded design exercise;
raise a decision only for a concrete policy conflict or external action.
