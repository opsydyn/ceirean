# Local GitHub Ingress

Private local admission CLI. It records bounded assessment admission decisions;
it does not execute assessments, workers, repositories, agents or GitHub writes.
Only `POST /webhook` is served, on `127.0.0.1:8787`. No command creates a tunnel.

The explicit JSON configuration has only `policy`, optional `stateRoot`,
`webhookSecretFile` and `privateKeyFile`. The default state root is
`$HOME/Library/Application Support/Leviathan`; its database is
`github-admission.sqlite`. `--database` selects an absolute contained descendant.
Unknown JSON keys and undocumented or duplicate arguments are refused.

CLI forms, through `bun --no-env-file --no-install src/main.ts`:

- `init --config PATH [--database PATH]`
- `start --config PATH [--database PATH]`
- `status --config PATH [--database PATH]`
- `configure --config PATH --expected-revision REV [--database PATH]`

Init/status/configure validate credential references without reading those files
or acquiring an authority client. Configure requires stopped ingress and a fresh
policy revision; it does not reset replay keys. Start never initializes storage.
Credential files must be explicit, single-link, owner-only 0600 regular files,
without symlink components. No credentials are read from the environment,
`.env`, a profile or an implicit key path.

## Host Declaration

Invoke only for an operator-selected local, non-synced filesystem. Authoring the
configuration and invoking under this requirement is the operator declaration;
there is no extra JSON or environment declaration channel. This applies to both
the conventional default and an explicit custom absolute stateRoot.

The native application boundary reads HOME/TMPDIR with Effect Config, obtains
the effective UID/current directory natively, and supplies conventional current
project build roots plus standard temporary and macOS sync-root exclusions.
Storage also rejects repository ancestors containing `.git`, unsafe owners or
modes, and symlink components. These checks do not discover arbitrary external
build directories or prove absence of third-party sync clients/network mounts.
The operator remains responsible for that declaration. Only injected test host
context can select test-owned temporary storage; production CLI JSON/environment
cannot select it.

## Lifetime

One exported composition boundary owns one ManagedRuntime with narrow Bun
FileSystem/Path/Stdio layers. Imports do not start a runtime or server.
Requests have eight-second outcomes, with four retained request owners and
60 starts per rolling minute. Unsettled cleanup retains ownership rather than
allowing unbounded replacement work. Authority uses its existing two-second
attempt/six-second total budgets, without retries or positive permission cache.

Shutdown stops accepts, aborts/drains owned requests, awaits actual native
authority cleanup, then closes storage. Main forces exit 1 after ten seconds
if cleanup remains stuck; FailedShutdown does not claim a clean close.

Only synthetic/injected HTTP and test-owned loopback have been exercised here.
Live credentials, GitHub API access, tunnels and live acceptance are separate
operator-authorized work. Tasks 1-7 are accepted by the controller; the whole
branch remains pending scoped final-fix review and controller verification,
not merge acceptance. Start requires complete active/file policy equality;
configure Refused prints typed JSON and exits 1. Local read-only status includes
bounded policies and decision/provenance/permission observations, never secrets
or raw bodies, and has no public route.
The [local-only runbook](../../docs/runbooks/local-github-ingress.md) covers
PKCS#8 preparation, permission checks, explicit commands, capacity stops,
failed shutdown, operator redelivery and replay-history loss after old restores.
See the [measured manifest](../../docs/evidence/local-github-ingress.json) for
tested source identity, raw logs, controls and historical evidence boundaries.
