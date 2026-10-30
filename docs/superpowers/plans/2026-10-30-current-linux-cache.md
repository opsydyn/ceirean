# Current Linux Cache-Only Rehearsal

Approved outcome: native Linux amd64 Bun 1.4.3 warm-up and fresh offline reinstall,
plus npm 10.9.9 cache consumption on Node 22.23.4. Repository scripts remain off.
Image builds/publication, browser/target checks and hosted activation remain blocked.

1. Verify the available runtime and obtain any required VM/pinned-image acquisition
   authority. Do not reuse the unrelated eh-containment profile. Bind the accepted
   source archive, composed 909-artifact inventory and frozen npm snapshot.
2. Test-first, prepare one narrow Node/Effect worker reusing archive inspection,
   private loopback replay and sealed cache copies. Warm Bun against local verified
   bytes, close replay, then reinstall fresh with the normal registry setting and
   network disabled. Validate installed package identities; never fake native cache
   paths. Consume all four inert npm profiles offline with scripts disabled.
3. Run the bounded rehearsal only after host authority is granted. Retain native
   evidence/cache identities or the concrete failure. Clean up only owned runtime
   resources, independently review, verify lint/types/tests and commit.

Ruling: this is cache-only evidence, not the full historical qualification suite,
the 16-check app baseline, native postinstall proof or hosted readiness. Default
registry cache compatibility must be measured, not inferred from localhost warm-up.

Host preflight: both default and eh-containment Colima profiles were stopped.
Default has 2 CPUs, 4 GiB RAM, 20 GiB disk. Separate approval requested for starting
default, acquiring only the two pinned tool images if absent, and stopping afterward.

Initial progress: existing source/caches remained unchanged. Pure command/runtime contracts
and a read-only fixed-inventory preflight were implemented. Compatibility fixes for missing ownership/device fields and
valid octal padding observed RED then GREEN with all old safety cases retained.

Independent review: checksum decoder crossed its field into the typeflag. Fixed
with exact eight-byte checksum validation; reproducer RED then GREEN plus 300
seeded cases. No deferred code finding or lint exception.

Owner subsequently approved the scoped inert numeric ownership policy and bounded
default Colima rehearsal. The Node/Effect worker is implemented with fixed commands,
runtime/source pins, replay finalizers, finite output/runtime budgets, cache seals,
default-registry fresh-install phase and output ownership checks. Bun installed
identity readback is explicitly incomplete and cannot count as qualified.

Actual attempt: Linux amd64 under QEMU on the aarch64 VM admitted 240/909 archives
then refused `@types/argparse@1.0.38`, whose legacy root is `argparse/` rather than
`package/`. No installer ran. All owned containers/volumes were removed, both VM
profiles are stopped, and the watchdog was terminated after cleanup. See the
updated evidence report for exact controls/times. No image build or hosted work ran.

This plan is not complete. Next approval must cover a narrowly tested legacy-root
policy, remaining Bun identity validation, and a fresh bounded runtime attempt.

Verification: 710 executor tests, 12 workspace typechecks and strict lint/format
passed. See `docs/evidence/current-baseline/linux-preflight-20261030.md`.

Follow-up verification: 734 executor tests (including 18 worker and 100 seeded
ownership cases), all 12 workspace typechecks, strict lint/format and the other
workspace test tasks passed. Independent review repairs cover pre-write admission,
evidence ownership, cleanup defects and reporting after cancellation. The repaired
source was not rerun in the VM. The cache-only outcome remains refused, not complete.

## Approved Offline Follow-Up

- [x] Add identity-derived legacy roots only behind verified inert ownership.
      Accept literal `package` or the registry identity's exact basename, with
      one consistent root per archive. Preserve all existing refusal rules and
      default strict behavior; do not rewrite authenticated bytes.
- [x] Reuse the installed-package auditor for current Bun workspaces. Parse the
      unchanged lock using a fixed invocation of the already-pinned Bun parser;
      audit warm-up and fresh installs independently, compare normalized summaries,
      and replace the explicit unchecked result. No new parser dependency.
- [x] Exercise real temporary filesystem fixtures, adversarial and seeded cases,
      then replay retained archive data offline where available. A mocked process
      status in a test is synthetic parser evidence, not Linux isolation proof.
- [x] Independently review, run executor tests, lint/format and all typechecks,
      document remaining gates and commit. Preserve unrelated observer work.

Ruling: this approval covers the offline policy/identity slice, not another VM
attempt. Colima, builds, publication, provider calls and hosted activation stay off.

Ruling: the retained synthetic replay now admits 241/909, then refuses a `runner`
uname on `@types/aria-query@5.0.4`. Named-owner metadata was not approved; keep that
rule and all limits unchanged. Require a complete offline admission pass before
requesting another runtime window. [Evidence and parser-isolation ruling](../../evidence/current-baseline/legacy-roots-identities-20261030.md).

Final review: fixed parser isolation with explicit trusted config, private
HOME/XDG_CONFIG_HOME and actual subprocess regression (preload control RED,
data-only production invocation GREEN). Ruling: `--config=PATH` is required by
the verified invocation; the separated form treated the TOML path as an entry
and produced no parsed JSON. Unsupported no-autoload switches were not retained.

Offline slice verification: 739 executor tests passed, 0 failed, across 65 files
and 29,887 assertions. All 12 typechecks and strict lint/format passed. Logs:
`/private/tmp/ceirean-legacy-tests-final.log` and
`/private/tmp/ceirean-legacy-types-final.log`. No VM or hosted rehearsal ran.
