# Accepted-Replay Preflight: 29 October 2026

Execution scope: [bounded replay plan](../../superpowers/plans/2026-10-29-accepted-replay-rehearsal.md).
This record covers preparation only. No five-minute clock, live policy, public
route, webhook change, operator preview, comment, redelivery or execution was
started during this preflight.

## Local Verification And Source

- Infrastructure: 93 Bun tests across 17 files, 274 assertions, zero failures;
  nine compiled-export Node acquisition tests also passed.
- All 12 workspace typechecks passed; root lint and formatting passed.
- Existing observer research remains untouched and unstaged.
- Approved source `cf9aa9f6fea4567df9c7a52b8ee88353cd24c0d1` was exported
  into protected `readonly-cf9aa9f` operational storage, mode 0700. Frozen offline
  installation completed with lifecycle scripts disabled, using Bun 1.4.2.
- No diff from deployed `5f122fe` in infrastructure source, stack, patches or
  lockfile. No source upgrade or image change is planned for the next policy change.
- A local operational wrapper passed its preparation mode without reading
  credentials or starting the clock. Its start mode has not been invoked; the
  fresh policy file does not exist yet.

## Cloudflare Readback

- User-owned credential active, expiry `2027-01-27T23:59:59Z`. User-token verify,
  Workers, Containers and zone Routes reads returned 200. Account-token verify
  returned 401 because this is a user-owned token; no credential was printed.
- Account `d95812af050c2e549a3296899b7b43b3`, expected Worker/DO namespace and
  bindings unchanged. Latest deployment remained
  `71ec1069-faf5-4592-9605-7e69b34a9cd9`, version
  `ad6ae8fe-6362-4f45-8346-02e566e7090d` at 100%.
- Zero matching target/hostname routes. Both workers.dev and preview URLs off.
- Native application `a2c938f0e2444cb594ce375ad5e87c7a` remains DO-managed,
  SSH off, no authorized SSH keys, aggregate active/starting counts both zero.
  Active-instance listing was empty with no next page.
- Original instance `readonly-20261029` remained stopped, exit 0, unchanged since
  `2026-10-29T18:46:55.814Z`. Its retained image reference still ends in
  `sha256:a1b3ee8058f6b0e1462d4f83efa664f7760c0fa7fe51a66f95482aa1d5df9f45`.
- Current secret policy values were not exposed by management settings. No
  fresh authenticated operator invocation is claimed by these management reads.

## GitHub Readback

- App `5407709`, installation `173668921`, owner/operator `257329185` and
  repository `1247366304` match the approved scope.
- Issues Read and Metadata Read only, `issue_comment` subscription, selected
  repositories, no suspended installation. The target repository's installation
  endpoint confirmed the expected installation. No installation token was issued.
- Issue #57 is open: "Assess FoldKit 0.169.0 upgrade for Astro and Viz".
- Webhook configuration still uses `https://ceirean-hooks.opsydyn.xyz/webhook`,
  JSON and SSL verification. Delivery summaries contained only the original
  rehearsal's 403 and 202, with identifiers preserved as strings.
- The Mac was initially locked. After manual unlock, native settings showed
  Active unchecked, SSL verification enabled and Save changes available.
  Reload then required GitHub sudo-mode "Confirm access". The owner was asked
  to authenticate manually. Fresh saved-state/control verification remains pending;
  the cached unchecked display is not presented as successful verification after reload.

## Watchdog And Remaining Gate

The independent exact-route watchdog is prepared but not armed. Its read-only
check authenticated successfully and returned zero matching routes, clock not
started and zero mutations. Its deletion target is restricted to the exact
hostname/path and expected Worker; provider requests have bounded cooperative
timeouts and route removal is followed by readback. This preflight does not
prove live DELETE permission or provider availability at a future deadline.

Complete GitHub sudo authentication and verify the saved unchecked state and
controls before asking for the final start confirmation. That confirmation
creates a fresh session/window; no expired approval or clock is reused. If
credentials, source or cloud state changes, refresh the affected checks first.

## Subsequent Attempt

The owner later completed sudo authentication and saved-state verification, then
confirmed the fresh five-minute clock. The
[23:12 UTC attempt](accepted-replay-20261029-231248.md) passed private readiness
but stopped at the distinct browser action-time enable gate. It was torn down
without delivery or execution; the pending-authentication statements above are
historical preflight state, not the current blocker.
