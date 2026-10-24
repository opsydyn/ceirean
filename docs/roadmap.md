# Ceirean Roadmap

Ceirean is the current product name; the local `Leviathan` checkout name can
remain unchanged. Historical evidence and source identities below are retained.
The next live step is an explicitly approved, finite session using the
[rehearsal worksheet](runbooks/ceirean-rehearsal-approval.md), not deployment.

Local delivery map, updated 2026-10-24. Checkboxes describe delivered outcomes,
not permission to implement unchecked items. The organisation-discovery direction
is requested by the owner; its architecture, implementation plan, permissions,
hosting and execution appetite still require review.

## Cloudflare Hosting Proof

- [x] Prove the existing Effect ledger policy against local DO SQLite using the
      pinned Alchemy runtime: atomic transitions, 150 generated command sequences,
      separate-process restart recovery and supervised failure cleanup. See
      [the measured local assessment](assessments/local-effect-do.md). This is not
      native filesystem/WAL parity or production storage qualification.
- [ ] Approve and run a bounded hosted-executor feasibility test with the real
      toolchain, browser evidence, restricted networking and cancellation/cleanup.
      No hosting deployment, webhook activation or Flue migration is implied.
- [x] Prepare the offline executor lifecycle contract: process-local admission,
      scope-owned cancellation/deadline and fail-closed simulated cleanup. See
      [Task 3A evidence](assessments/hosted-executor-lifecycle.md). No provider
      process, private invocation or final executor image is qualified by this.
- [x] Prepare the signed Queue private-invocation design and bounded offline
      approval runner. [Evidence and limits](assessments/hosted-executor-invocation.md)
      retain unconfigured operator trust, hosted-unverified delivery and no
      Worker/SDK actuation; this does not authorize any hosted activation.
- [x] Wire local-only Queue inspection through a private Worker and SQLite DO
      replay receipt, including lost-ack redelivery and separate-process recovery.
      [Local proof and limits](assessments/local-executor-invocation.md) do not
      establish hosted authentication, execution admission or activation readiness.
