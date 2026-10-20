# GitHub Channel Compatibility Repair

This is the owner-approved follow-up to the
[rejected unmodified dependency gate](github-admission.md). Keep Bun and Flue;
repair the declarations rather than replace the agent framework or disable checks.
This supersedes the earlier no-vendor-patch restriction only for the two exact
patches below. It does not authorize broader patches or admission Tasks 2-6.

## Root Cause

An import-only fixture with TypeScript 7.0.2 and `skipLibCheck: false` reproduced
three failures with Bun ambient types. Replacing only the ambient type set with
Node types left two failures: Flue's re-export and Google's missing MCP peer.
Only Gaxios's callable-property mismatch was Bun-specific. This was a type
environment comparison, not evidence that either runtime fails to execute.

## Repair Ownership

- `patches/@flue%2Fruntime@2.3.0.patch`: re-export `../dist/index.mjs` instead of
  `../dist/index.d.mts`. TypeScript resolves the adjacent declaration while
  preserving value exports and the existing Markdown ambient references.
- `patches/gaxios@7.3.1.patch`: in both ESM and CJS declarations, require the
  `fetch` call signature rather than all static properties of the global function.
  Bun's `fetch.preconnect` is not a property of a Gaxios instance method.
- `probes/github-admission/package.json`: explicitly install Google's declared
  optional peer `@modelcontextprotocol/sdk@1.25.2` as a development dependency.
  Its actual `Client` declarations remain checked. No `@ts-ignore`, stub,
  substituted MCP v2 type or Google runtime patch is used.

The explicit MCP v1 peer brings its own transitive installation footprint,
including server dependencies. It coexists with Flue's MCP v2 client; the probe
does not import or execute MCP v1, start its servers, or expose its transports.
This is a compatibility cost, not a claim that Leviathan needs another MCP server.
The lock retains all existing package entries and pins the added dependency tree.

Root `patchedDependencies` and `bun.lock` register both Bun patches. No JavaScript
implementation in either package changes. Bun 1.4.2, Effect 4.0.5, Flue 2.3.0,
TypeScript 7.0.2 and all 141 Effect lint rules remain unchanged. The new probe uses
`skipLibCheck: false`; the older probe's historical exception is not inherited.

## Removal Criteria

1. Remove the Flue patch only after an upstream artifact resolves its public
   declaration entry correctly and the strict probe passes without the patch.
2. Remove the Gaxios patch only after both distributed declaration variants no
   longer demand Bun-specific static properties. Check the transitive Google
   Auth constraint; do not force an unrelated Gaxios major upgrade.
3. Remove the explicit MCP peer only when Google's actual published declarations
   can be checked without it. An upstream suppression is not equivalent to
   checking a real `Client` type; review that tradeoff explicitly.
4. Re-run frozen installation, strict probe types, all workspace checks and the
   real-handler tests whenever changing this cohort or either patch.

## Verification

The strict new probe first reproduced all three vendor diagnostics. Supplying
the MCP peer removed TS2307; applying the two declaration patches then removed
TS2846 and TS2416. No diagnostics were suppressed.

Eight in-process tests invoke the actual `createGitHubChannel().route().fetch`
handler with WebCrypto-signed synthetic requests: valid delivery, missing/invalid
signature, tampered bytes, ping, synchronous callback throw, deferred callback
rejection, whitespace-bearing payload and
oversized body. They check parsed payload/metadata, not raw-byte retention by
the callback. No listener, real GitHub event, credential, model or agent is used.

Measured controller checks on 2026-10-20:

| Gate                                                             | Result                                      |
| ---------------------------------------------------------------- | ------------------------------------------- |
| Root `bun run check`                                             | 0 warnings/errors; formatting clean         |
| Domain, engine, old probe, new probe uncached typechecks         | All pass                                    |
| Domain tests                                                     | 186 pass / 634 assertions                   |
| Engine tests                                                     | 236 pass / 1162 assertions                  |
| Existing Flue probe tests                                        | 36 pass / 104 assertions                    |
| Strict GitHub channel probe tests                                | 8 pass / 24 assertions                      |
| Total                                                            | **466 pass / 1924 assertions**, no failures |
| Frozen install in existing worktree                              | Pass                                        |
| Empty-directory frozen install, strict new-probe types and tests | Pass                                        |

The clean installation copied manifests, lock, patches and source, not existing
`node_modules`. Its lock hash matches the worktree after installation:
`9659b60ff39f9d38bfc54e5aea5bccc7ba47a0ba37e2ca01598cf3b75e76d5c4`.
This proves reconstruction from the committed repair inputs with Bun's package
cache available; it is not a cold-cache network or CI-platform qualification.

Independent source review found no Critical/Important findings and two minor
test gaps: asynchronous callback rejection and global diagnostic capture. The
candidate now checks both throw and controlled deferred rejection, using a
restored scoped spy matching the specific synthetic error. Focused re-review
found no remaining findings. The controller reran the eight handler tests, strict types and root
lint/format after the test change. Existing package tests were unchanged.

This admits only the **patched local cohort**, not the original unmodified
published artifacts. The old Flue probe retains its historical local
`skipLibCheck` exception; this repair does not claim to remove that separate
policy or qualify its whole vendor tree under strict checking.

## Next Boundary

The repair only qualifies the private channel compatibility probe. It does not
implement command authorization, durable inbox admission, replay protection,
SQLite transactions, an HTTP service or GitHub writes. Resume the next bounded
admission task only after owner approval.
