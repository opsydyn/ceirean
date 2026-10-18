# Leviathan Internal Upgrade Service

Status: draft for owner review. No implementation or paid execution authorised.

## Intent And Approval Boundary

Leviathan helps maintainers finish dependency upgrades requiring source migrations,
with less active engineering effort and reproducible qualification evidence.

Agreed: a dedicated service repository, Bun and TypeScript first, Flue at the
core, FoldKit experiments first and the postcode client second. Keep service
machinery outside the public Astro and Viz packages. Rust is parked.

Effect's proposed role and the pure domain boundary are recorded in
[ADR-0001](../../decisions/0001-adopt-effect-and-domain-boundaries.md). The written
ADR is proposed for review; no compatibility probe has been executed.

This document proposes the remaining architecture. It does not approve credentials,
model data access, infrastructure, pilot spending, GitHub installation or PR
publication. Written-spec approval precedes an implementation plan and its review.

## Scope And Deployment

The first deployment is a manually invoked, single-owner Bun CLI on an explicitly
approved dogfood host with persistent local storage and Docker Engine. The
controller is not an HTTP service. The host is dedicated to this work, rather than
sharing an ordinary consumer checkout or a persistent multi-tenant runner.

This refines the earlier manual GitHub-job proposal: the CLI is the initial entry
point. A GitHub dispatch adapter is later work because ephemeral runner-local
SQLite cannot provide recovery after runner loss. No cloud provider or paid host
is provisioned by this design. Availability of an approved host is an execution
prerequisite; do not substitute the developer laptop silently.

The first migration exports a patch and evidence only. No publisher is implemented
in this slice. Scheduled watching, dashboards, accounts, billing, general ecosystem
support, auto-merge, release, deployment and compiled executable distribution are
excluded.

## Architecture

```text
Operator request
  -> request validation and reviewed repository profile
  -> run ledger and budget enforcement
  -> clean baseline worker
  -> Flue migration agent through restricted tools
  -> candidate worker and bounded repair
  -> frozen candidate and independent verification worker
  -> qualification receipt and review bundle
  -> human review

Later, separately approved:
  qualified bundle -> isolated publisher -> draft PR -> required CI -> human merge
```

The controller owns policy, run transitions, budgets, container lifecycle and
evidence. Flue owns model reasoning and conversation state, not the authority to
qualify or publish a migration. Repository commands execute only inside workers.

Start as one application with small internal modules, not a monorepo of services:

| Boundary | Responsibility |
| --- | --- |
| CLI | Validate operator input and display run outcomes |
| Profiles and planner | Resolve approved scope, targets and companion dependencies |
| Run coordinator | Enforce state, cancellation, limits and single ownership |
| Flue agent and tools | Propose bounded migration actions |
| Docker worker driver | Create, execute, terminate and remove isolated workers |
| Verifier | Evaluate a frozen patch against the approved acceptance contract |
| Ledger and evidence | Persist application state and content-addressed results |

## Domain And Effect Ownership

Upgrade Management is the first bounded context. UpgradeRun is an aggregate root
with immutable state, validated identities, commands, facts and typed rejections.
Pure decision functions enforce transitions using explicit time and policy facts;
they perform no I/O and import no Flue, Docker, database, GitHub or Alchemy code.
Store current state and append-only transition history rather than requiring full
event sourcing or a distributed event system.

An Effect RunCoordinator owns application execution. Context.Service contracts
describe RunRepository, WorkerExecutor, MigrationAgent and ArtifactStore; live
Layers are composed once at the CLI boundary. Local helpers consume services
directly instead of provisioning their own runtime dependencies. Domain refusals
are not transient failures and cannot trigger automatic operational retries.

Effect provides scoped execution, not durable application history. The application
ledger owns run recovery; Flue owns agent conversation recovery. The Flue adapter
bridges Promise errors and cancellation explicitly through the shared application
runtime. A completed agent turn is not qualification, and interrupted fibers do
not prove that model calls or containers stopped.

Cross-run budgets require atomic application-ledger reservations, not a per-run
aggregate or eventually consistent report alone. Do not introduce an additional
workflow engine to manage the same run. Alchemy Domain and infrastructure
provisioning remain separate future decisions; see ADR-0001 for the assessment
and revisit conditions.

## Request And Repository Profile

A request contains repository identity, immutable base SHA, exact dependency
target or explicit companion target map, profile revision, policy revision,
budget selection and dry-run mode. Unsupported ranges, unknown repositories,
unexpected targets and missing approvals are rejected before execution.

