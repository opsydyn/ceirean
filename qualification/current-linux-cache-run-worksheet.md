# Current Cache CI Run Worksheet

Status: unpublished, not runnable, no run approved. This is not the historical
observer/tracer qualification worksheet. Cloudflare remains the execution target.

## Immutable Inputs

| Input                                          | Approved identity                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| FoldKit public repository                      | `https://github.com/opsydyn/fold-kit-experiments.git`                   |
| Qualification branch                           | `codex/foldkit-sandboxed-baseline` (local only; publication unapproved) |
| Source SHA                                     | `be0427e2aba2cf951ef4dbbbe9296e307ed41ad3`                              |
| Source tree                                    | `0e3ea1ab2999dbd83cb3a38920cab47b2a02352e`                              |
| Source inventory SHA-256                       | `3b2862214f45be2d0d4211acce1c7c81b0c717ac3b9487f139535239cc6a16df`      |
| Lock SHA-256                                   | `9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89`      |
| 909-artifact inventory SHA-256                 | `940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed`      |
| Frozen npm snapshot SHA-256                    | `afbc49f88b06f39f1b64d321952cb0768e843b7fa57446c78d260f19993d496f`      |
| Ceirean implementation SHA                     | **Unresolved; never use a branch tip**                                  |
| Controller Bun 1.4.2 Linux x64 archive SHA-256 | **Unresolved; publication blocker**                                     |

The archive URL is fixed to the official Bun 1.4.2 release. Its checksum could not
be independently read on 31 October (the metadata endpoint returned an expired
asset redirect); no binary was downloaded. Do not invent a checksum, fall back to
ambient Bun, or treat the local macOS binary's identity as Linux evidence.

## Publication Review: Not Approved

- [ ] Obtain and independently verify the official controller archive checksum.
- [ ] Review the prepared native adapter's Linux transport assumptions, fixed
      staging helper, capacity and cleanup readbacks. No Docker call has run here.
- [ ] Complete the reviewed operational application entry around
      `runCurrentCiCache` and fixed outcome persistence. The current CLI deliberately
      supports only inspection and exits 2; it cannot run a rehearsal.
- [ ] Put controller bootstrap inside the same eight-minute acquisition deadline;
      preserve the 16-minute worker bound and two-minute cleanup reserve within
      the 30-minute job. The draft inspection bootstrap is not a live run entry.
- [ ] Enforce all required evidence files, four-MiB aggregate diagnostics, final
      cleanup and seed readback before upload; retain the final seed identity and
      controller outcome in `control.json`. A partial file set cannot pass.
- [ ] Freeze the final reviewed Ceirean implementation SHA and template byte hash.
- [ ] Separately approve publishing only the exact FoldKit qualification revision,
      not merging it into FoldKit main.
- [ ] Separately approve publishing the reviewed Ceirean workflow/implementation.
- [ ] Verify both published objects and source tree without dispatching anything.

## One Attempt: Not Approved

Owner approval: **absent**. Start/deadline/run URL/artifact IDs: **unset**.
One manual run only; no retry, fallback or automatic dispatch. No image build,
source scripts, browsers, Flue/model calls, credentials in the consumer or hosted
activation. An unavailable object, unknown cleanup or missing artifact is a refusal.

Record actual runner image/version, amd64/kernel, Docker, controller binary digest,
both pulled image identities, worker bundle/guard digests, free capacity, phase
times, all result hashes, exit status and removal readbacks. The `ubuntu-24.04`
label is not immutable runner provenance. Read back artifact service identities
after upload; an upload action failure prevents acceptance.

## Acceptance

- [ ] Fixed source/runtime controls and all 909 archives admitted by the real worker.
- [ ] Equal nonempty warm-up/fresh Bun installed-identity summaries.
- [ ] Four nonempty offline npm profile results; scripts remain disabled.
- [ ] Stopped zero-exit consumer before export; no external consumer network.
- [ ] Actual portable seed re-admitted in a fresh owned filesystem, descriptor
      binding checked, compressed archive independently read back, at most 1 GiB.
- [ ] Fixed diagnostics total at most 4 MiB; all owned resources confirmed removed.
- [ ] Both evidence and seed uploads succeed, with seven-day retention and recorded hashes.
- [ ] Label the result **cache-only**, not baseline/browser or hosted readiness.

After acceptance, request the bounded Cloudflare image/baseline preparation slice.
It remains a separate approval; a cache artifact never authorizes deployment.
