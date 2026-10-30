# Current FoldKit Baseline Preparation

The owner adopted source `1183e3c067f873fdd29f14f06030515929c1b956` on
2026-10-30 with root checks, Storybook, the complete 3D CI job and all four custom
browser cases. This is separate from the historical `b7484cb` replay. Hosted
activation and image build/publication remain blocked; this slice prepares their
inputs, not a passing baseline.

The approved sandbox fix amends the active source to
`be0427e2aba2cf951ef4dbbbe9296e307ed41ad3`, a direct descendant changing only the
3D launch option and its regression test. The lockfile is unchanged; all 16 checks
and four cases remain required. The newer target checkout is not the baseline.
See [amendment/input evidence](../evidence/current-baseline/sandbox-inputs-20261030.md).

## Prepared Files

- `probes/cloudflare-executor/fixtures/current-baseline.json`: strict current
  source/lock/toolchain, ordered commands, servers, cases and finite budgets.
- `src/current-baseline.ts`: independent scope validator and fresh command plan.
- `src/current-inputs.ts`: fixed Git-tree/blob and lock verification, local source
  and harness-source archives, inventories and contract bytes. Failure/interruption
  owns partial-output cleanup, logging a sanitized tag if cleanup is unconfirmed;
  successful output is retained for the next staging step.
- `current-image/Dockerfile` and `.dockerignore`: narrowed Linux amd64 candidate.
- `fixtures/current-image.json` and `src/current-image.ts`: exact input metadata
  and recipe validation, always preparation-only while payloads are Pending.
- `src/current-dependencies.ts` and `scripts/prepare-current-registry.ts`: current
  fixed-source Linux registry candidates, with the old inventory policy preserved.
- `src/current-worker.ts` and `scripts/current-baseline-worker.ts`: fixed-plan
  worker and a deliberately disabled native entry; candidate bytes are retained
  locally, not promoted to an assembled image context.

The consumer uses Bun 1.4.3; Ceirean's controller stays on Bun 1.4.2 and Effect
4.0.5. Node 22.23.4, npm 10.9.9 and Git 2.43.0 are exact expected image readbacks,
not measured observations of this unbuilt image. Playwright 1.64.1 pairs with
Chromium 156.0.8078.4/revision 1248. Both full Chromium and headless shell executable
locations are asserted by the proposed recipe; native launch is still unqualified.

## Complete Check Plan

The contract has 16 ordered commands:

1. Frozen Bun install, root check, typecheck, tests and build (five commands).
2. Web Storybook build.
3. `pack:check` for effect-three core, FoldKit, Rapier and Troika.
4. `api:check` for those four packages.
5. The full effect-three FoldKit `test:e2e` suite.
6. The custom browser harness: desktop/mobile carousel and promo line (four cases).

The original CI browser-download step is an acquisition requirement for prepared
image inputs, not a baseline command allowed to reach the Internet. Browser
binaries must already exist. The web package's separate Playwright 1.62.1
agent-analysis/globe/radar E2E suite is not part of the accepted CI jobs; do not
mislabel the contract as covering every optional repository command.

After build, custom journeys use two owned Astro **preview** servers at 127.0.0.1
ports 4321/4322. This avoids Vite HMR WebSocket traffic conflicting with the
harness's existing deny policy. Port ownership and the Cloudflare adapter's
preview behavior must be measured on Linux; no preview server was started here.
Keep the existing harness activation guard intact until separately authorized.

## Image Identity And Custody

The recipe reuses the reviewed Node and Playwright base digests and replaces the
old Bun image with the Linux amd64 **manifest** for 1.4.3:

`docker.io/oven/bun@sha256:c017a211c49a21adc0e49dda7b60ac8112887c3d9465e01427f434ed107c830e`

