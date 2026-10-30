# Current Baseline Preparation Evidence

Date: 2026-10-30. Scope: local Ceirean contract/image preparation only. The owner
adopted FoldKit source `1183e3c067f873fdd29f14f06030515929c1b956` with all root
checks, Storybook, the complete 3D CI job and four custom browser cases.

Task 1 was committed as `347bce4`. Task 2 adds the candidate image, test
registration, npm pin and documentation. Historical preparation and pre-existing
dirty observer research remain separate.

## Exact Prepared Identities

- Consumer lock SHA-256:
  `9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89`.
- Current contract raw bytes SHA-256:
  `928f9451a7522fcae93db4c312358072ae5f929a99e2350929d8050ca5832e25`.
- Current Dockerfile raw bytes SHA-256:
  `a28e577719b00c3feb86c180c8273e91c259745cf881eadbff6818ccfc98792f`.
- Bun 1.4.3 Linux amd64 image manifest:
  `sha256:c017a211c49a21adc0e49dda7b60ac8112887c3d9465e01427f434ed107c830e`.

The image recipe is Unbuilt. Source/cache/harness/worker inputs are Pending.
Base-image metadata and static recipe assertions are not measured tool versions,
final image identity, safe archive custody or native launch evidence.

## Verification

All primary commands used the pinned Ceirean Bun 1.4.2, not the consumer Bun.

| Gate                                                                                                 | Observed result                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `moon run cloudflare-executor:baseline-preparation-test --concurrency 1`                             | 9 passed, 0 failed; 50 assertions; includes 600 seeded command-substitution property cases                        |
| Committed executor test files plus the new image test                                                | 604 passed, 0 failed across 47 files; 24,306 assertions                                                           |
| `moon run :typecheck --concurrency 1`                                                                | All 12 workspace tasks passed                                                                                     |
| `bun --no-env-file --no-install run check`                                                           | Strict oxlint and repository oxfmt check passed                                                                   |
| `CEIREAN_RUN_LINUX_FS_INTEGRATION=0 sh probes/cloudflare-executor/scripts/test-linux-fs-boundary.sh` | Fake filesystem and sealed-byte syscall tests passed; Linux integration explicitly not run                        |
| Independent read-only review                                                                         | No important findings; reviewer's focused tests passed on Bun 1.4.4, separate from primary pinned-runner evidence |

The full executor command selected tracked `tests/*.test.ts` from Task 1 HEAD
(`git ls-tree`) and added `tests/current-image.test.ts`; uncommitted observer tests
were excluded. A first sandboxed attempt failed 17 loopback-dependent tests because
local listeners were restricted. The unchanged suite then passed with loopback
permission, and a fresh final repeat produced the 604/0 result above. This is
local executor-unit evidence, not a Linux qualification or repository baseline.

RED/GREEN was observed before each implementation module and for the missing npm
contract pin. The final tests also hash the real contract fixture and recipe bytes,
so a stale copied digest cannot silently pass.

## Concrete Remaining Failure

Static inspection of the fixed consumer's 3D helper and exact Playwright 1.64.1
implementation confirms a conflict: omitted `chromiumSandbox: true` produces
`--no-sandbox`. The current contract still requires sandboxed Chromium and retains
the full 3D suite. Execution remains blocked pending a source amendment or reviewed
trusted launch enforcement; no source/policy change is implied by this evidence.

## Not Performed

No image pull/build/publication, target install or script, browser launch, Docker
run, hosted/provider call, model call, deployment, webhook/route activation, merge
or push occurred in this preparation. Only public Bun image tag metadata was read.
No live provider state was freshly verified. Retained teardown evidence is not a
new state observation.

Next delivery: resolve the concrete launch conflict and materialize the exact
current payloads/trusted worker. Obtain separate bounded build/Linux-run authority
before execution; then wire actual evidence into the existing private job path.
