# Read-Only Hosted Rehearsal Preflight

Date: 2026-10-28, approximately 22:45-22:52 UTC.
Source baseline: `7c0a45d`. Status: preflight only; no deployment or activation.

The owner approved the bounded hosted rehearsal. The selected scope is the
existing open [FoldKit test issue 57](https://github.com/opsydyn/fold-kit-experiments/issues/57):
repository `1247366304`, issue `5965919353`, owner/operator `257329185`, prior App
installation `173668921`. The issue state and author were verified live; the App
installation permissions have not yet been reverified for this new run.

## Observations

- The connected Cloudflare profile can read the intended account
  `d95812af050c2e549a3296899b7b43b3` and its existing Containers applications.
  Containers is therefore present in this account. No other app was changed.
- The same profile verified `opsydyn.xyz` is active under the intended account
  and that its Worker Routes list is currently empty. No route collision was
  observed; this read is not evidence that Alchemy's token can create a route.
- The actual `CF_TOKEN` consumed by Alchemy was read using Effect Config from the
  existing owner-only root `.env`, without printing or copying its value.
- `GET /accounts/{account_id}/tokens/verify` returned 200, `success: true`,
  `status: active`, expiry `2026-10-28T23:59:59Z`. The earlier user-token endpoint
  returned 401 because this is an account-owned token; that alone is not evidence
  of an invalid or expired credential.
- Workers script listing returned 200 with `success: true`. This establishes read
  access only, not write/deployment permission.
- Containers application listing returned 403 with `success: false` for this
  credential. The zone's Worker Routes listing also returned 403. The connected
  read-only profile's access does not confer those rights on Alchemy's token.
- The existing Docker client is installed, but its selected Colima daemon is
  stopped/unavailable. No VM was started and no image was copied, built or pushed.
  Pinned Alchemy mirrors remote image references before preparing them, so the
  existing daemon can be started for that image-copy step once credentials permit
  the approved operation. This is not a Linux qualification or custom image build.

## Next Operator Action

Supply a short-lived deployment token privately, scoped to this account with
Workers Scripts Edit and Workers Containers Write (UI may say Containers Edit),
plus Workers Routes Edit for `opsydyn.xyz` only. Store it as `CF_TOKEN` in the
existing protected root `.env`. Do not grant token-creation rights or use a global
API key. No existing token permissions were changed automatically.

The five-minute window will be selected immediately before activation, after
private provisioning succeeds. Existing approval is retained; a credential fix
does not require another design review. No fresh comment, redelivery, App token,
webhook enablement, route mutation, listener or connector was performed here.
