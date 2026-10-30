# Read-Only Hosted Rehearsal: 29 October 2026

Source: `9e5fae7`, exported with `git archive` into an owner-only operational
directory. Dependencies were installed from the frozen lockfile with lifecycle
scripts disabled. Uncommitted observer research, credentials and the root `.env`
were not copied into the deployment source.

## Verified Private Deployment

- Account: `d95812af050c2e549a3296899b7b43b3`; zone: `opsydyn.xyz`.
- Stack/stage: `CeireanReadOnly` / `smoke-20261029`; pinned Alchemy beta.83.
- Worker: `ceireanreadonly-readonlyworker56trhdak554hd5gd7mzqrci7`.
- Worker ID: `58392f1a1a8d43d7958c37cc7ee4a483`.
- DO class: `ReadOnlyJob`; native application:
  `a2c938f0e2444cb594ce375ad5e87c7a`.
- Private apply succeeded at 18:27:14 UTC. Worker readback confirmed its DO
  binding, policy/signing-secret bindings, logs and traces. There was no
  `CF_TOKEN` or GitHub App key binding. Container SSH was disabled.
- Both workers.dev and preview URLs were independently read back as disabled.
- Source image was inspected as Linux amd64, without local execution:
  `docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09`.
- Cloudflare registry manifest:
  `sha256:a1b3ee8058f6b0e1462d4f83efa664f7760c0fa7fe51a66f95482aa1d5df9f45`.
- Cloudflare preparation reported `ready`, artifact:
  `sha256:2259c5333186ae1e519cd6372029217ee1ee8e685db6e3f74c1662891ecda1c3`.

The replacement credential verified as an active **user-owned** token, expiring
27 January 2027, rather than an account-owned token. The account-token verify
endpoint therefore returned 401; the user-token endpoint and Workers,
Containers and Routes reads returned 200. This is not a short-lived credential.
No credential value belongs in this record. The native browser initially opened
on the operator's token-reveal screen; rotate the token after this supervised
rehearsal and leave the reveal screen before any future browser handoff.

## Concrete Deployment Repairs

The first private apply stopped at Docker image pull because Colima was stopped.
After starting the existing default profile, pulling succeeded but pushing used
`/var/run/docker.sock`: Alchemy isolates registry credentials using a temporary
`DOCKER_CONFIG`, which loses the selected Docker context. Setting the operational
child's `DOCKER_HOST=unix:///Users/alancurrie/.colima/default/docker.sock` fixed
the copy without changing provider code or building a custom image. Preserved
Alchemy state allowed apply to resume after both failures.

## First Bounded Window: No Delivery Admitted

The admission window was 18:28:24.702-18:33:24.702 UTC (also UK local time).
An independent, exact-route removal watchdog was armed before activation.

- Alchemy activated only `ceirean-hooks.opsydyn.xyz/webhook`, route ID
  `1290c23b1b59410db8a4d5a9b4c0eabf`, at 18:29:06 UTC.
- An unsigned malformed POST was rejected with HTTP 400 / `MalformedInput`.
  Authenticated tail evidence recorded that response; this is not valid signed
  delivery, HMAC rejection, job execution or cleanup evidence.
- GitHub App/installation reads verified Issues Read and Metadata Read,
  `issue_comment`, selected repositories and the expected numeric identities.
  Issue #57 was open and the CLI operator matched numeric ID `257329185`.
- The browser showed webhook Active unchecked. UI activation was blocked pending
  action-time confirmation. No GitHub comment or redelivery was sent.
- Because confirmation had not arrived, Alchemy restored `Private` and an expired
  admission policy at 18:33:07 UTC, before the deadline. The watchdog completed
  with zero matching routes because teardown had already removed it.
- Independent API readback found no Worker routes and zero native instances.
  Workers.dev remained disabled. No tunnel connector or local ingress listener
  was started. The authenticated tail exited and Colima returned to Stopped.
- The confirmation arrived after the original deadline. It did not silently
  extend the expired window; a fresh relative five-minute window was requested.

## Fresh Confirmed Window: Runtime Succeeded

The owner confirmed a new five-minute window starting on receipt of confirmation:
18:43:27-18:48:27 UTC. The same exact-route watchdog was armed before activation.
No additional comment, image build, code change or deadline extension was used.

- The route-only/secret-policy apply completed at 18:44:06 UTC. GitHub webhook
  Active was enabled using the freshly confirmed browser action.