- [x] Close local invocation coverage gaps: direct DO authorization refusal,
      concurrent same-object RPC submissions and bridge byte/UTF-8 boundaries.
      [Scope and mutation checks](assessments/local-executor-invocation.md#coverage-follow-up)
      retain all hosted activation gates.
- [x] Prepare offline historical-source and browser-harness-source candidates,
      preserving all tracked files/modes and requiring explicit blocked browser
      startup. [Evidence and gaps](assessments/offline-executor-inputs.md) retain
      pending caches, dependency closure, image build and all hosted acceptance.
- [x] Freeze the Linux-targeted Bun/npm/browser metadata inventory, including
      nested versions, exact URL/integrity pairs, generated-template resolution
      and explicit unqualified runtime/cache gates.
      [Evidence and limits](assessments/frozen-linux-dependencies.md).
- [x] Prepare integrity-checked registry/cache candidates with fixed size budgets
      and no-lockfile offline npm metadata replay. Keep Linux/Bun cache consumer,
      extraction, browser and hosted activation gates unqualified.
      [Local evidence](assessments/integrity-checked-cache-candidates.md).

## Delivery Order

- [x] Qualify the pinned offline Bun/Effect/Flue combination, including restart
      and synthetic cancellation, without claiming production readiness.
- [x] Establish full Effect lint policy, formatting and SQLite probe cleanup tests.
- [x] Review and approve the [qualification-gate spec](superpowers/specs/2026-10-18-qualification-gate-design.md).
- [x] Execute the approved [qualification-gate plan](superpowers/plans/2026-10-18-qualification-gate.md)
      through Task 4 Steps 1-6: synthetic domain/port/coordinator tracer, 210 local
      tests and 93,000 primary property cases per full run. See the exact tested
      artifact and limits in the [measured assessment](assessments/qualification-gate.md).
- [x] Complete Task 4 controller review and whole-branch review (Task 4 Step 7):
      clean at `e7d9d25` over `6809192..e7d9d25`; independent controller gates
      passed all nine commands (210 tests, 712 assertions, 93,000 primary cases).
      Local branch only, not merged/pushed; no durable/live qualification.
      The subsequent documentation closure was separately approved through
      `742a5df`; later docs-only corrections do not extend that reviewed range.
- [x] Select `@xstate/effect` for controller-owned worker lifecycle actors, keeping
      ledger authority, pure qualification, Bun and universal lint unchanged.
      The pinned packages are now admitted by Task 1; no live workers are qualified.
- [x] Approve the written [worker lifecycle spec](superpowers/specs/2026-10-19-worker-lifecycle-design.md)
      and accept [ADR-0002](decisions/0002-adopt-xstate-effect-for-worker-lifecycle.md).
- [x] Review the [worker lifecycle implementation plan](superpowers/plans/2026-10-19-worker-lifecycle.md)
      and approve execution (owner approval, 2026-10-19).
- [x] Complete Task 1's exact-cohort compatibility gate, commit `91c0f01`, with
      clean independent review and controller gates; see the
      [local cohort evidence](assessments/worker-lifecycle.md).
- [x] Implement Task 2's pure worker data, binding/readiness and custody checks.
- [x] Obtain clean independent reviews of Tasks 2-5 and their fixes, through
      `ee0d0f8`; earlier pending-review notes are historical.
- [x] Obtain Task 6's independent review after author qualification of stateful
      actor laws, constructive success paths and behavioral negative controls.
- [x] Obtain final whole-implementation review and controller approval through
      `f38b0e4`, including the reviewed released-owner fix and independent gates
      (458 tests / 1900 assertions). Live Docker, durable storage and scaling
      guarantees remain separate. No merge or push is implied.
- [ ] Approve worker isolation, repository profiles, execution caps and the manual
      dry-run architecture; qualify one real FoldKit migration before expanding.
      Historical replay case and Colima host direction are conversationally
      approved. The [written profile/worker spec](superpowers/specs/2026-10-21-foldkit-replay-profile-design.md)
      is owner-approved; its [first plan](superpowers/plans/2026-10-21-foldkit-replay-profile.md)
      covers offline profile inspection, approved for inline execution. No native
      worker or real migration is qualified.
- [x] Deliver Plan A's strict Draft replay profile, fail-closed pure inspector and
      bounded offline CLI with property/process tests. See the
      [inspection evidence](assessments/foldkit-replay-profile.md). Publication
      remains Disabled and all seven execution blockers remain present.
- [x] Draft the [native migration ledger plan](superpowers/plans/2026-10-22-native-migration-ledger.md)
      after owner approval of one atomic run/worker-authority boundary; written
      plan execution and the narrow lifecycle reply repair are now owner-approved.
- [x] Implement Plan B's native storage and author local restart qualification:
      [measured evidence](assessments/native-migration-ledger.md), five SIGKILL
      boundaries, 37 recovery controls and 3000 native refinement cases under the
      unchanged 180-second law bound. Tasks 1-4 independently reviewed.
- [x] Obtain controller-owned Task 5 and whole-branch reviews through `a94f945`:
      Approved with one Minor / ReadyToMergeYes, no Critical/Important. Both
      identified the same unguarded direct-child argv error path.
- [x] Complete scoped review of `a94f945..c3bc287`: Meitner Approved/ReadyToMergeYes,
      Minor closed, no new breakage. Controller own gates at `c3bc287` pass root
      check, 9 typechecks and 9 test tasks / 1161 tests. Native law: all 3000 cases
      in 133730.20ms within 180000ms. Broad review remains `03828ae..a94f945`,
      complemented by the scoped review; Markdown closure does not extend those
      reviewed ranges or authorize merge/push/operational activation.
- [x] Implement the owner-approved C1 offline Colima readiness foundation
      (implementation/subagent method approved 2026-10-23), including strict private
      contracts, bounded readers, safe projection and preflight-only CLI.
      Tasks 1-4 independently reviewed through `2e99143`; deferred pre-I/O guard
      coverage committed as `1b59157`, with 66 focused tests / 525 assertions,
      focused types and root check passing. See the
      [assessment](assessments/colima-readiness.md) and
      [runbook](runbooks/colima-readiness.md). No real host preflight was run.
- [x] Complete controller final repository gates on C1 code head `1b59157`:
      root check, all ten workspace typechecks and all ten test tasks pass,
      1227 tests / zero failures in 4m24.248s. Existing migration-storage refinement
      retains 3000 cases / 148083.89ms within 180000ms; no Colima native proof.
- [x] Obtain controller-owned Task 5 and independent whole-branch review of C1.
      Broad review `0f1b432..8a2a4a7`, scoped fix review `8a2a4a7..a2c1287`
      and bounded follow-up review `2758ded..ed98a19` now have no open findings.
      The follow-up closes the typed-timestamp guard gap. Controller gates at
      `ed98a19` pass root check, ten typechecks and ten test tasks / 1333 tests,
      zero failures. Owner-approved local main fast-forward to `2b8811f` is
      complete; merged-main gates pass root check, ten typechecks and ten test
      tasks / 1333 tests, zero failures, 4m12.276s. No push or native activation.
      Fallow report-only exits 1 for two live runtime fixture files plus the
      retained compatibility warning; unused-export findings are resolved.
      Actual host preflight was subsequently owner-approved and run against
      local main `65c1616`: arm64, 24 GiB physical memory, 12 logical CPUs;
      blocked report / exit 2, dedicated profile absent, clients unverified.
      See the assessment's first actual host preflight section. No VM/daemon
      activation or download occurred; C2 implementation and activation remain
      separate gates.
- [ ] Separately plan measured Colima/Docker readiness and acceptance/manual
      replay (C-D). No operational storage is initialized or native worker qualified.
      The [native worker readiness plan](superpowers/plans/2026-10-23-native-worker-readiness.md)
      now stops after verified Task 1 (`044c0c2`, independent review approved):
      empty mounts are Unknown with UnknownConfiguration. Task 2's
      [actual compatibility-gate outcome](assessments/native-worker-setup.md)
      is Blocked: no supported zero-sharing Colima path was established in the
      inspected sources, not a claim about all future releases. Research gate
      evaluated does not mean installed/native setup qualified; lock fields
      remain unresolved and Tasks 3-4 are not executable. A separate direct
      Lima + Docker assessment is recommended, not selected or implemented,
      preserving zero sharing and engine/ledger/XState. No installation,
      provisioning, isolation-policy change or diagnostic activation is approved.
      Plan C's conversational design and
      [written readiness spec](superpowers/specs/2026-10-22-colima-readiness-design.md)
      are owner-approved. The [C1 foundation plan](superpowers/plans/2026-10-22-colima-readiness.md)
      is implementation-approved and delivered offline; native C2 implementation
      requires separately authorized measured preflight facts and a separate plan.
      Read-only preflight and separately approved native diagnostics have distinct
      activation boundaries;
      no native diagnostics have been started or qualified by C1.
- [ ] Prove profile reuse with the postcode client rather than adding a second
      orchestrator or repository-specific service.
- [ ] Separately approve GitHub publication and least-privilege App access, and
      qualify durable reconciliation before unattended operation.
- [ ] Evaluate maintainer effort and safety across the internal corpus before
      unattended organisation-wide expansion.
- [ ] Deliver organisation discovery and configuration self-PRs as described below.
- [ ] Only then consider campaigns, more ecosystems or external tenants.

## Offline GitHub Admission Design

This is a separately approved design exercise, not permission to bypass the
real-worker or live GitHub gates above. The owner selected explicit operator
issue comments before discovery events, with previews only and no execution.

- [x] Review the conversational command/authority, inbox/replay and acceptance
      design sections for `/leviathan assess` on ordinary issues.
- [x] Review the written [offline admission spec](superpowers/specs/2026-10-20-github-admission-design.md).
- [x] Review its [implementation plan](superpowers/plans/2026-10-20-github-admission.md)
      and select subagent-driven execution (owner approval, 2026-10-20), with
      controller-owned independent review.
- [x] Qualify the owner-approved patched local GitHub channel cohort against
      strict new-probe types, the pinned Bun/Flue cohort and universal lint rules.
      [Repair `629ada7`](assessments/github-admission-repair.md) passes 466 tests /
      1924 assertions and fresh-directory frozen installation. The
      [unmodified artifact failure](assessments/github-admission.md) is preserved;
      this is not admission of the original unpatched artifact.
- [x] Implement and verify pure exact-command, identity and authority policy with
      six Effect Arbitrary laws: [Task 2 evidence](assessments/github-command-policy.md),
      18000 new primary cases, 481 total tests / 2058 assertions, clean independent
      task review of `0a435bc`. No inbox or verified ingress implementation implied.
- [x] Add the inferred Effect admission service and test-only atomic memory inbox
      contract: [Task 3 evidence](assessments/github-inbox-contract.md), 12000 new
      sequence cases, 518 total tests / 2422 assertions, clean independent review
      of `18695a6`. No native transaction or durability guarantee implied.
- [x] Add the scoped SQLite inbox and native transaction, rollback, revision and
      two-connection checks: [Task 4 evidence](assessments/github-sqlite-inbox.md),
      31 native cases, 549 total tests / 3810 assertions, clean independent review
      of `db21cc4`. Same-process reopen is not process-kill or host-loss evidence.
- [x] Prove bounded signed fixtures, runtime validation, current local fixture
      authorisation and transactional deduplication through one application
      bridge: [Task 5 evidence](assessments/github-verified-ingress.md), 635 total
      tests / 4124 assertions and clean independent review of `f5b96ba` after the
      async-reader cleanup correction. No model, listener, worker, coordinator
      invocation or GitHub writes.
- [x] Qualify SQLite process-kill recovery, behavioral negative controls and a
      measured offline evidence report: [Task 6 evidence](assessments/github-admission-recovery.md),
      645 tests / 4226 assertions, clean independent whole-branch review and fresh
      gates at `71afb64`. This is local process-restart evidence only.

The strict compatibility probe and pure Task 2 policy are locally qualified.
Task 3's service/memory contract and Task 4's native inbox are locally qualified.
[Task 5's verified-ingress bridge](assessments/github-verified-ingress.md) is
locally qualified and independently reviewed. The original async-reader lifetime
finding was corrected and re-reviewed. Process-kill recovery and measured final
qualification are complete under Task 6's
[recovery assessment](assessments/github-admission-recovery.md), with a validated
measured report and clean independent whole-branch review/fresh gates. The amended
offline admission plan is complete; no production durability or execution is
qualified by it.
Production hosting, live permission retrieval, execution and publication remain
separately gated even if a future offline probe passes.

## Local GitHub Ingress Rehearsal Design

- [x] Agree the conversational scope: one repository/installation, explicit
      operator IDs plus fresh write-or-higher permission checks, local Bun/SQLite
      and an operator-managed temporary HTTPS tunnel; admission previews only.
- [x] Review the written [local ingress spec](superpowers/specs/2026-10-20-local-github-ingress-design.md).
- [x] Review the [local ingress implementation plan](superpowers/plans/2026-10-20-local-github-ingress.md)
      and select its execution method.
- [x] Qualify local adapters, listener, immutable live evidence and replay-first
      admission with synthetic credentials and independent review.
- [x] Separately approve the exact live target, App grants, credentials, tunnel
      and finite rehearsal session before any live access or listener starts.
- [x] Complete the bounded admission/replay/restart/local-profile-revocation
      rehearsal and verify teardown. See the
      [live evidence](evidence/local-github-ingress/live-rehearsal-20261021-r2.md).

The separately approved live scope was exactly two test comments and three
manual redeliveries on one issue, with supervised temporary exposure. It is now
closed. No always-on deployment, worker execution, broader GitHub writes or cloud
storage is authorized. Local test persistence is not production durability.

Tasks 1-7, whole-branch review, final-fix scoped review and fresh controller
verification are complete through tested source `5e531ae`: 935 tests, six
typechecks, clean lint/format and all five restored behavioral controls.
The [controller closure](evidence/local-github-ingress/controller-closure.md)
records the review dispositions and independent final run.
The [measured manifest](evidence/local-github-ingress.json) distinguishes final
tested source from later evidence-only commits. Task 3 M1/M2 and Task 7's
readiness/archive findings are fixed. Moon notices and historical test-first
evidence limitations remain disclosed. The later bounded live result is recorded
separately; no broader execution/publication scope is authorized.

## Organisation Discovery And Configuration Self-PRs

**Outcome:** a maintainer no longer has to notice every new organisation repo and
manually start its central Leviathan configuration. Leviathan discovers eligible
repos and proposes its own configuration changes in a PR against the Leviathan
repository, not against the newly discovered consumer repository.

This is configuration self-maintenance, not permission for an agent to rewrite
Leviathan's implementation, change credentials or broaden its own authority.
No discovery task, GitHub App, schedule or live PR is created by this roadmap.

### Proposed Flow

- [ ] Reconcile the organisation's authorised repository inventory, using events
      for prompt discovery and periodic reconciliation for missed/duplicate events.
- [ ] Identify repos by stable organisation/repository identity, retaining current
      names as metadata so renames do not create duplicate onboarding work.
- [ ] Apply centrally reviewed eligibility, exclusions and opt-out policy. New,
      transferred-in or newly accessible repos are candidates, not automatic trust.
- [ ] Inspect bounded metadata and permitted manifest/config files at a recorded
      revision. Parse them as data; never execute scripts, installs or repository
      instructions to discover configuration.
- [ ] Generate a schema-valid, disabled onboarding entry and profile proposal
      from reviewed templates. Include known ecosystem/toolchain hints and proposed
      checks with source evidence. Missing or unsupported details remain explicit
      blockers, never invented runnable commands or an enabled migration policy.
- [ ] Validate the patch and open a draft self-PR in Leviathan containing only
      permitted registry/profile configuration and its review evidence.
- [ ] Reconcile an existing onboarding PR instead of opening another on duplicate
      events, rescans or uncertain publication outcomes. Preserve human branch edits.
- [ ] Require maintainer review and normal protected-branch checks. Merging a
      config proposal does not itself authorise migration execution or paid activity;
      activation must satisfy the separately approved repository/profile policy.

### Trust And Publication Boundaries

Discovery credentials are read-only. The self-PR publisher's write capability is
restricted to Leviathan; it does not gain consumer write access for onboarding.
Never expose publishing credentials to repository content, inspection workers or
model-facing tools. Treat manifests, AGENTS files and model output as untrusted.

Allowed changes are central repository-registry/profile configuration and bounded
evidence only. Reject modifications to application code, workflow permissions,
acceptance thresholds, credentials, dependency manifests, lockfiles or policy
allowlists that would expand access. No automatic merge, release, deployment or
execution on the consumer repo. Protect Leviathan's own execution profile from
implicit self-onboarding or recursive self-upgrade behaviour.

The approved GitHub App installation determines what can actually be discovered.
Repository access may be all-repository or selected-repository; do not claim full
organisation coverage when the installation sees only a subset. Surface access
gaps and incomplete scans. Do not interpret a failed/partial/empty response as
proof that all existing repos were deleted or should lose their configuration.

Recheck repository ownership, eligibility, installation access and target base
before publication. Access revocation, transfer out, archival or explicit opt-out
must prevent new work. Do not silently delete reviewed configuration or recreate
an onboarding PR that a maintainer explicitly declined; retain a reviewable
discovery outcome until an approved policy/input change permits another proposal.

### Acceptance Evidence

- [ ] A newly eligible repo yields one disabled onboarding proposal with evidence
      of its exact observed source revision and template/policy revisions.
- [ ] Duplicate, reordered and replayed observations do not create duplicate
      configuration or more than one active onboarding PR per stable repo identity.
- [ ] Rename/transfer/access-change cases preserve identity and enforce policy;
      excluded, opted-out, archived and inaccessible repos do not become active.
- [ ] Unknown ecosystems and missing check definitions stay visibly blocked, not
      falsely supported. Static inspection never executes consumer code.
- [ ] Partial/paginated/rate-limited inventory results cannot cause destructive
      registry changes or a false claim of complete organisation coverage.
- [ ] A lost PR response is reconciled against existing publication state before
      retry; human edits and a human-declined proposal are preserved.
- [ ] Patch validation rejects self-modifying code, credential/policy changes and
      edits outside the approved configuration/evidence paths.
- [ ] A real, separately approved GitHub rehearsal demonstrates a config-only
      self-PR against Leviathan without consumer writes, auto-merge or execution.

Prefer Effect-native property tests for identity stability, deduplication and
policy invariants over generated observation sequences. Use deterministic tests
for publication races, pagination, access failures and ambiguous responses.
Synthetic adapters do not count as proof of a live App installation or PR.

### First Bounded Step

After the preceding product/permission gates, design an offline proposal tracer:
captured authorised inventory plus static fixtures produce a validated config
patch and PR preview, with no GitHub writes. Limit the first design to one org
and one reviewed ecosystem template; unsupported repos retain disabled, blocked
draft entries. Its implementation needs a separate plan and effort allowance.

Measure the maintainer effort needed to turn a proposal into an accepted usable
profile against manual onboarding; that baseline is currently unknown. Do not
optimise for PR count. Reshape or stop if proposals routinely need a manual
rewrite, cannot preserve opt-outs/human edits, or require unsafe code execution
or broader write access to discover usable configuration.

## References And Limits

- [GitHub App installation scope](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)
  distinguishes all-repository and selected-repository access.
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
  must be mapped to the exact discovery and publication operations during design.
- [GitHub App installation APIs](https://docs.github.com/en/rest/apps/installations)
  expose repositories accessible to an installation, not an assurance of full
  organisation visibility.

These references establish platform constraints, not a qualified integration.
GitHub protocol details, deployment, durable scheduling and credential storage
remain future design work. The current qualification-gate scope is unchanged.
