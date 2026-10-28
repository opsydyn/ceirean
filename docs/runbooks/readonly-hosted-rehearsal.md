# First Read-Only Cloudflare Rehearsal

Status: implementation preparation only. No resources deployed or live endpoints
enabled by this change. This replaces the custom-observer programme as the next
delivery checkpoint, not its stricter research acceptance criteria.

## What This Proves

One signed `/ceirean assess` comment from one configured numeric GitHub operator,
on one configured issue in `opsydyn/fold-kit-experiments`, during a maximum
five-minute admission window, creates one durable job. A native DO alarm starts
its disposable container, executes only `/usr/local/bin/node --version`, records
the result and attempts destruction followed by an independent running-status
readback. Duplicates return the existing job, without another allocation.

This is a deployment/runtime smoke test. It does **not** run the FoldKit baseline,
inspect its dependencies, capture browser evidence, call a model or create a PR.
Those are subsequent product increments. The custom image/tracer/cache path is
not used. No complete untrusted-code isolation claim follows from this smoke.

## Prepared Composition

- Stack: `packages/infrastructure/readonly.alchemy.ts`, separate from the tunnel
  stack and from every local fault-injection probe.
- Private Worker: `ReadOnlyWorker`, `workersDev: false`, no public route.
- SQLite-backed DO: `ReadOnlyJob`, one configured session name, one job total.
- Dispatch: native alarm committed in the same storage transaction as admission;
  no Queue is needed for this single-job checkpoint.
- Native container: `ReadOnlyRuntime`, prebuilt immutable Node image from the
  existing reviewed recipe's source digest. It is copied at deployment, not built
  from repository code. Actual Cloudflare image preparation is still unverified.
- `enableInternet: false`, no sandbox credentials, no SSH, `lite` instance,
  60-second execution budget and 15-second cooperative cleanup observation budget.
- A queued job that misses its admission window expires without allocation.
  A restarted running job attempts cleanup only. An uncertain cleanup is recorded
  as `CleanupRequired`, never success. Its durable watchdog permits at most two
  additional cleanup-only attempts, counted before execution. Exhaustion keeps
  the unresolved record for operator reconciliation, without more allocations.
- One singleton admission is an application limit, not a verified account-wide
  container quota. Native inactivity timeout is a fallback, not a hard job deadline.

## Configuration

All runtime settings go through Effect Config. Required values are:

- `CEIREAN_READONLY_POLICY`: JSON containing `sessionId`, `installationId`,
  `ownerId`, `repositoryId`, `issueNumber`, `operatorId`, `opensAtMs`, `closesAtMs`.
  IDs are numeric, timestamps are epoch milliseconds and the window is at most
  300,000 ms. There are no default live IDs, issue or dates.
- `CEIREAN_READONLY_WEBHOOK_SECRET`: GitHub webhook signing secret, stored as a
  Worker secret by Alchemy; at least 32 characters. It never enters container configuration.
- `CEIREAN_PREPARE_READONLY=approved`: an accidental-invocation guard for this
  separate stack. Setting a variable is not owner approval for deployment.
- Existing validated `CF_TOKEN` and the pinned account are used only by an
  explicitly approved operational deployment. The old tunnel-only token may
  lack Workers, DO, Containers or registry permissions; do not broaden it silently.

Do not copy `.env`, PEMs or Alchemy state into a worktree or image. Keep deployment
state in the existing protected operational directory, not this temporary checkout.
Do not invoke the tunnel stack to deploy this Worker.

## One Bounded Activation Decision

Before the next external operation, agree one combined deployment/rehearsal scope:

1. Verify the Cloudflare account supports native DO Containers and review the
   exact plan, image-copy mechanism, spend allowance and necessary token scopes.
   No custom canary image build, Linux qualification suite or tracer is needed.
2. Select the existing test issue, numeric operator/installation/repository IDs,
   a fresh session and five-minute window. Prepare the exact
   `ceirean-hooks.opsydyn.xyz/webhook` Worker route. The current stack deliberately
   contains no public route; adding one requires this activation decision.
3. Deploy, verify the private resource/image bindings, then activate that route
   and the App webhook for the bounded window. Send one allowed comment and
   redeliver that delivery once. Check the private `status` RPC or structured
   Worker result log: the same job must be returned and the runtime must stop.
4. Disable webhook delivery/remove the public route, confirm the job terminal
   state and container absence, and retain the sanitized result. If cleanup is
   unknown, stop, manually reconcile the one named runtime, and do not run again.

This document authorizes none of these external operations. Once that combined
scope is approved, execute it end to end without inventing further speculative
research prerequisites. A real provider failure should produce a concrete fix,
not a new generic qualification framework.

## Current Evidence And Limits

The local tests cover policy boundaries, one-shot claim properties, outcome
encoding, restart policy, fixed native argv/start settings, capped output and
cleanup on failure/timeout. Transactional storage fakes exercise the real Alchemy
storage wrapper for duplicate admission, rollback, reconstructed-store recovery,
bounded watchdogs and compare-and-set protection against late writes. These are
not actual workerd SQLite or hosted alarm results. Alchemy's own Worker bundler compiles the entrypoint
and representative DO export metadata without provisioning. That test does not
execute the Worker or discover the actual deployment plan.

Real DO storage/alarm execution, Cloudflare image preparation, account eligibility,
live delivery, platform isolation and actual cleanup have not been demonstrated
for this new composition. A successful HTTP response or local test does not prove
the hosted milestone.

Next product increment after this smoke: inspect a pinned FoldKit manifest using
trusted code and export its dependency report. Then add fixed baseline commands
and browser evidence. Reassess execution controls before running repository
scripts, installing untrusted dependencies or admitting model-generated commands.
