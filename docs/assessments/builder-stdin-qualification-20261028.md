# Builder Stdin Qualification

Status: **blocked**. No builder, image build, Docker process or hosted service
was invoked in this assessment.

## Observation

On macOS arm64 with Bun 1.4.2, `effect` 4.0.5, `@effect/platform-bun` 4.0.5 and
`@effect/platform-node-shared` 4.0.5, a scoped `ChildProcess` ran
`/usr/bin/true` with piped stdin. An input stream produced one byte and then
delayed completion for 300 ms. The observed ordering was child exit code 0,
then input completion; `Stream.run(input, child.stdin)` returned `Success`.
`/usr/bin/true` does not read the input. This does not establish whether the
byte reached the operating-system pipe or which internal branch executed; it
does establish that sink success alone is not evidence of receiver consumption.

The installed NodeSink implementation also has an already-closed-writable path
that completes without observing a `finish` event. The Bun child spawner uses the
shared Node platform implementation. Neither a successful pipe write nor a
client-process exit establishes what a Docker daemon consumed.

## Gate

Do not use the current stdin result as an exact-byte builder receipt. Before a
real transport is admitted, it needs a narrowly scoped process boundary that
observes stdin finish, close and errors, an independently verified receiver-side
byte identity, one-attempt cancellation and cleanup handling, and explicit
builder identity and authorization. Even those observations must not be promoted
into daemon-consumption evidence without a qualified builder-side mechanism.
Artifact provenance, source custody, image build approval and hosted activation
remain separate unresolved gates.
