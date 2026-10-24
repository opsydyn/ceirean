# Cloudflare Executor Preparation Probe

Private, offline preparation only. No Worker, container, remote SDK adapter or
deployment entrypoint exists in this workspace yet. Operational ingress, Flue,
the application ledger and the Draft Colima replay profile are unchanged.

## Commands

From the repository root:

```sh
moon run cloudflare-executor:test
moon run cloudflare-executor:typecheck
bun --no-env-file probes/cloudflare-executor/scripts/prepare.ts --check
```

`--check` reads the committed manifest and recipe only. Exit **2** means a valid
`PreparationOnly` report with activation blocked; exit **1** means invalid or
unreadable inputs; exit **64** rejects unsupported arguments. There is deliberately
no success/activation exit code. Do not interpret `prepare-check` as a green
deployment readiness task. No build, download, extraction, source checkout or
consumer script is executed. Run Bun with `--no-env-file`; the command does not
request or read cloud credentials through Effect Config or otherwise.

## Pinned Inputs, Not A Built Image

`fixtures/baseline.json` fixes the consumer at
`b7484cb46e66b162c8afddcfba235c9507b4f0ab`. Bun 1.3.11 and the consumer's lockfile
are historical inputs. Node 22.23.4, Git 2.43.0 and Playwright 1.64.1/Chromium
156.0.8078.4 revision 1248 are new qualification choices, not recovered CI facts.
The image recipe requires the exact Git version and binary locations; no image
has been run to verify those assumptions. A mismatch must fail the build.

The recipe pins Linux amd64 base, Node, Bun and Sandbox helper images by digest.
The Node stage replaces the base image's Node toolchain; the base contributes
preinstalled browser/system dependencies. Nothing runs apt, npm install, remote
shell installers or consumer build scripts during this proposed image build.
The SDK helper is pinned to 1.0.3, but the SDK package itself is not installed.
New workspace dependencies are only the existing Effect/platform-bun 4.0.5 cohort.

`image/Dockerfile` is **unbuilt**. Digest-pinned inputs and a recipe hash are not
the final executor digest. Chromium must later be launched with its sandbox
enabled and verified on the actual hosting platform; `USER pwuser` is not proof
of restricted capabilities in Cloudflare's root-equivalent sandbox model.

## Offline Payloads Still Required

The ignored `payload/` directory must eventually contain four approved,
digest-inventoried archives and their trusted checksum list:

| Payload               | Required content                                                            |
| --------------------- | --------------------------------------------------------------------------- |
| `source.tar`          | Exact tracked source at the baseline SHA, validated before extraction       |
| `bun-cache.tar`       | Root frozen-install artifacts plus packed-consumer `bun x tsc` requirements |
| `npm-cache.tar`       | Metadata/tarballs for nested line/histogram/scatter generated npm installs  |
| `browser-harness.tar` | Pinned Playwright package/dependencies and reviewed browser harness         |
| `SHA256SUMS`          | Exactly those four archive names and hashes, bound to build approval        |

All four archives remain `Pending`; no cache is populated by `--check`. The
Dockerfile copies only these files and checks their recorded hashes. This is not
proof of archive safety or complete offline coverage: the future trusted builder
must validate the checksum-list entries against the approved inventory, and the
runtime extraction adapter must validate actual archive headers/content before
using them. Never trust a consumer-supplied checksum list.

The preserved source contract includes root check/typecheck/test/build, web
Storybook, Astro packed smoke tests and generated promo consumer installs. Those
generated projects have transitive npm requirements not frozen by the root Bun
lock. Inter fonts 5.3.0 must come from the baseline dependency inventory. Uncached
requests block preparation; they do not permit general network access or skips.
The historical install argv is preserved; actual offline execution is a network
enforcement requirement, not an assumption about a newer Bun flag.

The fixed journey inventory covers carousel buttons/desktop and mobile drag,
and promo line point-edit/settings consistency at 1440x900 and 390x844. It is not
an implemented browser journey or a screenshot result yet; those belong to Task 4B.

## Validation Boundaries

