# Legacy Roots And Bun Identity Readback

Scope: approved offline policy and identity work after `022b70e`. No VM was
started; no installer, image build, publication, target/browser check, provider
call or hosted action ran. Existing observer experiments remain outside this slice.

## Archive Policy

The default archive inspector still requires the literal `package` root. A
caller with genuine, process-local inert ownership authority may additionally
name one legacy root. Current fixed-inventory preflight derives that name from
the authenticated registry identity's basename: `@types/argparse` becomes
`argparse`. An archive must use exactly one root, even when both root names
would otherwise be permitted. Paths are inspected as-is, never rewritten.

Existing checksum, numeric encoding, gzip/CRC/EOF, mode, size/entry budgets,
traversal, collision, link, special-entry and named-owner refusals remain.
Regression cases observed failure then success for the ordinary legacy layout;
100 seeded legacy-root cases preserve strict defaults and mixed-root refusal.
The earlier 100 seeded inert numeric UID/GID cases also remain.

## Identity Readback

The worker now reuses `makeWorkerCases().auditInstalled`, rather than introducing
another package traversal. The accepted lock is parsed as data using a fixed
invocation of the already-pinned Bun executable. The lock hash is checked again;
selected/excluded registry records and reviewed workspace name/path pairs are
validated before inspecting installed manifests. Package code is never imported.

Warm-up and fresh installs each produce a `Checked` identity summary. Their hashes
include sorted, workspace-relative installed paths/identities, links, direct
resolutions and explained exclusions, so temporary absolute roots cannot change
the digest. The summaries must match before completion. Empty installs, missing
direct dependencies, unexpected versions, external links, unexplained omissions
and workspace substitution refuse. The old unchecked placeholder is removed.

These checks are implemented and exercised with actual temporary filesystem
fixtures, including 100 seeded version substitutions. They have not measured
the real Linux cache installation yet, and do not qualify postinstall or baseline
execution. The conservative lock selection may still expose a real omission
during a later controlled install; it must refuse rather than silently skip it.

## Parser Isolation Review

Independent review requested explicit parser-configuration isolation. A real
host subprocess regression first reproduced execution of a hostile preload.
The fixed command now uses `--config=/work/empty.bunfig.toml`, containing only
`preload = []`, and runs from the admitted private `/work`, not the source tree.
HOME and XDG_CONFIG_HOME point to its private home directory, which must still
be empty immediately before parsing. Environment inheritance, dotenv loading,
package auto-install and macros are disabled.

The regression executes the actual fixed JSON5 expression against JSONC data
with comments/trailing commas. A control without the explicit config executes
the hostile project preload and fails; the production flags read only the data
and produce the expected JSON, including from the hostile-project test cwd.
The production cwd is nevertheless kept outside that project.

Ruling: use a documented explicit config plus the verified private cwd/HOME
boundary, not unverified no-autoload CLI switches. Bun's configuration supports
preloads and merges global/local settings; see [Bun configuration](https://bun.com/docs/runtime/bunfig).
The local regression used controller Bun 1.4.2 on macOS, not the pinned Linux
1.4.3 runtime. Linux execution remains a separate gate. No new dependency,
native import boundary or lint exception was introduced.

The subprocess regression also exposed an argv pitfall: the separated
`--config PATH` form treated the TOML path as an entry and emitted no parsed JSON.
The verified `--config=PATH` invocation both avoids the preload and produces the
expected data. No unsupported no-autoload flags are included.

## Retained Archive Replay

A local-only test fixture supplied synthetic `/proc/self/status` data to the
unchanged authority reader, then ran read-only inspection of the retained inputs.
This is parser-policy evidence, explicitly **not Linux isolation proof**.

- Inventory SHA-256: `940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed`.
- Result: **Refused after 241/909**, with activation blocked and no native install.
- Next identity: **`@types/aria-query@5.0.4`**, artifact `artifacts/0241.tgz`.
- Archive SHA-256: `d454704bef5203e528f79d2f231b08baf415b151cbdb1ed70fb07a29b14ba6c8`.
- Exact first-header uname bytes contain `runner`; gname is empty. The existing
  `!header.uname` policy rejects it. Its ordinary `aria-query/` root is no longer
  the legacy-root blocker.
- Partial counters: 289,716,619 raw bytes, 1,004,953,245 expanded bytes,
  23,587 entries. These include a refused prefix, not a complete inventory audit.
- Retained report: `/private/tmp/ceirean-legacy-archive-readback-20261030.json`,
  SHA-256 `f3e550b31e56261fd2a5b2efb5d84c0381942f52f0b7cabc16c4a012c787a87a`.

Named-owner admission was not approved and remains unchanged. Before another VM
attempt, decide the inert uname/gname policy and get a complete offline archive
admission result. Do not spend another runtime window repeating a known refusal.

## Verification

739 executor tests passed, 0 failed, across 65 files and 29,887 assertions.
All 12 workspace typechecks and strict lint/format passed. Logs:
`/private/tmp/ceirean-legacy-tests-final.log` and
`/private/tmp/ceirean-legacy-types-final.log`. The read-only retained-archive test
also passed its diagnostic contract; its result is explicitly Refused, not
complete admission. A Node import smoke check loaded the updated worker without
Bun globals, but is not pinned Linux runtime evidence. No native cache success
or hosted readiness is claimed.
