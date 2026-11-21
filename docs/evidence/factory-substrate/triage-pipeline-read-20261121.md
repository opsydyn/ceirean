# Reading Factory's Triage Workflow

Recorded 2026-11-21. Prerequisite 3 of
[the Factory assessment](../../assessments/astro-factory-foundation-20261121.md).
**Done.** `src/triage/workflow.ts` read end to end at
`3a01af8566a580c3cefd5d1f06e1884679a1f135`: 1,840 lines, 38 durable steps, one
`WorkflowEntrypoint` with four handlers behind the FSM — triage, retriage,
verify-fix and cleanup.

This is the closest thing upstream has to our migration loop, so the point of
reading it is to decide what our loop should take and what it must not.

## What Our Loop Should Take

**Coordination is a step with a rollback.** `step.do('register triage
coordination', …, { rollback: completeCoordination })`, so a workflow that dies
still releases the per-issue queue slot. We vendored `QueueCoordinator` without
this, and it is the piece that makes the queue safe rather than merely correct:
without the rollback a crashed run leaves an entity's slot occupied until the
60-second alarm reconciles it.

**Each phase is its own step, with its own timeout and its own retry reason.**
Provision (20 min, 2 retries), install (20 min, 2 retries), build (35 min, 1
retry) are deliberately separate, and the comment says why: "a failure names
the stage that actually broke rather than 'the clone failed'." The retry
rationale differs per phase and is worth copying verbatim in spirit — install is
retried "because it is the most network-dependent thing in a run", build
"not because a failing build is flaky — it isn't — but because the container
underneath it can be."

For a migration this distinction is load-bearing in a way it is not for triage:
**the target suite failing is the signal we are looking for and must never be
retried**, while the container dying under it must be. Our `PlanStep` has a
timeout but no retry policy, and that is the right default only because we have
not yet separated the two.

**A container can be replaced mid-run, and the checkout does not survive it.**
Every container-backed step begins with `ensureTriageWorkspace(sandbox(),
setupWorkspace)`, which re-clones when the checkout is gone, and the build step
re-runs install when it had to recover. Our capability prepares once in
`Effect.acquireRelease` and assumes the checkout persists for the whole plan.
Durable workflows outlive containers; this is a real gap, not a refinement.

**Release the sandbox as soon as the last container step is done**, not on the
way out — upstream releases early "so a long external wait doesn't idle a
sandbox", with an idempotence flag and a `finally` as the backstop. We release
on every path but only at the end.

**Scoped, single-use tokens minted inside the step that needs them.**
`contents: 'read'` for a private clone, `contents: 'write'` only inside the push
step, and the comment notes the token "exists only inside this step".

**Idempotency keys per step for model calls.** `idempotencyKey:
${deliveryId}:${name}` on every agent dispatch, so a replayed step does not
re-run the model. Cheap, and the thing that makes an agent call safe under
workflow replay.

**Results keyed to the exact commit.** The preview release resolves the fix
branch head first "so a later push can never be mistaken for this run's
preview". Our `CandidateIdentity.candidateDigest` already carries this property;
good to find it independently arrived at.

**Poll, do not await a second ingress.** Preview releases are polled with
`step.sleep` for up to 30 minutes rather than awaited through a `workflow_run`
webhook, explicitly "so the whole capability stays inside this one durable
workflow instance, with no cross-instance event correlation to get wrong", and
because sleeping is durable and costs no compute. Waiting for a target
repository's CI on a candidate branch is exactly this shape, and we should do
the same.

**Failure bookkeeping with a cap and a repair path.** `MAX_TRIAGE_FAILURES`
with the count derived from marked comments, plus a "repair exhausted triage
state" step for a run stuck in `in progress`. Our `RunLimits.repairs` exists and
nothing uses it.

**Degrade the optional part, never the run.** Every preview-release failure mode
— unconfigured, undispatchable, failing build, malformed report, timeout —
returns "no preview" instead of failing triage, and logs a one-line breadcrumb
because "the whole point of the feature is invisible in the issue timeline when
it doesn't work out."

## What Our Loop Must Not Take

**The verdict comes from the model.** This is the sharpest divergence and the
most important thing in this read.

The pipeline is reproduce → diagnose → verify → fix, and each stage's result is
whatever the agent last wrote on a channel, parsed by `extractLastWrite` against
a Valibot schema. `result.fixed` is the model's own `fixed` boolean from
`fixResultSchema`. Nothing in the workflow runs the repository's tests to check
it: the config has `installCommand` and `buildCommand` and **no test command at
all**. When `autoPrOnFix` is enabled, the chain from a model's self-report to an
opened pull request contains no independent verification step.

That is defensible for triage. A human reported the bug, a human reads the
report, and the fix-verify handler exists precisely because the reporter
confirms or rejects the result; `autoPrOnFix` also defaults to `false`.

It is not defensible for a dependency migration, where there is no reporter and
the target suite is the only thing that can say whether the upgrade worked. This
is the concrete reason our acceptance contract is not redundant with Factory:
`validateReceipt` refuses a candidate unless every required check passed, and
the receipt's outcomes come from exit codes the sandbox observed, not from
anything a model asserted. Had we adopted the triage pipeline's shape wholesale
we would have inherited a loop whose success condition is a model's opinion.

Also not taken, for smaller reasons: labels as the state machine (our ledger is
the state), personas and PR handoff, the auto-PR path, and the comment and
conversation trimming, which is issue-timeline specific.

## What Has Since Been Closed

Two of the three gaps this read exposed are now closed in the capability, with
tests; the third cannot be closed yet and is recorded instead.

**Re-provisioning after a container swap — closed.** The sandbox port gained
`isPrepared`, and every step now begins by asking, re-preparing when the
checkout is gone. The test replaces the container after the first command and
asserts the plan still runs all three commands, with `prepared` at two and three
readiness checks: one per step.

**Retry the container, never the check — closed, and in the types rather than
in prose.** A `MigrationSandboxError` is retried under a bounded policy; a
non-zero exit is a _result_, so the retry policy cannot see it. Three tests pin
this: a transient sandbox failure takes four exec attempts for three commands, a
failing check takes exactly two attempts for two commands — a third would mean
the suite had been re-run — and the policy is injectable so tests exercise it
without five-second waits.

**Coordination rollback — not closed, and not closable here.** The rollback
belongs to the Workflow step that registers coordination, and we have no
Workflow: `qualifyRun` goes through `RunRepository` and `CandidateVerifier`, not
through the vendored `QueueCoordinator`. Whatever eventually enqueues runs
through that coordinator has to register with a rollback that calls
`complete`, or a crashed run will hold an entity's slot until the 60-second
alarm reconciles it. It is written into the vendoring design as a requirement on
slice 5 rather than left in this record.

## What This Read Does Not Establish

Nothing here was executed. The read covers the workflow's own file; the agent
prompts in `prompts.ts`, the pipeline agent in `agents/triage-pipeline.ts` and
the skill markdown that actually instructs the model were not read, and they are
where the real behaviour of each stage lives.
