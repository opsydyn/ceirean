# GitHub Admission Compatibility: Blocked

Task 1 was attempted on 2026-10-20 with the owner's explicit execution and
installation approval. **The published-channel dependency gate is rejected.**
No admission implementation or new dependency workspace is retained. Tasks 2-6
remain unstarted. Independent task review approved the blocked disposition at
`13cd821`, not dependency admission. Any next decision remains with the controller.

## Tested Identity

- Worktree: `/private/tmp/leviathan-compatibility`, branch
  `codex/github-admission-design`.
- Starting source: `8f90edca36651bb2b420cfe0bcc52b300e29bd30` (clean).
- Bun `1.4.2`, Effect `4.0.5`, Flue runtime `2.3.0`, TypeScript `7.0.2`,
  Moon `2.5.4`, bun-types `1.4.2`, oxlint `1.88.0`, oxfmt `0.73.0`,
  Effect lint `2.0.1`; existing XState pins unchanged. Node `24.15.0` is tooling
  only. All 141 Effect rules remain errors.
- Baseline and restored lock SHA-256:
  `aa90aa27ce4e98d36624b1b701e2f93ea988afa52dc157294b9219809cd5e32e`.
- Attempted lock SHA-256:
  `aebcf2c5488d46abfe82ef31a025ee9257da36f719c95ef3760ff42711d2937e`.

## Published Artifact

Verified the exact public [registry manifest](https://registry.npmjs.org/@flue%2Fgithub/2.3.0)
and downloaded tarball for `@flue/github@2.3.0`. Measured integrity matches the
approved value verbatim:

```text
sha512-YMhbDT8P3xt3ilO3OI9xOebiitTqy1z5kdLEL+1MB6mdGeYiGO1aEkjQPK1pmSK1hN6HAQNNpcOGZWJ/hhXpDg==
```

The 8861-byte tarball has SHA-256
`ea49fe6e2af56a14af1450af3f8a16b3d02c1409aa0563b151b2bbeeceba312c`.
Its exports are `dist/index.mjs` / `dist/index.d.mts`; runtime peer is `^2.3.0`;
dependencies are `@octokit/webhooks-types: 7.6.1` and `hono: ^4.12.32`.

One approved `bun install --ignore-scripts` succeeded. The subsequent
`bun install --frozen-lockfile --ignore-scripts` passed without changes. The lock
added only GitHub, webhook-types and the new probe workspace entry; all existing
entries were unchanged. Physical resolutions were GitHub `2.3.0`, webhook-types
`7.6.1`, existing Hono `4.13.13`, the same runtime `2.3.0` for both probes, and
one physical Effect `4.0.5` instance shared by every workspace. No direct
Hono/Octokit import or extra SDK installation was added.

## Mandatory Strict Failure

The temporary private `@leviathan/github-admission-probe` explicitly used
`skipLibCheck: false`, strict inherited options and uncached Moon tasks
(`cache: false`, `retryCount: 0`, `envFile: false`, test timeout `30000ms`).

`moon run github-admission:typecheck --force --no-actions` exited **1** with
exactly three vendor declaration diagnostics:

- **TS2846**, `@flue/runtime/types/index.d.ts(4,15)`: a declaration file cannot
  be imported without `import type`; suggests `../dist/index.mts`.
- **TS2307**, `@google/genai/dist/genai.d.ts(1,29)`: cannot find
  `@modelcontextprotocol/sdk/client/index.js` or its declarations.
- **TS2416**, `gaxios/build/esm/src/gaxios.d.ts(52,5)`: `Gaxios.fetch` is not
  assignable to `FetchCompliance`; required Bun `fetch.preconnect` is missing.

This is the approved stop condition. There were no shims, declaration-check
waivers, new missing SDKs, vendor patches, cohort changes or lint exceptions.

## Runtime And Attempted Checks

The pre-install strict RED was unresolved-package TS2307, not behavioral RED.
After writing tests, an unsigned fixture produced genuine assertion RED:
3 pass / 4 fail (401 instead of 200/500). WebCrypto HMAC signing then established
the requested real-handler behavior. A mistaken plain-text error-body assertion
was corrected after inspecting Flue's actual structured-error handler.

Final attempted runtime checks: **7 pass, 0 fail, 20 assertions**, using only
in-process `channel.route().fetch(request)` and synthetic secrets/payloads:

- Valid signature: 200, one callback, native event and identity fields preserved.
- Invalid and missing signatures: 401, no callbacks.
- Post-signing byte tampering: 401, no callback.
- Ping: 200, no callback.
- Callback error: 500 with `internal_error`, not accepted application success.
- Whitespace-bearing signed body accepted; parsed payload and event/delivery ID
  preserved. This does not prove raw-byte capture or digest retention.
- Body limit `65536`: signed `65537`-byte request gets 413, no callback.

These runtime successes do **not** admit the artifact. The attempted root
`bun run check` also exited **1**, with three author-owned prototype lint errors:
`no-string-sentinel-const` on the fixture secret, `no-naked-object-state-update`
on fixture `JSON.stringify`, and `no-try-catch` on test `try/finally`. Formatting
was not reached in that failed check. These failures are preserved, not waived
or hidden by repairing code that the stop condition requires discarding.

The initial baseline launcher accidentally overlapped commands. Those logs are
non-qualifying; the complete baseline was rerun sequentially before edits.
That qualifying baseline and all installed existing workspace gates passed:
domain 186 tests / 634 assertions, engine 236 / 1162, old probe 36 / 104,
with zero test failures and all three existing typechecks passing.

## Restoration And Evidence

Archived the exact attempted source/config/lock and vendor declarations before
restoring only this task's Moon mapping, lock delta and five new probe files.
Tracked setup/source now matches the starting commit; the lock hash matches
baseline. Ignored installation/cache artifacts are not an admitted workspace.
Controller `progress.md`, existing source/tests and root policy were untouched.

The complete restored baseline passed sequentially in the minimal environment:
root lint/format (0 warnings/errors), all three existing uncached typechecks,
domain 186 tests, engine 236 tests, old probe 36 tests, and `git diff --check`.
Total: **458 pass, 0 fail, 1900 assertions**. This restored baseline result is
distinct from the rejected attempted dependency gate and prototype lint failures.
The owner approved the plan and selected subagent-driven execution. Tasks 2-6
remain pending, not started.

Full command/exits, complete diagnostics, RED/GREEN logs, exact manifest/tarball,
`attempted-source.tgz`, `attempted.bun.lock`, `vendor-declarations.tgz` and the
detailed self-review report are retained under the ignored directory:
`.superpowers/sdd/2026-10-20-github-admission/` (`scratch/` and
`task-1-report.md`). No global network fetch, live GitHub access, listener, model,
agent dispatch, coordinator, worker or publisher was used by the new probe.
The author report is self-review, separate from the independent task review in
`task-1-review.md`. That review found no critical or important issues in the
blocked disposition. Its minor evidence-wording clarification is incorporated
above: the custom-body test observes parsed payload/metadata, not raw bytes at
the callback. The controller checked the archived assertion before correcting it.

Controller closeout also confirms an empty source/configuration/dependency diff
against the starting commit, the exact original lock hash, current clean lint
and formatting, 33 resolving local documentation links and the recorded restored
gate results. This documentation-only closeout does not extend runtime evidence
or admit the rejected package. Main remains unchanged at `1fb038c`; no merge or
push was performed.
