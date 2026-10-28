# Readiness Artifact Identity Check

Status: **candidate evidence only; production staging and image build remain blocked.**

## Worker Bundle

At Ceirean commit `ed8ec6b7b4e7620d3d3ecd60d0d6fd6498c6971b`, Bun `1.4.2`
produced a 239,569-byte candidate with SHA-256
`a03f6736450e29a642ab6261803b4d3eda08fba2ba666e814a5e86c4fa9055cb` using
`--target=bun --format=esm --reject-unresolved --minify-whitespace`. Three builds
matched, including one from a clean `git archive` export. All used the same
installed dependencies and Bun executable, so they are not independent toolchain
or dependency verification. The bundler reported 233 modules and the generated
metadata listed no external imports. The source export reused the original
checkout's installed dependency links.

The command, run from the checkout root with a temporary output path, was:

```sh
bun --no-env-file --no-install build --target=bun --format=esm \
  --reject-unresolved --minify-whitespace --outfile="$OUTPUT" --metafile="$METAFILE" \
  probes/cloudflare-executor/scripts/linux-readiness-worker.ts
```

For the clean-export trial, `git archive HEAD` was extracted into a new temporary
directory and its root and probe `node_modules` paths were symlinked to this
checkout's installed directories; that trial omitted the `--metafile` flag. The
output hashes were measured with
`shasum -a 256`; the metafile's `outputs.*.imports` arrays contained no entries.

The measured Bun executable SHA-256 was
`35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5` and the
lockfile SHA-256 was
`8ebf778327c5a2cb91cc119d5ce4269ed8acc9d9c9a7f66e8e413c147c791f96`.
No provenance review of either executable or installed dependency bytes has been
completed. A non-minified trial embedded local paths in module comments; it is
not a candidate for distribution. The selected trial did not contain the observed
local `/Users/alancurrie` or `/private/tmp` path strings; this is not a general
secret scan.

## Tracer

The [upstream strace 6.19 release](https://github.com/strace/strace/releases/tag/v6.19)
identifies source commit `1d78a4ce1bfa3754b3b99b1e4bb15790001b77cb`. Its
published source archive SHA-256 is
`e076c851eec0972486ec842164fdc54547f9d17abd3d1449de8b120f5d299143`; the downloaded
archive matched that value. Matching GitHub's metadata is not independent
signature verification and does not identify a compiled executable. No strace
binary was produced or admitted.

The asset was `strace-6.19.tar.xz`; the comparison used the release API's
`assets[].digest` field and `shasum -a 256` on the downloaded archive.

## Observer And Native Boundary

The recipe names `input/observer-canary`, but no corresponding implementation,
build recipe or executable was found in the repository. The readiness worker
currently reports the observer as `NotMeasured`.

The native filesystem adapter was cross-compiled twice as an amd64 Linux
relocatable object with Zig `0.16.0`; both had SHA-256
`8c113dd1a335ba693c185a9152dee6b6b44d3c2edd219d8f4952b369404b5d18`. The
measured Zig executable SHA-256 was
`747a9b519198afe71ad190a2387ce28cee879894d7ebc4e34c042b3ebf623c08`.
This object is not a runnable helper, has no independently verified toolchain
provenance, and does not establish filesystem or builder custody. The previous
[native Linux test](https://github.com/opsydyn/ceirean/actions/runs/40751781409)
covered only its recorded cases.

The object check compiled `probes/cloudflare-executor/src/internal/linux-fs-boundary-linux.c`
with `zig cc -target x86_64-linux-musl -O2 -std=c11 -Wall -Wextra -Werror -pedantic -c`,
using temporary Zig cache directories. `file` identified the result as an ELF
x86-64 relocatable object. This is not the linked helper or a Linux runtime test.

## Remaining Gates

- Review an independent worker build, complete installed dependency and toolchain
  closure, and the exact worker behavior on the intended Linux runtime.
- Authenticate the tracer source independently, then review and reproduce an
  amd64 executable and its runtime dependency closure.
- Implement and qualify the observer harness and protected channel before
  assigning an executable identity.
- Provide a reviewed executable helper, authenticated root and procfs, exclusive
  descriptor and write custody, bounded cleanup, and an independently qualified
  builder input transport.

No candidate hashes above are production pins or build approvals. No image was
built and no hosted runtime was activated during this check.
