# Worker Lifecycle Compatibility Gate

Task 1 compatibility gate passed locally on 2026-10-19, pending independent review
before Task 2. This gate does not implement the worker lifecycle or qualify live
mechanisms. ADR-0002's framework selection is unchanged.

## Baseline

Clean branch `codex/worker-lifecycle-design`, HEAD
`698806cdd732d2a48520a44ef8f30ff6c6272277`. Root lock Git blob
`5394db9099be0a5888b9bc0a247f6d9920fb5cad`; SHA-256
`94a67265d92385e3bff7a980c22a49ace848a15f3d1f3cf641f3e0d71f2af024`.

Actual tools/packages: Bun 1.4.2, Moon 2.5.4, Effect 4.0.5, TypeScript 7.0.2,
bun-types 1.4.2, oxlint 1.88.0, oxfmt 0.73.0, @opsydyn/oxlint-effect 2.0.1;
Node v24.15.0 is tooling-only. Engine vendor checking is `skipLibCheck: false`.

Fresh sequential baseline commands all exited 0 under
`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"`:

```sh
bun run check
moon run domain:typecheck --force --no-actions
moon run engine:typecheck --force --no-actions
moon run probe:typecheck --force --no-actions
moon run domain:test --force --no-actions
moon run engine:test --force --no-actions
moon run probe:test --force --no-actions
git diff --check
```

Lint: zero warnings/errors. Domain: 119 tests / 407 assertions; engine: 55 / 201;
probe: 36 / 104. Total: 210 / 712. None of these existing tests is new actor proof.

## Exact Artifact And Resolution

Only the private engine manifest gained `@xstate/effect@0.1.0-alpha.6` and
`xstate@6.0.0-alpha.64`. Complete manifest/lock diff inspection and a structured
JSONC comparison found exactly those two added package records, no changed or
removed existing package records, and only the engine workspace record changed.
The existing Zod/probe dependency cohort was not changed or extended.

Script-free install and then frozen script-free install both exited 0:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" bun install --ignore-scripts
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" bun install --frozen-lockfile --ignore-scripts
```

The initial sandbox install failed with `tempdir: EPERM`; the approved escalation
succeeded, installing two packages. Frozen output: `Checked 126 installs across
180 packages (no changes)`. No caches were deleted.

Evaluated lock Git blob: `15c84a8a0dac6c0d43c169c682d710674232b6a6`.
SHA-256: `aa90aa27ce4e98d36624b1b701e2f93ea988afa52dc157294b9219809cd5e32e`.
Exact registry artifact integrity from that lock:

```text
@xstate/effect@0.1.0-alpha.6
sha512-6fQ8vTfQf8evetno5x4vrS49IoS9XuiyPJixDHmQeIabZVXo1nSBtIZp6tw2ofYDkfdtlSPBYUnjoGhPB8T0Rw==
xstate@6.0.0-alpha.64
sha512-TJ3bMBeFq+Qhl+b0R747RdVLUx5D6P7j/JcSfqJMmPajAY+ZadGIQ+p3z8WEPdIsJ5xpzqy7P0Ou5fTDx/FOGw==
```

Installed adapter peers are Effect `^4.0.0` and XState `^6.0.0-alpha.63`.
The engine and adapter both resolve Effect to the same real path:
`node_modules/.bun/effect@4.0.5/node_modules/effect/dist/index.js`. The physical
package store contains only `effect@4.0.5`; the root lock has one Effect record.
There is one repository root lock. All baseline tool versions remain unchanged.

The installed package, not moving documentation or dist-tags, is API authority:
`dist/declarations/src/{setupEffect,fromEffect,createEffectActor,actorScope,actor}.d.ts`
and its shipped JavaScript. Adapter entry `dist/xstate-effect.js` SHA-256:
`78bbe37b717b81f1e763da94b4d32ac62dd2e93057d7d4e5113a658934c5dcc6`;
actor host chunk `dist/state-14a1fecf.js`:
`a857f2e4fb2ab9a1e587be26638629eb65a74721a960ebed634e024672c12b82`.
XState resolved entry `dist/xstate.cjs.js`:
`3f4668a57d72bc858a689ac66ac3311c2339af31e2f3a195ad34143c680a6b01`.
The owner's source locator is release commit
`c62db3e7520f3544faf5cf40988a2bf7208a670d`, `packages/xstate-effect/src`;
that locator is reported, not independently established as npm build provenance.

## RED And Inference Controls

Before adding dependencies, the focused test exited 1: `Cannot find module
'@xstate/effect'`, with 0 pass / 1 fail / 1 error. It was the required missing-package
RED, not an actor assertion failure.

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" bun --no-env-file --no-install test --timeout 30000 packages/engine/tests/xstate-compatibility.test.ts
```

The real declared task consumes a `Context.Service` inferred from a real factory.
Its machine moves pending to ready; `waitFor` observes `container-1`. Removing
only the retained `@ts-expect-error` produced TS2345:
`Effect<void, ActorStoppedError, TestContainers>` cannot run where requirements
must be `never`. A deliberately unused directive on the provided program produced
TS2578. Both controls exited 1 under strict engine typecheck; experimental edits
were restored, leaving only the meaningful missing-service directive.

## GREEN And Limits

Focused suite: six tests, 16 assertions, zero failures. It qualifies the declared
inferred service/task, a 10ms TestClock timer (still pending at 9ms), invocation
release before ready versus selective `withActorScope` release at root closure,
state-exit interruption and local release while the root remains alive, original
typed task failure through `join`, and sanitized tagged mapping of an unknown
machine failure. Pending work has no timer that could imitate cancellation;
observation waits are bounded, its latch has a same-binding scope finalizer, and
actor scopes own and drain hosted fibers. Layers wrap the closed actor program,
not individual operations. Each executed test has one runtime boundary.

The complete sequential baseline command list was rerun successfully with the
new cohort. Domain: 119 / 407; engine: 61 / 217; probe: 36 / 104. Total:
216 tests / 728 assertions. Lint and format pass with zero warnings/errors;
strict domain/engine/probe typechecks and `git diff --check` pass. All 141 Effect
rules remain at error, and engine `skipLibCheck: false` is unchanged.

Initial scaffold lint failures were corrected using domain result records,
explicit exported composition boundaries, separate infrastructure wiring and
scope-owned bounded coordination. No rule, configuration, vendor declaration,
manual channel, cast, runtime fallback or dependency was weakened to pass.

This is exact-cohort local Bun admission only. Experimental API stability,
worker ownership protocol, durable recovery, external cleanup, live Docker and
production behavior remain unqualified. No lifecycle implementation, restoration,
supervision retries, qualification/probe source changes, ADR changes, merge or push.