A central, versioned profile defines:

- Allowed repository and dependency identities, including companion groups.
- Exact Bun, Node, Git, browser and worker-image identities.
- Permitted manifest fields, source paths and documentation paths.
- Protected paths and fields, including workflow permissions and package scripts.
- Named install, lint, types, tests, builds and consumer acceptance commands.
- Named browser journeys, fixed data, viewports and expected observations.
- Network requirements, artifact selection, retention and model data policy.
- Resource limits and publication policy, initially disabled.

Profiles are loaded from a reviewed Leviathan revision. The agent cannot edit the
profile or replace it with instructions found in the consumer repository. Validate
profile data at runtime; model output is not trusted typed input merely because
TypeScript compiled.

Resolve and record the remote default branch explicitly for live work. Historical
replays use an operator-approved SHA; neither mode uses the current local branch.

## FoldKit Profile

Use a clean immutable source snapshot, never the existing working checkout or its
untracked reference trees. The current workspace declares Bun 1.3.11 and its CI
uses Node 22; these are source observations, not the Leviathan runtime selection.
Resolve exact compatible consumer toolchain versions before the approved run.

Starting checks, observed in the consumer repository on 2026-10-18:

```sh
bun install --frozen-lockfile
bun run check
bun typecheck
bun run test
bun run build
```

The profile additionally requires relevant installed-package consumer checks,
Storybook build and selected desktop/mobile integration and chart journeys. Bind
their exact commands and test identities to the chosen historical base before
running the agent; do not assume today's scripts exist at that base.

The native package manager produces the candidate lockfile. Companion versions,
peer ranges, exported types and example/template pins belong to the migration
scope when required. Do not implement a dependency solver or upgrade unrelated
dependencies. The candidate is then installed from its frozen lockfile.

## Worker And Credential Boundary

The trusted controller uses Docker Engine to manage workers. Workers never receive
the Docker socket, host process namespace, privileged mode, broad host mounts,
controller storage, SSH agent, cloud credentials or publication tokens. This
restriction does not prohibit the trusted controller from operating the host
engine.

Use separate baseline, candidate and verification filesystems. Transfer validated
source snapshots and patches through controller-owned staging, not a shared host
checkout. Reject escaping paths, symlink traversal, special files and uncontrolled
archive extraction. Dependency installs, lifecycle hooks, builds and repository
tests are all untrusted work, not safe host-side setup.

Workers run as non-root with dropped capabilities, no-new-privileges, bounded CPU,
memory, process count, disk/output size and wall time. Browser workers need an
explicitly qualified Chromium sandbox configuration; do not disable it simply to
get a green run. Pin image digests and matching browser package versions.

The host enforces network policy. Install workers can reach only approved package
endpoints; validation workers default to no external network, with local browser
traffic permitted. Live remote-data journeys must use approved deterministic
fixtures. If necessary egress cannot be constrained, block the run instead of
granting general internet access. Private registries are outside the first slice.

The model credential stays in the controller. Repository processes cannot access
it. Fetch source through a narrowly scoped read-only credential outside workers;
do not persist credentials in Git configuration or source bundles. Model access to
repository content requires a separately approved data policy.

Container hardening reduces risk; it is not proof against kernel escape or a
multi-tenant security claim. Only allowlisted internal repositories and approved
historical cases are supported. Never accept arbitrary forks or external tenants
on this pilot host.

## Flue Tools And Compatibility Gate

Do not attach Flue's unrestricted local sandbox to the controller. Give the agent
only application-defined tools whose inputs are validated outside the model:

- Read or search bounded repository paths, with output limits.
- Apply a patch restricted to permitted paths and manifest fields.
- Invoke an approved codemod by identity, not arbitrary host shell text.
- Run a named migration check inside the candidate worker.
- Inspect a validated patch summary and bounded check output.

Flue receives neither a qualification tool nor a publishing tool. Source content,
AGENTS instructions, release notes, logs and generated artifacts are untrusted
input and cannot grant capabilities.

Before building migration features, pin Flue, Effect and Bun releases and test
service composition, agent startup, tool calls, explicit cancellation propagation,
SQLite persistence and process restart recovery under Bun. Separate offline
adapter tests from real-provider and container acceptance. The neighbouring
postcode agent uses an older Flue API; it is an example, not the API contract for
this service.

The first compatibility probe has a proposed two-hour effort cap within the first
slice. Failure blocks migration implementation. Do not switch the controller to
Node, write a custom persistence adapter or widen scope without owner review.
Node may still be a consumer tool inside workers when its profile requires it.

