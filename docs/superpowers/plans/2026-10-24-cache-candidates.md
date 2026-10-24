# Integrity-Checked Cache Candidates

Approved scope: local preparation only, based on `be5a960`. Keep hosted activation,
consumer installs/scripts, browser execution, image build, source transfer,
merge and push blocked. Alchemy upgrade remains paused.

1. Test and implement bounded registry retrieval: exact frozen GET allowlist,
   manual redirects, 64 MiB per blob, 512 MiB total, fixed deadlines, SHA-512 before
   persistence, SHA-256 evidence. Refuse partial, changed or oversized input.
2. Derive minimal npm packuments from the independently pinned npm locks. Preserve
   only resolution metadata and exact versions, including platform exclusions;
   no live registry metadata refresh or consumer code. Seed npm's pinned cacache
   implementation, not a custom cache format. Bound metadata to 2 MiB each/16 MiB
   total and candidate storage to 1100 MiB/20000 files. No archive extraction.
3. Prove npm 10.9.9 lock-only offline replay of all three inert profiles from no
   lockfile. Compare the complete registry/local inventory with frozen snapshots.
   Use isolated config/environment, scripts disabled, a native network tripwire,
   and empty-cache/missing-metadata negative controls. No installed node_modules.
4. Prepare the real local candidate, re-read and verify blobs/cache contents,
   document measured sizes/hashes and remaining gates. Run lint/format, all
   workspace types and full serial tests; obtain one independent review and commit.

Review focus: header and streamed size bypasses, cancellation/redirect cleanup,
unknown URLs, altered bytes/cache entries, stale or incomplete metadata replay,
default entrypoints accidentally fetching, caller-selected commands/paths,
candidate partial cleanup, and claims exceeding local macOS metadata evidence.

Ruling: minimal lock-derived packuments replace live metadata replay inputs.
They are deterministic qualification metadata, not verbatim registry responses;
future packed/Linux acceptance must verify the same resolution independently.

## Completion

- [x] Exact registry retrieval and generated overflow/digest/deadline tests.
- [x] Size-bounded candidate persistence and independent content re-read.
- [x] Three no-lockfile offline metadata replays and missing-cache controls.
- [x] Real local candidate, independent review and both cleanup-race regressions.
- [x] Lint/format, 12 typechecks, fresh 12-task serial suite (9m28s) and frozen install.

Hosted activation, Linux installs, extraction, browser execution, final image,
merge and push remain outside this completion.
