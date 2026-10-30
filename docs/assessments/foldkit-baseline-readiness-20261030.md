# FoldKit Baseline Delivery Readiness

Date: 2026-10-30. Read-only source assessment, begun immediately after the roadmap
reset. No consumer commands, installs, image builds, provider calls or hosted
activation were performed. The findings below come from fixed Git objects and
current Ceirean source, not from executing a baseline.

## Decision

**Pursue the real baseline/browser vertical slice. Park hosted manifest-only
reporting.** Keep the existing controller, hosted admission and reusable executor
preparation. The next implementation deliverable is one fixed, executable baseline
contract, followed by its runnable Linux image, not another generic probe.

Recommended planning source: `1183e3c067f873fdd29f14f06030515929c1b956` in
`opsydyn/fold-kit-experiments`. This was selected and inventoried for reporting;
adopting it for repository execution is an explicit contract amendment. Do not
rewrite historical fixtures or claim their evidence applies to this revision.

## Two Sources, Not One Qualified Baseline

| Item                        | Historical executor preparation            | Current planning candidate                 |
| --------------------------- | ------------------------------------------ | ------------------------------------------ |
| Source                      | `b7484cb46e66b162c8afddcfba235c9507b4f0ab` | `1183e3c067f873fdd29f14f06030515929c1b956` |
| Consumer Bun                | `1.3.11`                                   | `1.4.3` declared package manager           |
| FoldKit                     | Historical 0.165-to-0.166 replay           | `0.170.0` catalog declaration              |
| Effect                      | Historical profile `4.0.0`                 | `4.1.0` catalog declaration                |
| Astro                       | Historical source/tool inventory           | `7.4.0` catalog declaration                |
| Frozen dependency inventory | Bound to historical source                 | No materialized Linux closure demonstrated |
| Final executor image        | Unbuilt fixture                            | No qualified final image                   |

Ceirean itself stays on its pinned Bun 1.4.2 / Effect 4.0.5 / Alchemy beta.83
cohort. Consumer and controller versions need not match. Updating the consumer
baseline is not approval to upgrade the controller or Alchemy.

The current consumer `bun.lock` raw-byte SHA-256 is
`9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89`.
It was read directly from the fixed commit, not the working tree. Node is declared
`>=22.22.0`, and CI selects major 22; retaining `22.23.4` would be a compatible
exact planning choice, not a historical patch pin or measured image observation.

## Executable Check Inventory

The fixed root CI `check` job runs:

1. `bun install --frozen-lockfile`
2. `bun run check`
3. `bun typecheck`
4. `bun run test`
5. `bun run build`

Retain web Storybook: `bun run build-storybook` in `apps/web`. Source package
exports require built distributions; web typecheck/build scripts already build
Astro, Viz and the effect-three packages. Do not replace package imports with
source-relative imports or assume manifests alone define the install closure.

Current root tests include workspace tests and the release-changelog script test.
Preserve their actual discovery and assertion outcomes. Generated/packed-consumer
tests can require nested package resolution beyond the root lockfile; enumerate
those from the accepted revision before preparing offline inputs.

The separate CI `effect-three` job also performs `pack:check` and `api:check` for
four published packages, installs Chromium headless shell, and runs
`@opsydyn/effect-three-foldkit test:e2e`. These are not implied by a green root
`check` job. The new acceptance contract must include them or explicitly state
their exclusion and its limits; full repository CI parity cannot be claimed if
they are omitted. Recommend preserving them for current-source qualification.

## Browser Work Already Exists

`probes/cloudflare-executor/browser/journeys.hosted.test.ts` implements carousel
buttons/desktop drag/mobile touch and promo line editing/settings assertions.
The Playwright config selects desktop 1440x900 and mobile 390x844, yielding four
cases, with sandbox enabled, trace capture and screenshot assertions. Reuse this
code where compatible; do not build a replacement journey framework.

