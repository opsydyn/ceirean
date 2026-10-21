# Lossless Console Evidence Packaging

After final source gates passed, adding raw logs to the index caused
`git diff --cached --check` to exit 2. Moon emits blank lines at EOF, one existing
domain test intentionally prints a carriage-return input, and raw Git diff
context includes single-space context lines. This was an evidence-packaging
failure, not a source/test failure, and is retained here rather than concealed.

The raw logs were not edited or normalized. All 28 .log files, including the
superseded pre-host-fix attempt, were stored byte-for-byte in
raw-gate-logs.tar.gz. Each archive member was independently extracted to stdout
and compared with its local original using tar plus cmp: 28/28 matched.

Archive SHA256:
7d9b86923cfc50b4115830ac81dce45afcd30bdabb0bf212da9142910a50f734

Readable raw logs remain locally under this evidence directory, but only the
lossless archive is staged for them. The Markdown/JSON evidence is staged
normally. No Git whitespace configuration, lint configuration, test source or
application source was changed to achieve this packaging fix.

Inspect any committed raw log without changing files:

```sh
tar -xOzf raw-gate-logs.tar.gz 14-github-ingress-test.log
tar -xOzf raw-gate-logs.tar.gz pre-host-fix/10-engine-test.log
```

Final metadata diff checks are rerun after staging this packaging.
