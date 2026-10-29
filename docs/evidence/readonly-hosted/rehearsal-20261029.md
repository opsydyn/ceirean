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

## Verification And Remaining Gate

All 45 infrastructure tests, all 12 workspace typechecks, lint and formatting
passed in the existing worktree. Unrelated uncommitted research was preserved.

Image preparation and private provisioning are now observed facts. A real signed
GitHub delivery, DO alarm execution, terminal job, one-execution replay and
post-execution cleanup are **not yet demonstrated**. Zero instances before any
admission is not proof that a running instance was destroyed.
