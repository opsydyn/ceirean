# Router: What We Took And What We Did Not

Recorded 2026-11-21. Slice 3 of
[the vendoring design](../../superpowers/specs/2026-11-21-factory-substrate-vendoring-design.md).

The slice was planned as "write our own rule table". It turned out we already
had one: `normaliseGitHubDelivery` in
[`packages/github-adapter/src/github-payload.ts`](../../../packages/github-adapter/src/github-payload.ts),
a pure `Result`-returning function over an Effect Schema decode. So the work
became a comparison, and the comparison found a defect.

## The Defect It Closed

Our bot check tested `sender.type` and `comment.user.type` against `'User'`.
That catches GitHub App accounts, which GitHub reports as `Bot`. It does not
catch a classic bot running on a plain user account, which GitHub reports as
`User` and which is otherwise indistinguishable from a human in a webhook
payload.

A bot of that kind posting a comment reading `/ceirean assess` would have
passed the actor gate and reached admission as an operator command. The
identity check that follows — `sender.id` must equal `comment.user.id` — does
not help, because a bot commenting on its own behalf satisfies it.

The fix is the vendored `isBotAuthor`, used as-is: the `[bot]` login suffix,
which GitHub reserves for app accounts, plus an explicit list of known
user-typed bot logins. Upstream wrote that function because they hit this case
with their own comment bot. Taking it is the first piece of the substrate to
pay for itself.

Two consequences, both deliberate:

- `sender.login` and `comment.user.login` are now required by the decode. A
  delivery without them is `Rejected / MalformedInput` rather than being
  treated as human. GitHub always sends them; absence means the payload is not
  what it claims to be.
- The known-login list is Astro's (`astrobot-houston`). It is correct — that
  account is a bot — but it is their policy input, not ours. When a repository
  needs its own list, that becomes per-repository policy read from
  maintainer-controlled content, not a constant in a vendored file.

## What We Deliberately Did Not Copy

| Factory decision                                                                                                                                                                                                                         | Why not                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dispatch across eight capabilities from `pull_request.labeled`, `issues.*`, `issues.assigned`, `pull_request.assigned`, `pull_request.review_requested`, `repository_advisory.reported` and `pull_request.opened\|reopened\|synchronize` | We route one command on one event, `issue_comment`. Every unsupported event is `Ignored / UnsupportedEvent`                                                                                                              |
| A label triggering work                                                                                                                                                                                                                  | A label is a weaker authorisation than an explicit instruction. Admission requires an exact `/ceirean assess` from an operator whose authority is checked against the ledger                                             |
| Persona assignment by assignee                                                                                                                                                                                                           | We have no personas. One command, one operator                                                                                                                                                                           |
| Routing dependency-bot pull requests to a safety review                                                                                                                                                                                  | We do not review other people's pull requests. Worth recording because dependency bots are precisely our subject matter: if we ever read a bot's PR deliberately, this gate has to be reconsidered rather than inherited |
| Per-repository trigger matching inside the router (`matchesReviewTrigger`, `matchesAdversaryTrigger`)                                                                                                                                    | Our router matches a fixed literal. Per-repository policy is the authority's decision, taken after admission, so the router stays a pure function of the payload                                                         |
| The triage FSM's label-state routing                                                                                                                                                                                                     | We have no label state machine. Our ledger is the record of what state a run is in, not labels on an issue                                                                                                               |

One decision from that FSM is worth keeping in mind even though it is not yet
expressible: it gates every mutating action on the issue's _live_ state rather
than on what the delivery says just happened, because a delivery can arrive
after the issue has moved on. When we gain actions that mutate a target
repository, that check has to exist somewhere.

## What We Have That Factory Does Not

- Byte-size limits applied before anything else, so an oversized field is
  `FieldTooLarge` rather than a decode failure deeper in.
- `sender.id` must equal `comment.user.id`, refused as `MalformedInput`.
- Refusals split into `Rejected` and `Ignored`, which are different facts: one
  is a decision about a command, the other is a delivery that was never a
  command.
- A `Result` return type, so a refusal is a value rather than an exception.

## Evidence

`probes/github-admission/tests/github-payload.test.ts`, 25 tests:

- Six cases covering `factory[bot]`, `dependabot[bot]` and `astrobot-houston`
  as both sender and comment author.
- Three human logins that must still reach admission, including
  `someone[bot]ish` and `astrobot-houston-fan`, which the suffix and list tests
  must not match.
- Two cases proving a missing login is malformed rather than human.
- Two property laws under the house harness (`checkLaw`, seeds 0/1/163,
  1000 runs each): any login ending in the app suffix is refused as a bot
  actor, and no body other than the exact command reaches admission.

The laws were verified non-vacuous by falsifying one and confirming the harness
reports a shrunk counterexample and a replay seed.
