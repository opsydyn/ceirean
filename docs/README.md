# Documentation

Nine kinds of document live here, and they are not interchangeable. A design is
a proposal, an assessment is a measurement, and evidence is a record bound to a
revision. Putting one where another belongs is how a repository ends up unable to
say what it has actually proved.

Start at the [README](../README.md) for what Ceirean is, the
[architecture model](architecture/README.md) for its current shape, and the
[roadmap](roadmap.md) for what is being delivered next.

## The kinds

| Where                                      | Count                    | What it is                                                                                                            |
| ------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [`architecture/`](architecture/README.md)  | 1 model, 6 views         | The LikeC4 source and its rendered views. The source is authoritative; the images are derived                         |
| [`decisions/`](decisions/)                 | 2                        | Accepted ADRs, numbered. A consequential choice, its alternatives and its consequences                                |
| [`roadmap.md`](roadmap.md)                 | 1                        | The active delivery map. Checkboxes record evidence, not permission to execute                                        |
| [`superpowers/specs/`](superpowers/specs/) | 15                       | Approved designs. What a slice should do, agreed before it is built                                                   |
| [`superpowers/plans/`](superpowers/plans/) | 34                       | Approved implementation plans. An ordered task list with its acceptance checks                                        |
| [`assessments/`](assessments/)             | 36                       | What was measured when work finished — and, equally, what it does not qualify                                         |
| [`evidence/`](evidence/)                   | 36 records, 54 artifacts | Run records bound to an exact revision: markdown in 8 subject directories, with the logs, JSON and archives they cite |
| [`runbooks/`](runbooks/)                   | 10                       | Procedures for a person, including the approval worksheets                                                            |
| [`assets/`](assets/)                       | 1                        | Images used by the README                                                                                             |

## Naming

- **Dated**: `YYYY-MM-DD-slug.md` for specs and plans, `slug-YYYYMMDD.md` for
  assessments and evidence. The date is when the work was agreed or measured.
- **Numbered**: `NNNN-slug.md` for ADRs, allocated in order and never reused.
- **Undated**: only a document that is maintained in place —
  [`roadmap.md`](roadmap.md), this index, and each directory's own README.

## Superseding a record, rather than editing it

A dated assessment or evidence record qualifies the revision it names. Editing it
later makes it describe something that was never measured, which quietly destroys
the only thing it was for.

So a dated record is not edited in place once it is accepted. When it is overtaken
by later work, add a new dated record and let the old one stand. Where a whole
document is replaced, its predecessor moves to a `*-history-YYYYMMDD.md` file
beside it — as [`roadmap-history-20261027.md`](roadmap-history-20261027.md) and
[`readme-history-20261123.md`](readme-history-20261123.md) do — kept verbatim, and
the replacement links back to it.

Correcting a typo, a broken link or a path is not superseding. Changing a measured
number, a claim, or a limitation is.

## What a document should say about its limits

Every assessment in this directory names what it does **not** qualify, and that
is deliberate rather than defensive hedging. A local test run is not evidence of
process-kill recovery; a same-process reopen is not host-loss evidence; a passing
probe is not production qualification. An assessment that omits its exclusions
reads as a broader claim than the work supports, and someone will later rely on
it. State the exclusions.

## Historical records

These are kept for provenance and are not maintained. Where they and current
documents disagree, the current documents are right.

- [`roadmap-history-20261027.md`](roadmap-history-20261027.md) — the delivery map
  before 2026-10-27
- [`readme-history-20261123.md`](readme-history-20261123.md) — the README's status
  and planning prose before the 2026-11-23 restructure
- [`roadmaps/first-hosted-e2e-history-20261027.md`](roadmaps/first-hosted-e2e-history-20261027.md)
  — the first hosted end-to-end map
- Assessments and evidence under the Leviathan name qualify only their recorded
  revisions, not renamed source
