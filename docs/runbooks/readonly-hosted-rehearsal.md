# First Read-Only Cloudflare Rehearsal

Status: signed GitHub delivery, durable alarm execution, terminal `Succeeded`
(`v22.23.4`) and stopped-container readback verified on 29 October 2026. The
public route is removed and admission expired. GitHub webhook delivery is disabled
and verified after reload; teardown is complete. Accepted-duplicate replay remains open.
The follow-up readiness guard and accepted-replay regression are implemented
locally, not deployed. They do not extend the hosted evidence.
See the
[hosted evidence](../evidence/readonly-hosted/rehearsal-20261029.md).
This replaces the custom-observer programme as the next delivery checkpoint,
not its stricter research acceptance criteria.

## Target Contract

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
  from repository code. Cloudflare image preparation was verified on 29 October.
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
- `CEIREAN_READONLY_INGRESS`: defaults to `Private`, which declares no public
  route. `Rehearsal` declares only `ceirean-hooks.opsydyn.xyz/webhook` in the
  verified `opsydyn.xyz` zone. Neither mode enables a workers.dev URL. Set it back
  to `Private` for teardown; arbitrary route strings are rejected.
- Existing validated `CF_TOKEN` and the pinned account are used only by an
  explicitly approved operational deployment. The old tunnel-only token may
  lack Workers, DO, Containers or registry permissions; do not broaden it silently.

Do not copy `.env`, PEMs or Alchemy state into a worktree or image. Keep deployment
state in the existing protected operational directory, not this temporary checkout.
Do not invoke the tunnel stack to deploy this Worker.

## Private Readiness Contract

The Worker and DO now expose a service-binding-only `readiness()` RPC. There is
no HTTP status route, diagnostic URL, public listener or new cloud resource.
The JSON descriptor contains `protocol: "readonly-policy-v1"` and the full
validated admission policy, never the signing secret or deployment credentials.
`status()` retains its existing job-only response.

The Worker's readiness method checks its DO's descriptor against its own policy.
An operator must additionally compare the returned descriptor to the **desired
local policy**, using `inspectReadiness(desiredPolicy, reply)`: an old Worker
and old DO agreeing with each other is not proof of the desired configuration.
This attests application protocol compatibility and exact policy, not equality
of Cloudflare deployment IDs or arbitrary code identity. Bump the protocol when
the readiness/admission wire contract becomes incompatible.

The signed ingress probes lazily before enqueue. Stale policy, malformed replies,
missing legacy capability and a probe exceeding its five-second cooperative
budget produce 503 without attempting admission. The DO also compares the
caller descriptor in the enqueue invocation, before any store access: a policy
change between probe and enqueue must not create a job or alarm. Numeric actor
checks and both existing time-window checks remain mandatory. No enqueue retry,
fixed rollout delay or weakening of an authorization rule was added.

Guarded admission uses the new `enqueueReadyV1(candidate, descriptor)` RPC only.
There is no fallback to legacy `enqueue(candidate)`: a rollback after a successful
probe must fail unavailable, not reach an old implementation that silently ignores
the guard argument. An older Worker calling a newer DO also fails closed because
the unguarded method is no longer exported. `status()` remains compatible.

Future operational order is **private preparation with the desired policy →
private readiness check against that policy → bounded route/webhook activation**.
Do not change the policy while opening the route. The repository has not yet
qualified a hosted operator transport to invoke this private RPC from the local
CLI. Do not substitute a public endpoint, assume CLI apply proves readiness, or
claim a live preactivation check from the synthetic tests. Qualifying that small
private transport and approving a new hosted window remain separate gates.

The local signed-bridge regression uses the real Alchemy storage wrapper over
the transactional native-storage fake: stale policy and probe/enqueue skew write
nothing; one accepted job executes and cleans up once; a second accepted signed
delivery after success returns the identical terminal job without changing its
ledger or alarm history. This is local evidence, not the missing hosted replay.

## One Bounded Activation Decision

Before the next external operation, agree one combined deployment/rehearsal scope:

1. Verify the Cloudflare account supports native DO Containers and review the
   exact plan, image-copy mechanism, spend allowance and necessary token scopes.
   No custom canary image build, Linux qualification suite or tracer is needed.
2. Select the existing test issue, numeric operator/installation/repository IDs,
   a fresh session and five-minute window. Prepare the exact
   `ceirean-hooks.opsydyn.xyz/webhook` Worker route. The stack remains private by
   default; the owner approved the bounded rehearsal on 2026-10-28. That approval
   does not broaden credential permissions or begin the five-minute window.
3. Deploy, verify the private resource/image bindings and current DO policy/version,
   then activate that route
   and the App webhook for the bounded window. Send one allowed comment and
   redeliver that delivery once. Check the private `status` RPC or structured
   Worker result log: the same job must be returned and the runtime must stop.
4. Disable webhook delivery/remove the public route, confirm the job terminal
   state and no running container (a stopped history record may remain), and
   retain the sanitized result. If cleanup is
   unknown, stop, manually reconcile the one named runtime, and do not run again.

This document authorizes none of these external operations. Once that combined
scope is approved, execute it end to end without inventing further speculative
research prerequisites. A real provider failure should produce a concrete fix,
not a new generic qualification framework.

The [28 October preflight](../evidence/readonly-hosted/preflight-20261028.md)
records the historical credential blocker. A replacement credential cleared it
on 29 October. A fresh confirmed window subsequently produced the terminal smoke
result. The first request reached an older DO version and was refused, so a
private readiness check for the current DO policy/version is the next focused
fix, now implemented locally as the contract above. CLI apply completion alone
is not readiness; do not replace this check with a fixed sleep or another
infrastructure qualification programme.

## Current Evidence And Limits

The local tests cover policy boundaries, one-shot claim properties, outcome
encoding, restart policy, fixed native argv/start settings, capped output and
cleanup on failure/timeout. Transactional storage fakes exercise the real Alchemy
storage wrapper for duplicate admission, rollback, reconstructed-store recovery,
bounded watchdogs and compare-and-set protection against late writes. These are
not by themselves actual workerd SQLite or hosted alarm results. Alchemy's own Worker bundler compiles the entrypoint
and representative DO export metadata without provisioning. That test does not
execute the Worker or discover the actual deployment plan.

Cloudflare image preparation, private provisioning, real signed delivery,
durable alarm execution and a persisted terminal success log have now been
verified. Independent native-instance readback confirmed stopped state and exit
code 0. The first delivery was refused, so accepted-duplicate/no-reexecution
proof remains open. This trusted smoke does not prove untrusted-code isolation.
Deployment uses the protected operational state, an explicit profile/stage and
an explicit Colima `DOCKER_HOST` for the pinned image copy; no custom image build
is needed.

Next product increment after this smoke: inspect a pinned FoldKit manifest using
trusted code and export its dependency report. Then add fixed baseline commands
and browser evidence. Reassess execution controls before running repository
scripts, installing untrusted dependencies or admitting model-generated commands.
