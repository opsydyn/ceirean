# Scheduled Replay Preparation: 30 October 2026

**Status: privately staged; activation is not authorized by this preparation.**

The owner approved pre-staging a scheduled window and addressing shutdown
reliability after the [earlier abort](accepted-replay-20261030-075551.md). No
relative clock is created after a UI action. The desired schedule is immutable;
missing it means abandoning the attempt, not moving its timestamps.

## Verified Private Preparation

- Session: `readonly-replay-20261030083500`.
- Scheduled UTC/UK window: **08:35:00-08:40:00**, 30 October 2026.
- Policy epoch bounds: `1793349300000` / `1793349600000`.
- Identities unchanged: installation `173668921`, owner/operator `257329185`,
  repository `1247366304`, issue `57`.
- Trusted source remains the protected clean export of
  `cf9aa9f6fea4567df9c7a52b8ee88353cd24c0d1`; explicit Bun 1.4.2 and child PATH.
  No dependency, production-source, lint-rule or image change.
- The operational preparation helper accepts canonical future UTC timestamps,
  one to thirty minutes ahead, and writes the policy once with owner-only mode.
  It no longer creates/rebases a window when activation is approved.
- Invalid schedule input was refused without creating the policy file. The real
  `deploy-route` invocation was then refused before credentials/provider setup
  because the prepared window had not opened. Private preparation/probing alone
  can operate before the start; activation cannot.
- Private plan: one existing Worker update; every DO/container resource unchanged.
  Apply completed at 08:26:51.469 UTC, without class migration, image copy/build,
  Docker, Colima, new job or alarm.
- Deployment: `aa24926a-ae44-491e-932f-b8707f50843f`, created at
  `2026-10-30T08:26:48.844315Z`; version
  `00708b09-7bb5-4470-850d-011077e3290e` at 100%.
- Authenticated readiness/status/readiness returned exit 0, `readonly-policy-v1`,
  the exact future policy and `job: null`. This is observed remote readiness,
  not merely CLI apply success, and does not admit a job.
- Management readback found no matching route and both public Worker URL flags
  disabled. Native instance preflight found no active instance or next page.
- GitHub settings after reload showed Active off, SSL verification on and the
  save control accessible. No App setting was changed during preparation.
- Local checks: all 93 infrastructure Bun tests (274 assertions), nine Node
  acquisition tests, all 12 workspace typechecks and root lint/format passed.
  Observer research remains untouched and unstaged.

## Shutdown Controls And Limits

The owner separately approved a ten-minute `caffeinate -d -i` process during the
rehearsal/shutdown and agreed to remain available for manual shutdown. It is
temporary idle display/system-sleep prevention only: no credentials or lock
settings change, no OS unlock, and no prevention of explicit/manual locking.
Permission alone is not evidence that it is running. The initial detached
launcher did not persist (no process or OS assertion was observed), so it was not
relied upon. An owned session then started PID `31998` for only the remaining
536 seconds of the original lease, ending no later than 08:42:38.315 UTC.
At 08:33:44 UTC, `pmset -g assertions` independently showed that PID holding both
`PreventUserIdleDisplaySleep` and `PreventUserIdleSystemSleep`, with bounded
timeouts. No additional ten-minute extension was added. This is observed
idle-sleep protection, not proof against explicit locking or network/provider
failure; the owner remains the manual shutdown fallback.

The route watchdog now reads this same scheduled policy, logs its actual deadline
and uses it unchanged. The previous hardcoded cutoff is removed. It remains a
separate process that can attempt exact-route removal even if the browser becomes
unavailable. It is not a GitHub webhook-off control, and provider API timeouts
remain cooperative rather than hard deletion guarantees.

GitHub's documented [App webhook configuration API](https://docs.github.com/en/rest/apps/webhooks#update-a-webhook-configuration-for-an-app)
lists URL, content type, signing secret and SSL-verification updates, but no
Active switch. No undocumented Active PATCH or alternative authentication route
will be used. This API therefore supplies no qualified automated webhook-disable
fallback. Saved-off state still needs native UI verification and owner availability.

SDK preview-capability lifetime/revocation remains unverified. None of these
controls makes a locked desktop safe to ignore or proves fully unattended shutdown.

## Remaining Activation Gate

- [x] Pre-stage and remotely verify the exact future policy while private.
- [x] Refuse early route activation; preserve all earlier session ledgers.
- [x] Obtain separate permission for temporary keep-awake protection.
- [x] Start the bounded keep-awake process late enough to cover the whole window;
      verify its process identity and OS power assertions. Stop it after verified
      teardown, or let the approved ten-minute lease expire; never extend silently.
- [ ] Recheck the saved-off native controls and exact-route absence.
- [ ] At/after 08:35, obtain immediate confirmation for Active + Save changes,
      the exact route, one comment/redelivery and shutdown by the fixed 08:40 deadline.
      No enable action may precede that confirmation or the scheduled start.
- [ ] If approved and controls are ready, arm the independent watchdog, use the
      unchanged prepared policy for route-only activation, then exercise the existing
      one-job contract. No private policy deployment belongs inside this window.
- [ ] Stop new work by 08:37:30 and begin teardown by 08:38, reserving two minutes
      for UI/provider cleanup. Never relax the helper's 08:37 activation cutoff or
      send an extra comment/redelivery to rescue incomplete evidence.
- [ ] Verify saved Active off, no matching route, expired admission, durable result
      and no active container; record partial evidence honestly if anything fails.

This preparation authorizes no activation, comment, redelivery or execution.
If final consent does not arrive in time, the private future policy simply ages
out; it cannot open a route, enable the webhook or dispatch a job by itself.