Public Docker Hub metadata was read on 2026-10-30 from
[the 1.4.3 tag endpoint](https://hub.docker.com/v2/repositories/oven/bun/tags/1.4.3).
It selects `os: linux`, `architecture: amd64`, distinct from the multi-platform
index `sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598`.
No image was downloaded; metadata is not runtime or supply-chain attestation.

The unused Sandbox SDK helper stage is omitted. The proven native Alchemy
Container path already runs a plain Node image; this change does not upgrade the
SDK, introduce a new executor or assert that the new image has run.

Trusted staging must eventually supply exactly these context inputs:

- `input/source.tar`: accepted current source, not the operator checkout.
- `input/bun-cache.tar` and `input/npm-cache.tar`: current Linux dependency closure.
- `input/browser-harness.tar`: exact harness/dependencies, separate from consumer.
- `input/baseline-worker.mjs`: the trusted baseline executor, not repository code.
- `input/baseline-contract.json`: exact approved fixture bytes.
- `input/SHA256SUMS`: trusted, exact six-file membership and byte identities.

The recipe copies and checks these inputs but performs no dependency install,
repository script or extraction. It starts as non-root with a sleeping entrypoint
for the controller to own execution later. It is **not runnable as a complete
baseline yet**: the trusted worker, current payloads and extraction/custody remain
not yet assembled into a complete image context. Local source/harness-source
candidates now exist, but Linux dependency closure and the worker remain absent.
A checksum list alone does not establish safe source membership,
archive paths or complete input coverage; the trusted preparer must enforce those
before any approved build. No generic observer programme is needed to state this.

The next preparation produced [897 verified registry candidates](../evidence/current-baseline/registry-20261030.md)
and [a guarded worker bundle](../evidence/current-baseline/worker-20261030.md).
Neither changes the image manifest to Ready. Subsequent
[current npm lock/metadata replay](../evidence/current-baseline/npm-20261030.md)
freezes four separate consumer profiles, but does not merge the candidate caches
or materialize the Linux Bun layout. Worker native admission and the harness
activation guard still refuse execution. Candidate bytes are not runnable inputs.

## Sandbox Fix And Remaining Qualification

At the original `1183e3c` source, `packages/effect-three-foldkit/e2e/support/server.ts` calls
`chromium.launch` without `chromiumSandbox: true`. The pinned Playwright 1.64.1
implementation adds `--no-sandbox` unless that option is true. The accepted
contract requires sandboxed Chromium. The active `be0427e` amendment explicitly
sets that option; a launch-boundary regression test observed RED then GREEN without
starting Chromium. This resolves the static conflict, not native sandbox launch.

Do not remove that check, alter source while retaining its SHA, or disable the
sandbox policy. Native sandbox/runtime compatibility still needs measured evidence.
Other version/preview/kernel problems
may still be discovered when a real image runs.

## Verification And Next Delivery

```sh
moon run cloudflare-executor:baseline-preparation-test --concurrency 1
moon run :typecheck --concurrency 1
bun --no-env-file --no-install run check
```

Tests validate scope weakening, command substitution with seeded properties,
caller readiness claims, historical/current mixing and replacement recipe bytes.
They are not consumer execution or image qualification.
See [the local verification record](../evidence/current-baseline/preparation-20261030.md)
for the exact checks and retained limits.

Prepare the fixed source candidates without repository execution:

```sh
cd probes/cloudflare-executor
bun --no-env-file --no-install scripts/prepare-inputs.ts --current-source-repository /absolute/local/repository
```

Exit 2 means preparation succeeded but build/activation blockers remain. The
repository path locates Git objects; it does not select a branch/revision. There
is no revision override. Historical `--source-repository` behavior is unchanged.
The harness config remains under `browser/`, and its command cwd now matches
`/opt/ceirean/browser-harness/browser`. The global activation guard is unchanged.

Next: materialize the Linux dependency closure and trusted baseline worker, then
complete exact-byte image staging and request one build/Linux baseline scope with
input hashes, resource/spend limits and cleanup ownership. After measured success,
wire typed results/artifact export and persisted baseline deadlines into the
existing private job path. Do not repeat a hosted manifest-only milestone.

Current generated-consumer npm metadata is frozen in `fixtures/current-npm.json`
and checksum-validated by `src/current-npm-frozen.ts`. Replay tests construct fresh
metadata-only caches and reject empty/missing/tampered inputs. This is reviewed
version-cohort resolution on the local host, not Linux install qualification or
a claim about moving-latest npm resolution.

The explicit metadata-only preparer is:

```sh
cd probes/cloudflare-executor
bun --no-env-file --no-install scripts/prepare-current-npm.ts /absolute/source/repository /absolute/node
```

It reads fixed Git objects, obtains bounded public registry metadata, and runs
npm 10.9.9 package-lock-only with scripts disabled and native network tripwires.
Exit 2 is successful preparation, not readiness; 1 is sanitized refusal and 64
is invalid arguments. It has no build or activation mode. Replacing the committed
snapshot or its pin requires review, not automatic capture promotion.

Immediate remaining work: acquire/read back only the 12 additional archive
identities listed in the evidence, compose Linux offline caches, and qualify
native worker/control admission. Reuse already acquired candidate bytes.
