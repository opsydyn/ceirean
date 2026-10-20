# Leviathan Roadmap

Local delivery map, updated 2026-10-20. Checkboxes describe delivered outcomes,
not permission to implement unchecked items. The organisation-discovery direction
is requested by the owner; its architecture, implementation plan, permissions,
hosting and execution appetite still require review.

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
- [ ] Review the written [offline admission spec](superpowers/specs/2026-10-20-github-admission-design.md).
- [ ] Review its implementation plan and select an execution method.
- [ ] Qualify the exact GitHub channel artifact against the pinned Bun/Flue cohort
      and universal lint rules before implementing the adapter.
- [ ] Prove signed fixtures, runtime validation, current local authorisation,
      transactional deduplication and SQLite process-restart behavior, with no
      model calls, listener, workers, coordinator invocation or GitHub writes.

These are future evidence requirements, not implemented capability. Production
hosting, live permission retrieval, execution and publication remain separately
gated even if the offline probe passes.

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
