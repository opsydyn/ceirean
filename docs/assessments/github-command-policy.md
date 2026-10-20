# Pure GitHub Command Policy

Task 2 of the [offline admission plan](../superpowers/plans/2026-10-20-github-admission.md)
is the bounded owner-approved slice after
[compatibility repair `629ada7`](github-admission-repair.md).

## Boundary

The domain owns schema-derived command/receipt/authority/decision data, exact
command parsing, stable tuple identities and a pure authorization decision using
explicit trusted time. It imports no GitHub SDK, database or platform runtime.

An `AdmittedPreview` is a pure decision value, not a recorded request, signature
capability or permission to execute. `VerifiedCommand` names the intended input
shape; its schema alone cannot prove a signature was checked. The later ingress
and transactional inbox must enforce those separate boundaries.

No admission service, HTTP listener, live permission lookup, SQLite inbox,
replay store, model, worker or publication is added by this task. The six-task
plan is not complete. Tasks 3-6 require separate approval.

## Evidence

The implementer observed a missing-module RED before either implementation
module existed. Fifteen focused tests then passed: nine literal boundary tests
(134 assertions) and six nonvacuous Effect Arbitrary laws. Existing
`tests/properties.ts` remains unchanged: each law must finish exactly 1000 runs
at seeds 0, 1 and 163, size 50, maxShrinks 1000 and maxDiscards 10000.

The new laws completed **18000 primary cases** in each focused/full execution:
coherent admission/revision binding, single authority-binding mutation refusal,
invalid interval/time refusal, rename invariance, tuple-key injectivity and
generated extra-text rejection. Each includes a constructive admitted control;
inputs are generated without filtering away failures. Repeated runs, shrinks,
mutations checked within a case and literal assertions are not extra primary
cases. Existing laws and their failure/replay diagnostic helper are unchanged.

The controller's fresh sequential workspace gates passed:

| Gate                                                             | Result                                      |
| ---------------------------------------------------------------- | ------------------------------------------- |
| Root lint/format                                                 | 0 warnings/errors; formatting clean         |
| Domain, engine, existing probe, GitHub probe uncached typechecks | All pass                                    |
| Domain tests                                                     | 201 pass / 768 assertions                   |
| Engine tests                                                     | 236 pass / 1162 assertions                  |
| Existing Flue probe tests                                        | 36 pass / 104 assertions                    |
| GitHub channel compatibility tests                               | 8 pass / 24 assertions                      |
| Total                                                            | **481 pass / 2058 assertions**, no failures |
| Frozen installation and whitespace check                         | Pass                                        |

Independent task review is pending; these are controller-observed local gates,
not whole-plan completion or live/CI qualification. Full commands remain in the
implementation plan; each Moon command used `--force --no-actions` in the
specified minimal environment, without overlapping suites or automatic retries.

The frozen install initially hit a sandbox temporary-directory permission
failure; rerunning the same script-free frozen command with scoped access
succeeded without changing dependencies. Lock SHA-256 remains
`9659b60ff39f9d38bfc54e5aea5bccc7ba47a0ba37e2ca01598cf3b75e76d5c4`.

## Contract Details

`commandKey` and `transportKey` preserve the planned schema-derived return
types. Like other Schema `.make` constructors, they reject invalid construction
input by raising a validation error; callers must decode untrusted data first.
The policy entry point `decideAssessment(input: unknown)` decodes before calling
them and returns finite refusal data for malformed input, invalid clocks and
invalid/unavailable authority. It does not throw a key constructor error for
ordinary malformed JSON-like inputs.

Identifiers and metadata are bounded in UTF-8 bytes and reject C0, DEL and C1
controls. Authority operator IDs must be unique and bounded. Receipt/candidate
scope equality is part of `VerifiedCommand` validation. Positive safe GitHub IDs
and canonical Schema JSON tuple codecs avoid numeric coercion and delimiter-key
collisions. Names are metadata; transfer/reinstallation changes immutable
authority bindings. Expiry is exclusive, and no ambient clock is consulted.

Field-size refusals at the HTTP boundary, persistence consistency, authority
revision races, clock floors and replay immutability are not proven by these
pure schemas. They remain responsibilities of later approved tasks.
