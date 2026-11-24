# Ceirean Roadmap

Updated 2026-11-22. This is the active product delivery map. Historical records
live in [the previous roadmap](roadmap-history-20261027.md); checkboxes record
evidence, not permission to execute. The local folder may remain `Leviathan`.
The owned executor runtime is parked as of 2026-11-18; see
[the parking record](#parked-owned-executor-runtime-2026-11-18) before planning
another runtime slice. The current architecture, with every approval gate marked,
is modelled in [`docs/architecture/ceirean.c4`](architecture/ceirean.c4).

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

| Capability                                                                | Evidence                                                                                                                            | Limit                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Domain, ledger, worker lifecycle and Flue compatibility foundations       | [Historical delivery record](roadmap-history-20261027.md)                                                                           | Local/offline proof, not a hosted repair run                                                                                     |
| Signed GitHub admission, durable execution, accepted replay and teardown  | [30 October hosted smoke](evidence/readonly-hosted/accepted-replay-20261030-084800.md)                                              | Fixed `node --version`, not repository checks                                                                                    |
| Pinned dependency declaration inventory                                   | [Manifest evidence](evidence/manifest-report/baseline-1183e3c.md)                                                                   | Local Git objects, not installed versions or compatibility                                                                       |
| Vendored Factory substrate, our router, plan, projection and verifier     | [Factory substrate evidence](evidence/factory-substrate/)                                                                           | Local and typecheck-only; no container, deploy or credential                                                                     |
| One accepted breaking upgrade, verified by the target repository's own CI | [The pilot](evidence/foldkit-pilot/migration-pilot-20261121.md) and [its acceptance](evidence/foldkit-pilot/acceptance-20261123.md) | A human-triggered agent and foreign CI, not Flue or the owned worker; green on the candidate pull request did not mean published |
| Repository baseline and browser evidence from an owned executor           | Not yet demonstrated                                                                                                                | Parked; the pilot used the target repository's CI instead                                                                        |

The last hosted teardown was verified private/expired. This is retained evidence,
not a fresh provider-state read. No current roadmap entry authorizes activation.
Preview-token revocation/lifetime remains an explicit transport limitation.

## Delivery Order

### 1. Real FoldKit Baseline And Browser Evidence: Parked 2026-11-18

Its unchecked items are deferred, not scheduled. The migration pilot in the
parking record below replaces them as the next approval. Delivered items remain
accurate records of what was proven.

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
- [x] Acquire and read back [897 current registry candidates](evidence/current-baseline/registry-20261030.md)
      within existing budgets, without installing or executing them.
- [x] Prepare the [guarded fixed-plan worker candidate](evidence/current-baseline/worker-20261030.md),
      with failure, cancellation, deadline and output-budget tests; native entry stays disabled.
- [x] Freeze all four current generated/packed npm consumer locks and prove
      [metadata-only offline replay](evidence/current-baseline/npm-20261030.md),
      preserving the packed adapter's older explicit pins.
- [x] Acquire the exact 12-archive npm delta and compose/read back
      [909 portable registry/npm cache inputs](evidence/current-baseline/offline-cache-20261030.md),
      reusing the original 897 and replaying all four npm locks offline.
- [ ] Materialize Bun's native cache on pinned Linux; qualify offline installs
      and native worker/control admission. Portable caches are not installation proof.
      [All 909 archives now pass offline admission](evidence/current-baseline/archive-admission-20261030.md)
      after approved inert ownership metadata and exact legacy-root compatibility.
      Prepare the current cache-only worker for a bounded Linux CI job instead of
      another local Colima run. Exact-source handoff, workflow publication and CI
      execution remain separate gates; no image build or hosted activity is authorized.
      [Current CI preparation design](superpowers/specs/2026-10-31-current-linux-cache-ci-design.md)
      uses the selected pinned public-source route; local implementation is approved,
      with [the four-task plan](superpowers/plans/2026-10-31-current-linux-cache-ci.md).
      Local descriptors, worker retention and bounded CI adapters are implemented;
      the [inactive workflow and run worksheet](runbooks/current-linux-cache-ci.md)
      still refuse execution. Resolve the controller checksum and reviewed run-entry
      handoff before requesting publication, then separately approve one Linux attempt.
- [ ] Prepare the actual executor inputs/image and demonstrate the unchanged
      baseline plus required browser journeys on controlled Linux.
- [ ] Connect the proven private job path to that executor with durable deadlines,
      bounded evidence export, restart recovery and cleanup.
- [ ] Run separately approved hosted cancellation and successful-baseline cases;
      return artifacts without manual container access or stitched-together logs.

See [the active execution path](roadmaps/first-hosted-e2e.md). Do not substitute a
hosted manifest/stdin demo for this milestone. No new hosted run is approved here.

### 2. Useful Migration Patch: Accepted 2026-11-23, One Item Open

While the runtime is parked, this milestone runs as the FoldKit migration pilot:
the patch comes from a human-triggered agent and the verdict comes from the
repository's own CI, not from the owned worker or the baseline contract rerun.
Substitute those two steps; keep the scope, evidence and acceptance requirements.

- [x] Select one real dependency/source-API upgrade, exact targets and allowed paths.
      foldkit 0.170.0 to 0.171.0, settled by diffing the published declarations
      rather than the manifest, which is byte-identical across the two versions;
      see [the candidate record](evidence/foldkit-pilot/breaking-upgrade-candidate-20261121.md).
- [ ] Give Flue only the existing restricted worker tools and approved model budget.
      Substituted for the pilot: the patch came from a human-triggered agent. No
      model key, provider call or budget was used, so this item is untested rather
      than met. It is now the only open item in this milestone and the next slice,
      ahead of publication, decided on 2026-11-23. Scoping it found that its own
      premise does not hold: there are no existing restricted worker tools. The
      repository defines exactly one Flue tool, `record_token` in the
      compatibility probe, which records a synthetic token against a faux
      provider with an empty environment; and no model budget has been approved
      anywhere, the recorded $0.13 per candidate being the vendored substrate's
      container cost, not model spend. See
      [the design](superpowers/specs/2026-11-23-flue-patch-generation-design.md)
      for the three gaps and the decisions they need.
- [x] Freeze a scope-valid patch and independently rerun the baseline contract.
      Substituted for the pilot: the patch is frozen at `d30bbf5a` and the verdict
      comes from the target repository's own CI, base against candidate under the
      same checks. Both are green.
- [x] Return the patch, before/after browser evidence and concise review report.
      That CI's own Playwright browser and visual checks are the before/after
      evidence, green on base and candidate alike; the pilot record is the report.
- [x] Record maintainer acceptance and active supervision/review effort.
      Four rework rounds and the maintainer's peer-widening decision are recorded.
      [PR 188](https://github.com/opsydyn/fold-kit-experiments/pull/188) was
      merged at 2026-11-23T08:51:52Z as `058d3e5` and `foldkit` is `0.171.0` on
      that branch. Acceptance did not leave the repository correct, which is
      recorded separately in
      [the acceptance record](evidence/foldkit-pilot/acceptance-20261123.md).

Status 2026-11-22: the pilot ran and is recorded. Its central finding is that a
manifest-only patch, which is what a dependency bot produces, fails this
repository's own consistency checkers twice before reaching a test, because the
version also lives in skill assets, Markdown prose and generated-starter
templates. The real patch is 18 files, not the 7 manifests a bot would touch.

Status 2026-11-23: accepted, and the acceptance extended that finding. The
merge commit's own `ci` run failed although all four jobs on the pull request had
passed, and
[PR 189](https://github.com/opsydyn/fold-kit-experiments/pull/189) was needed to
repair two READMEs that contradicted the packages they ship with and, more
seriously, to publish the widened peer range at all: `chore:` does not bump, so
release-please never released, and npm kept serving `<0.171.0`. A correct,
reviewed, accepted 18-file patch did not deliver the upgrade. The acceptance
contract therefore needs a notion of published, not only of green, and the
verdict cannot be the candidate pull request alone.

Success means an accepted, verified migration, not merely a version bump or a PR.
No model key, provider call or repository write is authorized by this roadmap.

### 3. Reliable Publication: After The Flue Slice

Acceptance has happened, so this milestone's precondition is met in name. It is
sequenced behind the Flue item above by a decision of 2026-11-23: publication
automates the last mile, and 2026-11-23 showed that a bundle green on its own
pull request can both break the target's `main` and fail to reach consumers, so
automating that verdict would industrialise an incomplete signal. The first mile,
Flue producing the patch at all, is unproven.

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

### Parked: Owned Executor Runtime (2026-11-18)

Park the owned executor runtime: the unbuilt baseline image, the inactive Linux
cache CI job, the observer/tracer candidates and the private hosted actuation
sequence in milestones B and C of
[the execution path](roadmaps/first-hosted-e2e.md). Its milestone D repair loop
becomes the pilot below. This is sequencing, not a verdict on that work or on
its recorded evidence.

Reason: `opsydyn/fold-kit-experiments` already runs the acceptance surface those
milestones would rebuild. Its committed `ci.yml` performs a frozen-lockfile
install, lint/format, typecheck, tests and build, then package checks via
publint/attw, public-API report drift, Playwright Chromium browser/visual tests
with golden-diff artifacts, package tarball and clean npm consumer checks, and a
real ELK layout check. Reconstructing that inside a bespoke immutable image adds
custody and isolation, not verification signal, for a pilot the maintainer
triggers against a repository they own.

Replacement next approval: one FoldKit migration pilot against committed `main`,
not the dirty local checkout or the October container baseline. Use a
human-triggered agent for the patch and the repository's existing CI for the
verdict, comparing an unchanged base with the candidate under the same checks.
Cap harness setup at half an engineering day; do not cap the migration itself,
because an upgrade small enough to fit that cap cannot test the value claim.
Never modify FoldKit tests, acceptance thresholds or release workflows to obtain
a pass. No auto-merge and no release. The pilot requires a genuine breaking
upgrade: if none is available on demand, record that outcome instead of
manufacturing one, because the absence is itself evidence about demand.

Measure the maintainer's active review and rework time against a comparable
manual upgrade, and record it. Routine version bumps belong to a dependency bot,
trying Dependabot's Bun support on this one repository first and Renovate only if
that falls short; neither is yet proven against the root catalog, published
version literals and `bun.lock` conventions. Dependabot is currently configured
for GitHub Actions only. The pilot sharpened that test: a bot that edits only
manifests will fail this repository's own checkers, so judge the Bun-ecosystem
trial on whether it also updates skill assets, prose and starter templates, not
merely on whether it opens a pull request.

Retain the merged runtime work at `c4058a2` and every existing evidence record;
it is deferred, not deleted. Owned isolation remains the prerequisite for running
untrusted agent-produced patches against repositories the maintainer does not
own, which is the Repeatable Service outcome. Reopen this runtime for that
outcome, or for a concrete gap the pilot exposes in the simpler workflow, with a
bounded question and an exit condition.

Substrate when reopening: vendor `withastro/factory` (MIT) rather than fork it or
resume the image, cache and observer programme. Settled on 2026-11-21 against the
source and its own test suite, not a page fetch; see
[the assessment](assessments/astro-factory-foundation-20261121.md) and
[the vendoring design](superpowers/specs/2026-11-21-factory-substrate-vendoring-design.md).
Factory runs Astro's own triage and review automation in production on the
architecture these milestones were building: Cloudflare Worker webhook ingress, a
deterministic router, one Durable Object per issue or pull request for
serialisation, Flue agents, and Cloudflare Sandbox containers with credential-free
hardened clones and bounded install/build commands. Cloudflare Sandbox in
particular displaces the unbuilt immutable image, the 909-archive offline cache
and the mount policy. Only the Cloudflare AI Gateway provider is bundled there,
which constrains any inherited credential boundary.

Vendoring rather than forking, because a fork makes us the maintainer of seven
capabilities we will never run. Factory is young, has no releases and is private
by design, so adopting it means owning the code rather than depending on it,
which is why only the substrate travels and MIT requires the copyright notice
travel with it: upstream SHA and path are recorded per file so a later upstream
fix can be reapplied by hand. Slices 1 to 4 are done and entirely local. Twelve
files sit under `vendor/factory` with recorded provenance; the bindings typecheck
against a class we do not author; our router was compared with upstream's and the
comparison closed a real defect, a classic bot on a plain user account reaching
admission; and the plan, receipt projection, sandbox port and verifier wiring are
delivered under 28 tests. All five pre-commitment questions are closed, the last
on 2026-11-22, and the economics are about $0.13 per candidate. Slice 5 is
everything that runs a container, touches Cloudflare, installs a GitHub App or
uses a credential, and each of those is still its own gate.

Factory does not supply the product. It has no dependency upgrade, migration or
codemod capability, and no acceptance gate: its triage loop ends with the issue
reporter confirming a fix, which has no analogue for a migration whose only
verdict is the target suite. Worse, with `autoPrOnFix` enabled the verdict is the
model's own `fixed` boolean and its config carries no test command, so nothing
independently verifies a fix. That is the concrete reason our acceptance contract
is not redundant. The acceptance contract and the migration capability stay ours.

### Standing Guardrails

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