`src/preparation.ts` validates an input manifest against the reviewed pins and
hashes the recipe. `src/pins.ts` owns expectations independently of the runtime
JSON input, which is read only inside the CLI's bounded, sanitized workflow.
It rejects readiness assertions instead of allowing a boolean
to activate anything. Source inventory checks reject unsafe paths, all symlinks,
special files, duplicate/file-parent collisions and known sensitive names/key
markers. These are checks over supplied inventory data, **not** a tar parser,
filesystem scanner, credential-discovery guarantee or transfer authorization.
An actual export still requires a complete inventory, digest binding and review
of tracked secrets; do not hide required tracked files and call it the same base.

Registry validation admits only exact inventoried HTTPS GET URLs at
registry.npmjs.org, without credentials, queries or fragments. A redirect is a
new request and must be independently checked against the reviewed URL inventory.
The validator performs no fetch and does not enforce runtime egress by itself.

Proposed builder: an ephemeral GitHub-hosted `ubuntu-24.04` Linux amd64 job in
Ceirean, with a reviewed Ceirean-owned context and a 15-minute job timeout. Keep
registry publication in a separate trusted step and exclude consumer execution.
Exact runner entitlement, enforceable limits, permissions and costs belong to
the separate build-approval worksheet; this is a proposal, not a configured job.
Do not restart Colima, create a builder, push a workflow,
publish an image or spend money under preparation authority. Package credentials
must stay in a trusted retrieval service, never consumer commands or the payload.

## Offline Admission And Evidence Contracts

`src/contract.ts` fixes the six probe operation names and source revision. It
rejects arbitrary argv, caller-selected sandbox IDs, extra fields and requests
above the 10 MiB command / 512 MiB exported-evidence ceilings. The wider outcome
vocabulary exists for future hosted reporting, but the current offline manifest
cannot claim `Feasible`, verified integrity or enabled activation.

`makeAdmissionGate` owns one **process-local** atomic reservation using Effect
Ref. Exact duplicate IDs replay only the existing reference, including after
expiry; replay is not permission to start or restart work. Conflicting ID reuse
is refused. A different operation cannot take the occupied slot. New reservations
must fit the execution deadline and the full 15-minute cleanup reserve; recorded
clock regression cannot reopen a refused expired session. The owning controller
supplies time, never a request field. This is not distributed admission or a
replacement for the authoritative ledger. There is deliberately no release/reset
API before Task 3 can couple it to confirmed lifecycle cleanup.

`makeEvidenceCollector` binds a snapshot of the request, lower-or-equal budgets
and nonempty required artifact names. It meters chunks without storing their
payloads. Per-command output bytes and reserved artifact sizes share the total
export budget, so concurrent opens cannot oversubscribe it. It also bounds file
and command metadata counts to 64 each. Duplicate/unsafe/special entries,
over-budget chunks, missing required artifacts and incomplete files fail closed;
a rejected collector cannot be reset by retrying a smaller chunk.

The caller must check each returned Result **before** forwarding bytes to a
storage sink, and apply backpressure rather than queueing unbounded pending
Effects. These contracts do not implement a stream reader, writer, file export,
hash verifier or archive extractor. A claimed SHA-256 is syntax-checked metadata,
not verified content integrity. Finalization seals the collector and emits only
`Blocked`, `Unverified`, `CleanupUnconfirmed`, activation `Blocked`, with the
constructor-bound identity. No caller-supplied final identity or cleanup claim
is accepted by the collector.

## Activation Gates

Private authenticated operator invocation and the final executor image digest
remain independent blockers, alongside pending payloads, offline acceptance,
Chromium sandbox viability, provider limits and the session approval worksheet.
Image-build approval binds reviewed recipe/input hashes and the trusted builder;
it does not authorize hosted deployment or execution.

See [the implementation plan](../../docs/superpowers/plans/2026-10-24-hosted-executor.md)
and [preflight](../../docs/assessments/hosted-executor-preflight.md).

## Primary Metadata

Reviewed 2026-10-24; metadata pins are not executed runtime evidence:

- [Node release index](https://nodejs.org/dist/index.json)
- [Node image](https://hub.docker.com/v2/repositories/library/node/tags/22.23.4-bookworm-slim)
- [Bun image](https://hub.docker.com/v2/repositories/oven/bun/tags/1.3.11)
- [Playwright package](https://registry.npmjs.org/playwright/1.64.1)
- [Playwright image manifest](https://mcr.microsoft.com/v2/playwright/manifests/v1.64.1-noble)
- [Browser versions](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/browsers.json)
- [Sandbox helper](https://hub.docker.com/v2/repositories/cloudflare/sandbox/tags/1.0.3)
