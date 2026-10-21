# Unused Declaration Cleanup

Approved follow-up to the [visibility cleanup](internal-export-cleanup-20261021.md),
based on `d864b2a`. Consumer search confirmed the four remaining export findings
had no users. Removed only:

- `commandApplication` from engine test fixtures, plus its unused `Layer` and
  `CommandAdmission` imports. Active acquisition helpers are unchanged.
- The `QualificationFailure` type alias and its now-orphaned schema constant.
  Actual qualification validation and error results are unchanged.
- The unused `RestartResult` and `MeasuredEvidence` type aliases in the admission
  probe. Their consumed runtime schemas and validation remain intact.

No dependencies, manifests, lockfile, patches, lint rules, Fallow entrypoints,
or suppressions changed. The required `@modelcontextprotocol/sdk@1.25.2` peer is
retained under the [compatibility repair criteria](github-admission-repair.md).

## Measured Audit

| Finding                 | Before | After |
| ----------------------- | -----: | ----: |
| Unused value exports    |      1 |     0 |
| Unused type exports     |      3 |     0 |
| Unused dev dependencies |      1 |     1 |
| Total                   |      5 |     1 |
| Scanner exit            |      1 |     0 |

The sole remaining [raw finding](../evidence/fallow-20261021-declarations.json)
is the documented compatibility type peer, at warning severity. Exit 0 means no
default error-severity findings, not zero findings. No rules were downgraded.

The before scan reproduced all four export findings before deletion. The after
scan used the same secret-free snapshot and frozen script-disabled install,
overlaid with only the three tracked TypeScript edits. Both used Fallow 3.34.1,
`--no-cache --no-type-aware`, an empty inherited environment, isolated temporary
HOME, `FALLOW_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1` and macOS network denial.
No ignored environment files, PEMs or protected operational state were supplied.
No application, Alchemy, listener, tunnel or webhook activation occurred.

Static analysis limits remain unchanged: package entry exports are protected,
no semantic pass was requested, and architecture boundaries/rule packs are not
configured. This does not qualify a production deployment or prove every form
of dead code absent. Historical reports are retained unchanged.

- Source patch SHA-256 (`git diff d864b2a -- '*.ts'`):
  `42b5e6088eca5f1b73143b618fb03ec2aafaa6a20e14f902bdd8c7a1f1f131a4`.
- Original scanner JSON SHA-256:
  `ed5a6bc0b5d7b5079899526afcd749c2588ddfef37aadc96ae2d1ba4239e6a5e`.
- Committed JSON SHA-256 after whitespace-only Oxfmt normalization:
  `4082191df2cb2114858fe1cd3f4b81529805c2e02949e14ca3733383354b59b2`.

## Verification

- `bun --no-env-file run check`: passed with zero-warning Oxlint and Oxfmt.
- `moon run :typecheck --force --no-actions`: all seven tasks passed.
- `moon run :test --force --no-actions`: all seven tasks passed, 962 tests,
  zero failures, including existing property tests.
- Independent read-only review found no broken consumers or validation changes.
- Normalized evidence is JSON-equivalent to the original scanner output.
- `git diff --check` passed; dependency manifests, lockfile, patches, lint
  rules and Fallow configuration are unchanged from `d864b2a`.

## Next Boundary

Retain the MCP peer and both compatibility patches until their documented
upstream/removal criteria can be proven in a separate clean-install experiment.
Do not add an ignore entry solely to hide the remaining warning.
