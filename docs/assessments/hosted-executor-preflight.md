# Hosted Executor Preflight

Decision: **Blocked at Task 1**, 2026-10-24. Input/preparation sequencing and an
unresolved authenticated operator invocation path block continuation, not a
demonstrated incompatibility between Cloudflare and Effect.

Inspected Ceirean base `952fa12`, installed Alchemy `2.0.0-beta.83`, and FoldKit
source `b7484cb46e66b162c8afddcfba235c9507b4f0ab`. No installs, builds, cloud account
queries, deployment, listener, webhooks, credentials or consumer scripts were run.
Public npm/Docker Hub metadata was read without pulling package/image content.

## Positive Compatibility Evidence

Installed paths below are relative to
`packages/infrastructure/node_modules/alchemy/src/Cloudflare/` in the main checkout;
the isolated checkout has the same committed dependency pins.

- `index.ts` exports Containers. `Containers/Container.ts` documents both async
  SDK classes and Effect-native container bindings, including `schedulingPolicy:
  'durable_object'`. `Workers/DurableObjectState.ts` exposes the native container.
- `Containers/ContainerClient.ts` exposes `start`, `exec`, `inspect`, `destroy`,
  `monitor` and HTTP/HTTPS interception. Process acquisition is scoped; its own
  comment explicitly says scope closure kills the direct process, not descendants.
  This supports an Effect-owned adapter but does not establish tree cancellation.
- `Containers/ContainerProvider.ts` supports pre-pushed Cloudflare registry images
  without Docker pull/build/push, as well as Docker-backed custom image creation.
  `Docker/Docker.ts` supports explicit Docker context/buildx configuration. A
  managed executor does not eliminate the need for a trusted image builder.
- `Workers/Worker.ts` supports `workersDev: false`, disabling stable and version
  preview URLs, and service bindings. An authenticated operator invocation path
  still needs a concrete reviewed implementation; disabled URLs are not one.

No Alchemy upgrade is justified by these observations. Runtime compilation and
SDK integration have not been attempted under this read-only gate.

## Current SDK And Image Identity

Public npm metadata resolved `@cloudflare/sandbox` **1.0.3**, gitHead
`643233e5159d5d9d184f50196c8294f451745004`, with tarball integrity:

```text
sha512-QbpiKDVztiRSG3CETxsocYc16CviM0tV2DzPU9MIcAX09Ee+j7MDS5ec6gJfMCv+rDd1hOGvOJOQ4ztCTuZj2Q==
```

Docker Hub metadata for `cloudflare/sandbox:1.0.3` returned Linux amd64 digest:

```text
sha256:fc1740c3cba26461f0ab1771287c84018ab2cca43a70ebb823087c85d780aaec
```

This pins the **helper image**, not our final executor image. Current 1.x docs
describe `Files` and a matching `sandbox-shim`; lifecycle/process execution is
owned by native `ctx.container`, not the former `getSandbox`/`Sandbox` class.
Do not implement from the locally bundled preview skill's older API examples.
The npm package is not installed; metadata is not a successful typecheck.

## Provider Controls: Documented, Not Hosted-Proven

Current official docs support a `standard-3` instance: 2 vCPU, 8 GiB RAM, 16 GB
disk, within the proposed ceilings. Account eligibility and actual enforcement
readback remain unverified. Do not confuse decimal GB with GiB.

Native `exec` starts argv directly, offers piped streams and process signaling,
but no built-in execution timeout or descendant termination. Caller disconnect
does not automatically stop a process; RPC has no request signal. Use explicit
operation cancellation and ultimately container destruction, with readback;
inactivity timeout is not the session's absolute deadline.

With `enableInternet: false` and no intercepts, current native API docs say public
DNS lookups time out. This is more precise than the older 0.x reference used in
early assessment. Still test DNS, direct IP, raw TCP and HTTPS separately hosted;
do not turn the documented statement into a claimed negative-test result.

## Historical Baseline Inventory

The FoldKit commit is present locally. Static source inspection establishes:

- Root `package.json`: Bun **1.3.11**, Node `>=22.12.0`; CI selects Node **22**,
  not an exact patch. Git version is not pinned by that workflow.