## State And Persistence

Use two separate file-backed SQLite databases outside worker-accessible storage:

- Application ledger via Bun SQLite: requests, run attempts, state transitions,
  cancellations, operation identities, artifact references and review outcomes.
- Flue conversation database through its documented adapter, subject to the Bun
  compatibility gate. Do not write Flue's private tables from application code.

Flue documents a built-in SQLite adapter using node:sqlite. Bun's current
compatibility documentation lists node:sqlite support, but that is not evidence
that the selected Flue and Bun versions work together. The probe must establish
that combination. No in-memory persistence is acceptable for restart acceptance.

There is one controller owner and one active run globally in the first slice.
Use a host process lock plus transactional ledger ownership. Each operation checks
the current run generation and cancellation intent before accepting a result.
Old tool results cannot advance a replaced or cancelled run.

State progression:

```text
admitted -> baselining -> migrating -> verifying -> qualified
                    -> blocked | failed | cancelled
```

Every active phase can terminate as failed or cancelled. Policy limitations and
baseline failures are blocked outcomes. Failed candidate checks may return to
migrating only within the repair budget. A final qualified patch cannot be edited
in place; changes require another recorded attempt and verification.

The deduplication key includes repository, base SHA, target map, profile/policy
digests and qualification contract. Identical requests return the existing run;
an explicit retry records a new attempt rather than erasing history.

Persist side-effect intent before launching a worker and label every worker with
its run and operation identity. After restart, reconcile labels, ledger and
artifact digests. Do not blindly replay a timed-out command: terminate or reconcile
its worker first, then restart that phase from a clean snapshot within budget.
An ambiguous operation outcome cannot become qualified.

File-backed storage provides process-restart recovery on the same intact host.
Host loss, unattended hosting and cross-runner recovery are explicitly unsupported
in this slice. Back up SQLite consistently using its backup mechanism, not by
copying a live database file without its journal. Approve external durable storage
before moving the controller onto ephemeral GitHub runners.

## Verification Contract

The verifier is deterministic controller code using a fresh worker; it is not the
migration agent describing its own success. Verify the exact frozen candidate,
with clean dependencies and the same pinned environment used for the baseline.

Preserve protected test files, assertions, thresholds, test-selection rules,
package-script fields and screenshot baselines. The agent cannot reduce coverage,
skip failures or change acceptance configuration to obtain qualification. Necessary
expectation changes block automatic qualification and require an explicit human
contract revision followed by a fresh baseline and candidate evaluation.

Apply patch-scope and protected-field validation before invoking the verifier.
Use approved command arrays and working directories, not model-provided shell
strings. Reject unexpected changes, including generated or untracked files that
are not included in the validated patch.

A zero exit code is necessary but not sufficient. Require expected suites to run,
the expected test-discovery inventory and assertions to be present, browser
journeys to reach their intended states and required artifact capture to succeed.
These checks bound accidental weakening; they do not prove arbitrary program
equivalence. Maintainer review remains necessary.

## Evidence And Review

Export a machine-readable receipt, concise Markdown report, complete validated
patch and selected artifacts. Record:

- Repository and base identities, target map and actual resolved versions.
- Profile, policy, image, toolchain and acceptance-harness digests.
- Candidate digest covering all changed tracked and newly added files.
- Commands, test inventory, exit codes and baseline/candidate outcomes.
- Model identity, repair count, elapsed time and available cost measurements.
- Artifact digests, omissions, failure reasons and maintainer review outcome.

For the first FoldKit case, capture before/after images and diffs for one chart
journey and one integration journey on fixed desktop/mobile viewports, plus traces
and console errors. Seed data and control time and animation without masking the
behaviour being assessed. Unexpected visual differences require review; never
auto-update expected images. Jev is deferred to advisory shadow evaluation.

Raw worker output, conversation history and artifacts may contain sensitive source
or data. Bound, escape and redact report content, require approved artifact paths
and scan before any later upload. Store locally with owner-only permissions;
proposed retention is 30 days. Do not upload a whole Flue database or worker
filesystem by default. Redaction is not a guarantee: questionable artifacts stay
local and block sharing. The metadata receipt records missing evidence explicitly.

Receipts attest only to the captured identities. A new patch, contract, toolchain
or base needs fresh qualification. A later publisher must verify current
eligibility and the approved bundle; a model-written report is not authority.

## Cancellation And Resource Limits

