# Current FoldKit Baseline Preparation

The owner adopted source `1183e3c067f873fdd29f14f06030515929c1b956` on
2026-10-30 with root checks, Storybook, the complete 3D CI job and all four custom
browser cases. This is separate from the historical `b7484cb` replay. Hosted
activation and image build/publication remain blocked; this slice prepares their
inputs, not a passing baseline.

## Prepared Files

- `probes/cloudflare-executor/fixtures/current-baseline.json`: strict current
  source/lock/toolchain, ordered commands, servers, cases and finite budgets.
- `src/current-baseline.ts`: independent scope validator and fresh command plan.
- `current-image/Dockerfile` and `.dockerignore`: narrowed Linux amd64 candidate.
- `fixtures/current-image.json` and `src/current-image.ts`: exact input metadata
  and recipe validation, always preparation-only while payloads are Pending.

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
unmaterialized. A checksum list alone does not establish safe source membership,
archive paths or complete input coverage; the trusted preparer must enforce those
before any approved build. No generic observer programme is needed to state this.

## Concrete Execution Conflict

At the fixed source, `packages/effect-three-foldkit/e2e/support/server.ts` calls
`chromium.launch` without `chromiumSandbox: true`. The pinned Playwright 1.64.1
implementation adds `--no-sandbox` unless that option is true. The accepted
contract requires sandboxed Chromium, so the 3D check is **not yet admissible**.

Do not remove that check, alter source while retaining its SHA, or disable the
sandbox policy. Resolve this explicitly through a source fix/new accepted SHA or
a reviewed trusted launch-enforcement approach, with actual native evidence. No
such change was made by image preparation. Other version/preview/kernel problems
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

Next: resolve the sandbox conflict and materialize only the accepted current
payloads/trusted worker, then request one exact build/Linux baseline scope with
input hashes, resource/spend limits and cleanup ownership. After measured success,
wire typed results/artifact export and persisted baseline deadlines into the
existing private job path. Do not repeat a hosted manifest-only milestone.