- One comment was posted at 18:44:22 UTC:
  [comment 6505395627](https://github.com/opsydyn/fold-kit-experiments/issues/57#issuecomment-6505395627).
- Original delivery `3851081277788651520` returned 403 / `NotAllowed` at
  18:44:25 UTC. Its numeric identity fields matched the approved allowlist.
- The one approved redelivery, `3851081578398629888`, returned 202 with a real
  `Queued` record at 18:46:45 UTC. Delivery IDs exceed JavaScript's safe integer
  range: the operational reader retained their original JSON numeric lexemes as
  strings rather than sending rounded IDs back to GitHub.
- A native `ReadOnlyJob` alarm claimed the job at `1793299605257`. Persisted
  Cloudflare observability, not only the human-readable tail, reported:

```json
{
  "_tag": "Succeeded",
  "sessionId": "readonly-20261029",
  "runtime": "v22.23.4",
  "queuedAtMs": 1793299605229,
  "closesAtMs": 1793299707000,
  "startedAtMs": 1793299605257
}
```

- The alarm completed successfully at 18:46:55.873 UTC, wall time 10,595 ms.
  Trace `4f565d8d4a27b8fda9fe1235ae4563bb`, request
  `eb6c785b8cdb2592231b6a0bdda6d5d4`, contains the terminal job payload.
- Independent native-instance readback identified object/instance
  `c7d1d05656b6c9126d6209272c7b63912a8fe2505473cc4b2bcc13e433a725ba`,
  name `readonly-20261029`, started at 18:46:47.048 UTC and **stopped** at
  18:46:55.814 UTC, exit code 0, using the reviewed registry digest.
  The stopped history record remains visible; this is not zero instance records.

### Rollout Skew Explains The First Refusal

The first request's stateless Worker ran version
`e278aa56-e863-436e-9154-138177f6aba8` (created 18:44:00.834 UTC). Its `enqueue`
RPC reached the same named DO on version
`bfed1d54-a73c-44c7-be3d-3709dee83f4f` (created 18:33:02.563 UTC during the
earlier expired-policy/private teardown). The redelivery and successful alarm
used the new version. These traces localize the 403 to an old-policy DO during
Worker/DO rollout skew; matching live GitHub IDs were not the problem.

Do not treat CLI apply completion as evidence that a DO is using the current
admission policy. Before a further activation, add a private policy/version
readiness check and cover this skew with a focused regression test. Do not use
an arbitrary sleep or permanently weaken the allowlist. No such implementation
or additional hosted run was performed in this rehearsal.

### Teardown

The Mac locked before the GitHub webhook-off action. Manual unlock was requested;
OS authentication was not bypassed. Alchemy immediately restored `Private` and
an expired admission policy, completing at 18:48:04.573 UTC, before the deadline.
Independent API readback found no Worker routes and no running instance. The
watchdog completed with zero matching routes, and the authenticated tail exited.
Colima had remained stopped throughout this second window.

After the owner unlocked the Mac and explicitly approved the final disable/save
action, GitHub webhook Active was unchecked and saved at approximately 19:00 UTC.
Reloading the App settings independently showed Active still unchecked, the same
webhook URL and SSL verification still enabled. App permissions were not changed.
Final Cloudflare readback confirmed no Worker routes, disabled workers.dev and
preview URLs, and the retained instance history record stopped with exit code 0.
Delivery shutdown was delayed by the locked Mac and action-time confirmation;
public routing and admission had already closed before the rehearsal deadline.
Teardown is complete; the private deployment and durable ledger are preserved.

## Verification And Remaining Gates

All 45 infrastructure tests, all 12 workspace typechecks, lint and formatting
passed in the existing worktree. Unrelated uncommitted research was preserved.

Signed GitHub delivery, durable admission/alarm execution, terminal success and
post-execution stopped-state readback are now observed facts. The first delivery
was refused, so this does **not** demonstrate two accepted deliveries returning
the same durable result without another execution. That hosted deduplication
check remains open; no extra redelivery was sent beyond the approved one.

The `readonly-20261029` session has consumed its one job. Preserve its ledger;
do not reset it or create a new execution without fresh approval. Browser
baseline, FoldKit inspection, migration patches and untrusted-code isolation
remain outside this runtime-only evidence.

## Local Follow-Up, Not Additional Hosted Evidence

The subsequent source change adds a private `readonly-policy-v1` descriptor and
full-policy comparison before admission, with a second comparison at the DO's
enqueue boundary. Stale/missing capability is a transient 503 instead of an
authorization 403. Status, authorization, execution and cleanup rules are
unchanged. The regression was observed failing (202 instead of 503 when the DO
guard was temporarily removed) and passing after restoration.
Independent review also identified rollback to the original unguarded enqueue
method. The correction uses `enqueueReadyV1` without a legacy fallback; a second
RED-to-GREEN regression verifies that a rollback after probing cannot call the
old method or mutate its job/alarm state.

A local signed HTTP bridge test composes those guards with the real Alchemy
storage adapter over transactional native-storage fakes. It verifies two accepted
deliveries around one successful execution, preserving the terminal job and
alarm history after reconstruction. A 1,000-case property checks policy identity,
session and window mutations. These tests do not change the hosted result above:
the new code is not deployed and a hosted private operator transport is not yet
qualified. No new route, webhook, comment, redelivery or runtime was activated.

## Later Private Follow-Up

The statements above describe the original rehearsal and its local follow-up.
A later, separately approved private update and authenticated readiness/status
check succeeded against the same expired policy and consumed ledger. See
[private readiness, 29 October](private-readiness-20261029.md) for the exact
source, deployment, observation and post-run limits. This adds no public delivery
or accepted-duplicate replay evidence to the original rehearsal.

The separate [30 October 08:48 run](accepted-replay-20261030-084800.md) later
verified two accepted deliveries and no observed reexecution within its fixed
window. That new session closes the replay gate; it does not change this original
rehearsal's first-refused/second-accepted history.
