# Local GitHub Ingress Qualification

## Task 1: Authentication And Bun Platform Compatibility

This is local dependency qualification, not permission to start ingress or use
live credentials. The application workspace is deferred to Task 6. No production
adapter module, listener, GitHub request, controller fallback, or credential
discovery is introduced by this task.

The private `@leviathan/github-adapter` workspace directly pins `jose: "6.2.12"`
and `effect: "4.0.5"`, with `@effect/platform-bun: "4.0.5"` as a development
dependency. Root `overrides["@effect/platform-node-shared"] = "4.0.5"` constrains
platform-bun's declared `^4.0.5` dependency. The app must declare platform-bun as
its own dependency when created; this test-only installation is not that app.

### Real Compatibility Checks

`packages/github-adapter/tests/compatibility.test.ts` imports the published
packages directly and runs under Bun, without a replacement crypto implementation
or filesystem mock. Four tests cover:

- Fresh synthetic RSA key generation, PKCS8 export/import, RS256 App-shaped JWT
  signing and verification with literal issuer/timestamps, and wrong-key refusal.
- Rejection of malformed PKCS8 headers and malformed encoded key data.
- Real exclusive file creation, typed `AlreadyExists` on a second open, unchanged
  contents, file/directory permission transitions, and successful scoped cleanup.
- Real test-owned file/directory cleanup after a typed synthetic scope failure.

The filesystem layer is the published Bun implementation. Its internal use of
platform-node-shared is not a Node controller fallback. Test-owned temporary
paths do not qualify production path validation, credential custody, SQLite
ownership, cancellation, HTTP behavior, or live GitHub authorization.

The workspace extends the existing strict tsconfig with `skipLibCheck: false`.
Its explicit uncached Moon tasks disable env-file loading, installation, and
retries. Universal lint configuration, existing cohort pins, and the two approved
declaration patches are unchanged.

### Artifact And Lock Identities

Public npm metadata, downloaded tarball SHA512, shipped exports/peers, lock
integrity, and every installed artifact file were compared for:

| Artifact                             | SHA512 Integrity                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `jose@6.2.12`                        | `sha512-9NiFmJEex0sy2Dk58j2UGBSHgUs2ypF9eZSu4L6vjOX3Dp96Sw1F3uL+H+D1sx02jZZdzUT0HgvCy59CuvXcWw==` |
| `@effect/platform-bun@4.0.5`         | `sha512-tB/GapZ/bVoCbwRgnojGP4TwopvkMoFoSCipXT1sf0guvG/2oRVhWzJW/1vkrYFEdLM7XyRnVVLrSJyqdok7DA==` |
| `@effect/platform-node-shared@4.0.5` | `sha512-a8rCdEkfZBGe9C6bsIjxVZuRp73svIyK5IHwHdDAVsvZXjrbkxusfI+rZ8WlX31RP1mKizwI/E72GQTNfdMWHw==` |

Both platform packages declare peer `effect: "^4.0.5"`; all existing and new
workspaces and both platform packages resolve to the same physical `effect@4.0.5`.
Jose declares no dependencies or peers. No new declaration patch is required.

All 262 baseline lock package entries remain structurally unchanged. Additions
are platform-bun, platform-node-shared, the adapter workspace link, and
`@types/ws@8.18.2`. Node-shared declares `ws: "^8.22.0"` and
`@types/ws: "^8.18.2"`; existing `ws@8.22.0` satisfies the former and is unchanged.
The new type package's `@types/node: "*"` resolves to existing `@types/node@26.6.5`.
There is no unrelated resolution upgrade.

- Baseline source: `4fdf876987668ea61bab1be30e5d04c48f0515e0`.
- Baseline lock SHA256: `a03b2f20874301814ba165f945b3fa55df5f20023f29ba5b873f3d16537cadc3`.
- Qualified lock SHA256: `74b793ca8c86d8dc38cad063675ce8be1f85cafc8241aae979f96a0b31e6f014`.
- Flue patch SHA256: `07d115c8c98bea3c28011afe76e838a89a5126b2f401bad1091af678c008931a`.
- Gaxios patch SHA256: `7ea7b1f29d158ab1595b71f798b71c9c44249ae29567b12dcf6d5d7e35239e3e`.

Exact commands, baseline/RED/GREEN/full-gate output, installed paths, actual test
counts, and the author's self-review are retained locally in
`.superpowers/sdd/2026-10-20-local-github-ingress/task-1-report.md` and its
`task-1-evidence/` directory. The controller owns independent review before any
dependent task. Local compatibility evidence does not approve a live rehearsal.