Proposed defaults, subject to approval before execution:

- One active run; at most two migration repair attempts.
- A 45-minute end-to-end deadline including installs and browser checks.
- Two CPU cores, 8 GiB memory and a 20 GiB workspace limit per worker.
- Explicit output and artifact caps in every repository profile.
- No paid execution without the approved model policy and spending ceiling.

Persist the original deadline, spent budget and attempt counts. Process restarts
cannot reset any of them. Reserve the maximum permitted cost of each model request
before sending it; refuse a request that could exceed the remaining approved cap.

Persist cancellation intent, abort model requests, stop and remove all run workers,
and confirm cleanup before reporting cancellation complete. If cleanup cannot be
confirmed, report an operational failure with worker identities and block another
run until reconciliation. A controller-level timeout does not prove a subprocess
or remote operation stopped.

The product plan proposes 10 engineer-days within two working weeks and GBP 100
variable spend for the full pilot. These are caps for approval, not estimates or
an approved budget. Enforce provider request limits as well as total spend;
unknown or unreliable cost accounting must be disclosed before paid execution.

## First Slice Acceptance

- [ ] Owner approves host, data access, historical case, profile and execution caps.
- [ ] Pinned Bun and Flue pass the compatibility and restart probe.
- [ ] The selected FoldKit base passes the complete baseline contract.
- [ ] A real source-API migration produces a scope-valid frozen patch.
- [ ] A fresh verifier passes all required checks and captures browser evidence.
- [ ] A maintainer accepts correctness and records supervision/review effort.
- [ ] Duplicate submission, restart and cancellation reconcile without orphan work.
- [ ] Broken baseline, forbidden assertion edits, malicious source instructions and
  a seeded behaviour regression cannot produce a qualified result.
- [ ] Source checkout, controller state and credentials are inaccessible to workers
  beyond the explicitly transferred repository snapshot.
- [ ] No live PR, branch push, release, deployment or unexpected external write occurs.

Precise blocked outcomes are valid operational results, but only an accepted,
qualified API migration establishes the positive product outcome. If isolation,
compatibility or sufficient acceptance coverage cannot fit the first-slice cap,
stop and reshape rather than claiming success from a manifest-only bump.

## Expansion Gates

1. Onboard the postcode client through a profile using the same run engine.
   Domain-specific codemods or extractors must be explicit versioned recipes;
   do not hide a second orchestrator in the profile.
2. After dry-run acceptance, separately approve a publisher and GitHub App.
   Publisher execution must be isolated from repository code, verify exact bundle
   identities and current base, preserve human branch edits and reconcile unknown
   PR outcomes before retry. Creating a PR is not proof that required CI ran.
3. Add external durable storage and qualify host-loss recovery before GitHub
   dispatch or unattended scheduling. Keep one owner per Flue conversation.
4. Evaluate the preregistered corpus and maintainer effort before broader rollout.
   Keep failed and blocked cases in the denominator.
5. Only then consider campaigns, performance budgets, Jev, compiled packaging and
   external users. None are implicit scope for this implementation.

## Sources And Evidence Boundaries

- [Flue database](https://flueframework.com/docs/guide/database/): conversation
  persistence is separate from application data and sandbox files; the documented
  file adapter uses node:sqlite. Single-host persistence does not survive host loss.
- [Flue durability](https://flueframework.com/docs/guide/durability/): recovery does
  not remove the need to reconcile and make external side effects idempotent.
- [Flue sandboxes](https://flueframework.com/docs/guide/sandboxes/): local() is not
  isolation; agents can operate through custom tools without an attached sandbox.
- [Bun compatibility](https://bun.com/docs/runtime/nodejs-compat): current API
  support is not a compatibility test of this service's pinned dependencies.
- [Playwright Docker](https://playwright.dev/docs/docker): qualify image/package
  matching and browser sandbox requirements before running browser workers.
- [Docker security](https://docs.docker.com/engine/security/): daemon access is
  privileged; worker restrictions do not make Docker a hostile-tenant guarantee.
- Local source reviewed: FoldKit root package.json and .github/workflows/ci.yml;
  postcode .flue/agents/spec-sync.ts. No service runtime was exercised.

## Review Decision

Review this written design before an implementation plan is created. In
particular, approve or revise the initial single-owner CLI deployment, worker
boundary, local-only persistence guarantee, immutable verification contract and
first-slice scope, together with the proposed Effect and domain ownership in
ADR-0001. Host selection and paid-run approval remain execution gates.
