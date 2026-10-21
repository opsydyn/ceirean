# Dependabot Security Repair

Baseline: `1e89ada`. GitHub reported five open Dependabot alerts, all on the
direct development peer `@modelcontextprotocol/sdk@1.25.2` in the admission probe.
Pin it to **1.32.0**, the lowest release outside all five reported ranges.
Keep the actual peer and strict vendor type checking; do not remove the package,
stub its declarations or dismiss the alerts.

| Alert                                                         | Advisory                                                                 | Severity | First patched |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- | ------------- |
| [1](https://github.com/opsydyn/ceirean/security/dependabot/1) | [GHSA-345p-7cg4-v4c7](https://github.com/advisories/GHSA-345p-7cg4-v4c7) | High     | 1.26.0        |
| [2](https://github.com/opsydyn/ceirean/security/dependabot/2) | [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) | High     | 1.31.0        |
| [3](https://github.com/opsydyn/ceirean/security/dependabot/3) | [GHSA-6prh-2h8m-c8cw](https://github.com/advisories/GHSA-6prh-2h8m-c8cw) | Moderate | 1.32.0        |
| [4](https://github.com/opsydyn/ceirean/security/dependabot/4) | [GHSA-22jm-h49p-29qw](https://github.com/advisories/GHSA-22jm-h49p-29qw) | High     | 1.32.0        |
| [5](https://github.com/opsydyn/ceirean/security/dependabot/5) | [GHSA-rvq5-wwqv-78pq](https://github.com/advisories/GHSA-rvq5-wwqv-78pq) | Moderate | 1.32.0        |

The existing [Dependabot PR 1](https://github.com/opsydyn/ceirean/pull/1)
proposes the same manifest bump but does not update `bun.lock`. This repair also
regenerates the Bun lockfile. Only related SDK dependency resolution changes:
`express-rate-limit` 7.5.1 to 8.7.1, new `ip-address` 10.7.4, and removal of the
SDK's nested Node adapter in favor of the existing compatible 2.1.5 adapter.
The Flue and Gaxios patches and all existing lint/type policies remain unchanged.

The SDK remains a compatibility type peer, not an exposed MCP v1 server.
Its stricter HTTP redirect behavior and new optional server controls are not
application changes here. This is not proof that an arbitrary SDK consumer's
configuration is secure. Flue's separately pinned MCP v2 client is not upgraded
by changing the v1 peer.

## Qualification

- Baseline and upgraded lint/format checks and all seven typechecks pass.
- A tracked-only clean snapshot installed with `--frozen-lockfile
  --ignore-scripts`; no `.env`, ignored PEM or protected operational state was
  copied. Its strict admission-probe typecheck also passes.
- The local dependency install disabled lifecycle scripts. Bun still reported
  loading the ignored root `.env` despite `--no-env-file`; no values were printed.
  The separate clean-install/audit environment had an empty inherited environment
  and temporary HOME, with no credentials available to those tools.
- No source/runtime change, webhook/listener/tunnel activation, alert dismissal
  or Dependabot configuration change was made.
- Full qualification passed: zero-warning lint/format, all seven typechecks,
  and all seven test tasks (962 tests, zero failures). Independent review found
  no material issues in the targeted dependency update.
- Qualified lockfile SHA-256:
  `a161beae8a2f15bdaa5892f48a34a3fcf02e11935f4094547bd5009f2624b301`.

GitHub alert resolution requires the repaired revision on the default branch
and a completed dependency refresh. The local patched-range check is not proof
that GitHub has closed the alerts.

## Additional Audit Findings

`bun audit --json` in the credential-free snapshot exits **1**. The
[raw registry response](../evidence/security-audit-20261021.json) contains no
`@modelcontextprotocol/sdk` findings, but reports **47 advisory entries across
five other package names**. These are not 47 GitHub Dependabot alerts and some
advisories share underlying issues. No global all-clear is claimed.

| Package                        | Advisory entries | Locked vulnerable dependency path                                                 |
| ------------------------------ | ---------------: | --------------------------------------------------------------------------------- |
| `@modelcontextprotocol/client` |                2 | Flue 2.3.0 pins client 2.0.0; fixes require at least 2.3.0 for both advisories    |
| `@hono/node-server`            |                3 | Alchemy to Prisma dev pins 1.19.9; the main 2.1.5 adapter is not the flagged copy |
| `hono`                         |               38 | Prisma dev pins 4.11.4; the main 4.13.13 copy is outside these reported ranges    |
| `lodash`                       |                3 | Prisma AST/Chevrotain subtree pins 4.17.21                                        |
| `valibot`                      |                1 | Prisma dev pins 1.2.0; the application's 1.5.0 copy is not the flagged copy       |

These findings predate the v1 peer update. Review upstream Flue and Alchemy
cohorts first. Any transitive override would need explicit compatibility proof,
especially MCP core/client pairing and the patched Flue declaration entrypoint.
Do not silently broaden this five-alert fix into a framework migration.

## Next Slice

Qualify compatible upstream Flue and Alchemy updates against the remaining
transitive advisories, retaining strict checks and bounded operational defaults.
Keep package warnings and remote alert state visible until independently verified.