Execution is intentionally blocked by `browser/activation-block.ts`. There is no
browser result from this source inspection. Runtime observations currently label
activation `Blocked`; changing those labels is not qualification.

The candidate still has `/carousel`, `/examples/line`, the named carousel region
and carousel data attributes in `apps/web/src/ui/carousel/index.ts`, and promo
line point/source controls. This is static selector support, not a DOM pass.

Browser versions must remain distinct:

- Prepared standalone harness: `@playwright/test` / Playwright `1.64.1`.
- Consumer web E2E package: `@playwright/test` `1.62.1`.
- Consumer 3D E2E package: Playwright `1.64.1`.

Do not rewrite consumer dependencies to make one cached browser appear compatible.
Freeze each required runner/binary pair. The 3D browser helper does not explicitly
set the standalone harness's `chromiumSandbox: true` option; actual launch policy
and hosted compatibility need evidence before that CI surface is called qualified.

For the four custom journeys, use owned local origins at ports 4321 and 4322.
Do not borrow the web repository's separate E2E config, which owns port 4371 and
an agent-analysis path. Web's Astro dev command avoids the Cloudflare adapter;
promo has a static build. Start exact reviewed server commands explicitly, require
their ports free, and stop them with their worker. No Astro deployment is needed.

## Concrete Gaps On The Critical Path

| Gap                                                   | Observed source                                                                                                           | Smallest delivery action                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Baseline/profile mismatch                             | `fixtures/baseline.json`, `src/pins.ts`, frozen dependency inventory and old recipe bind historical source/Bun            | Add a separate current-source contract; preserve historical files                                                        |
| Runnable image/input closure absent                   | Old `image/Dockerfile` checks Bun 1.3.11; its four payload archives are marked Pending                                    | Bind accepted source/toolchain/dependency/browser payloads, then obtain one build scope and final digest                 |
| Native baseline/browser compatibility unknown         | Harness global setup blocks execution; no measured image result                                                           | Run actual accepted checks/journeys on controlled Linux, then on the exact hosted image                                  |
| Smoke lifetime cannot carry a baseline                | `readonly/runner.ts`: 60-second execution; `store.ts`: recovery alarm at 75 seconds; `container.ts`: 60-second inactivity | Add typed baseline operation with distinct persisted admission/execution/cleanup deadlines and coordinated watchdogs     |
| Result/export contract only carries a runtime version | `readonly/job.ts` success is `runtime`; private operator replies are bounded to 16384 units                               | Add a baseline receipt and bounded private artifact export, without overloading smoke history or logging whole artifacts |
| Cancellation/cleanup needs baseline-runtime proof     | Smoke executes a short finished command; Git tests prove fake scope cleanup, not native exit                              | Exercise live process/browser/server cancellation and overflow, then stopped-resource readback on the selected image     |

Each action must advance repository execution or evidence delivery. Do not add a
new Queue, orchestrator, observer channel or storage product merely to reproduce
proof already held; justify any new resource by one of these concrete gaps.

## Next Bounded Implementation

1. Accept the current-source contract amendment: source/lock identity, unchanged
   root checks, Storybook, explicit 3D CI scope, four journeys and exact runtimes.
2. Prepare only that executable input/recipe/harness composition. Reuse existing
   parsers, inventories, image preparation and browser code where valid. Keep
   build/hosted invocation disabled until their exact scopes are approved.
3. Build/run the actual baseline with finite budgets, capturing failures honestly.
   A real package/browser/policy failure determines the next fix; it does not
   authorize skips, broader networking or another open-ended research programme.
4. Wire the measured executor and evidence bundle to the existing private durable
   job path. Preserve smoke sessions and require fresh hosted readiness/approval.

No positive end-to-end claim until the operator receives actual baseline/browser
evidence and cleanup proof. Flue repair, model spending and PR publication follow
that milestone. The remaining decisions are source/acceptance and finite execution
scope, not whether to create a hosted manifest transport.