- Lockfile: FoldKit **0.165.0**, Effect **4.0.0**, Vite plugin **0.26.0**,
  TypeScript **6.0.3**, Inter variable font package **5.3.0**. Do not replace
  these with Ceirean's toolchain or the current consumer checkout.
- Root check/typecheck/test/build and web `build-storybook` commands exist.
  Astro builds also build the local packages. Use the unchanged root scripts,
  not bare repository-wide `bun test`.
- `packages/astro-foldkit/test/integration/package-import-smoke.test.ts` invokes
  `npm pack`, tar, Node/Bun imports and `bun x tsc` in generated consumers.
  `astro-page-smoke.test.ts` builds and starts the actual web dev server.
- `apps/promo/test/standalone-chart-project.test.ts` generates line/histogram/
  scatter projects and runs `npm install`, typecheck and build. The generated
  template uses local vendored Viz plus exact FoldKit/plugin/Vite/TypeScript
  versions. Its transitive npm resolution is not frozen by the root Bun lock.
  Offline preparation must include these generated consumers and metadata.
- No installed Playwright or Chromium pin was found in the root lockfile;
  Vitest's optional browser peer mentions do not identify a browser binary.
  Exact browser, harness, Node patch, Git and image identities remain unqualified.

This is a prerequisite inventory, not an exhaustive cache manifest, historical CI
runtime reconstruction, executed baseline, test count or browser acceptance result.

## Why The Gate Stops Here

Task 1 requires a fully resolved immutable executor image and exact toolchain
identities before scaffolding. The trusted custom recipe and artifact preparation
are scheduled in Task 4; image build/upload is separately gated. The helper
digest above cannot stand in for a not-yet-built executor containing Bun 1.3.11,
Node 22, Chromium, fonts and offline dependency artifacts.

There is also no approved trusted builder for that image. Do not silently restart
Colima or substitute the Cloudflare managed Node 24 image for the historical
Node 22 contract. No account eligibility or authenticated invocation proof was
obtained, and no final image manifest was invented to pass the gate.

Tasks 2-6 remain unstarted under the plan's explicit stop rule.

## Recommended Unblock

Approve a narrow sequencing amendment: choose exact compatible Node 22/Git and
controller-owned Playwright/Chromium pins, then author and locally validate the
trusted image recipe and offline harness **before requiring the final image
digest**. Label these fresh qualification pins, not recovered historical facts.
Keep the final digest mandatory before any hosted execution.

This amendment would permit preparation only, not a `Proceed` result for Task 1.
Before that gate can pass, concretely document the operator-to-Worker transport,
authentication and authorization boundary, required resources and support in the
pinned provider/runtime APIs. Disabling URLs and declaring service bindings alone
do not satisfy that requirement. Account eligibility remains a separate live
preflight check; no permission expansion is implied.

Prefer a trusted Linux amd64 CI image builder over reviving the throwaway local
VM setup. Build only reviewed Ceirean-owned image inputs; do not execute consumer
scripts with cloud credentials. Image publication needs its own bounded approval,
and the later hosted session still needs the filled cost/time/permission worksheet.
This recommendation does not authorize a workflow push, image upload or spending.

## Verification And Review

Independent documentation review identified the need to retain private invocation
as a distinct blocker in the amendment. That clarification is included above.
The reviewer did not verify SDK compilation, public metadata authenticity,
complete cache coverage or hosted behavior. This is not a security qualification.

## Sources

- [SDK reference](https://developers.cloudflare.com/sandbox/reference/)
- [Native container API](https://developers.cloudflare.com/containers/api/durable-object-container/)
- [Instance sizes](https://developers.cloudflare.com/containers/platform/limits/)
- [Image management](https://developers.cloudflare.com/containers/guides/image-management/)
- [Exact npm metadata](https://registry.npmjs.org/@cloudflare%2fsandbox/1.0.3)
- [Helper image metadata](https://hub.docker.com/v2/repositories/cloudflare/sandbox/tags/1.0.3)

Sources inspected 2026-10-24. Local installed provider source and Git objects are
primary evidence for pinned dependencies and the historical consumer baseline.
