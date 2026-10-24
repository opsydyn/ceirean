import { Data, Effect, Match, Ref, Result, Schema } from 'effect';

import {
  decodeHeader,
  decodeManifest,
  EvidenceLimits,
  Identity,
  limits,
  strict,
  type ArtifactHeader,
  type ProbeManifest,
} from './contract.ts';

type Reason =
  | 'InvalidLimits'
  | 'InvalidEntry'
  | 'DuplicateArtifact'
  | 'BudgetExceeded'
  | 'InvalidChunk'
  | 'UnknownArtifact'
  | 'IncompleteArtifact'
  | 'MissingArtifact'
  | 'CollectorClosed';
export class EvidenceFailure extends Data.TaggedError('EvidenceFailure')<{
  readonly reason: Reason;
}> {}
type Artifact =
  | { readonly _tag: 'Open'; readonly header: ArtifactHeader; readonly receivedBytes: number }
  | { readonly _tag: 'Complete'; readonly header: ArtifactHeader };
type Output = { readonly commandId: string; readonly byteLength: number };
interface Book {
  readonly config: EvidenceLimits;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly outputs: ReadonlyArray<Output>;
}
type State =
  | { readonly _tag: 'Collecting'; readonly book: Book }
  | { readonly _tag: 'Sealed'; readonly book: Book }
  | { readonly _tag: 'Rejected'; readonly book: Book; readonly failure: EvidenceFailure };
type Action =
  | { readonly _tag: 'OpenArtifact'; readonly input: unknown }
  | { readonly _tag: 'ArtifactChunk'; readonly name: string; readonly chunk: Uint8Array }
  | { readonly _tag: 'CommandChunk'; readonly commandId: string; readonly chunk: Uint8Array }
  | { readonly _tag: 'FinishArtifact'; readonly name: string }
  | { readonly _tag: 'Finalize' };
type Receipt = { readonly _tag: 'Accepted'; readonly reservedBytes: number };
type Outcome = Receipt | ProbeManifest;
type Change = readonly [Outcome, Book];
type Transition = readonly [Result.Result<Outcome, EvidenceFailure>, State];

function condition(valid: boolean, reason: Reason) {
  return Match.value(valid).pipe(
    Match.when(true, () => Result.succeed(true)),
    Match.orElse(() => Result.fail(new EvidenceFailure({ reason }))),
  );
}
function reservedBytes(book: Book) {
  const artifacts = book.artifacts.reduce((sum, artifact) => sum + artifact.header.byteLength, 0);
  const output = book.outputs.reduce((sum, entry) => sum + entry.byteLength, 0);
  return artifacts + output;
}
function accepted(book: Book): Change {
  return [{ _tag: 'Accepted', reservedBytes: reservedBytes(book) }, book];
}
const isChunk = Schema.is(Schema.instanceOf(Uint8Array));
const isIdentity = Schema.is(Identity);

function openArtifact(book: Book, input: unknown) {
  function* open() {
    const parsed = decodeHeader(input).pipe(
      Result.mapError(() => new EvidenceFailure({ reason: 'InvalidEntry' })),
    );
    const decoded = yield* parsed;
    const header = { ...decoded };
    yield* condition(
      !book.artifacts.some((artifact) => artifact.header.name === header.name),
      'DuplicateArtifact',
    );
    yield* condition(book.artifacts.length < limits.artifactCount, 'BudgetExceeded');
    yield* condition(
      header.byteLength <= book.config.artifactBytes - reservedBytes(book),
      'BudgetExceeded',
    );
    const artifact: Artifact = { _tag: 'Open', header, receivedBytes: 0 };
    return accepted({ ...book, artifacts: [...book.artifacts, artifact] });
  }
  const result = Result.gen(open);
  return result;
}

function findArtifact(book: Book, name: string) {
  const found = book.artifacts.find((artifact) => artifact.header.name === name);
  return Result.fromNullishOr(found, () => new EvidenceFailure({ reason: 'UnknownArtifact' }));
}

function replaceArtifact(book: Book, updated: Artifact) {
  function replace(current: Artifact) {
    return Match.value(current.header.name === updated.header.name).pipe(
      Match.when(true, () => updated),
      Match.orElse(() => current),
    );
  }
  return { ...book, artifacts: book.artifacts.map(replace) };
}

function artifactChunk(book: Book, name: string, chunk: Uint8Array) {
  function* append() {
    yield* condition(isChunk(chunk), 'InvalidChunk');
    const artifact = yield* findArtifact(book, name);
    function appendOpen(open: Extract<Artifact, { _tag: 'Open' }>) {
      const valid = condition(
        chunk.byteLength <= open.header.byteLength - open.receivedBytes,
        'BudgetExceeded',
      );
      const next: Artifact = { ...open, receivedBytes: open.receivedBytes + chunk.byteLength };
      return valid.pipe(Result.map(() => accepted(replaceArtifact(book, next))));
    }
    return yield* Match.value(artifact).pipe(
      Match.tag('Open', appendOpen),
      Match.tag('Complete', () => Result.fail(new EvidenceFailure({ reason: 'CollectorClosed' }))),
      Match.exhaustive,
    );
  }
  const result = Result.gen(append);
  return result;
}

function finishArtifact(book: Book, name: string) {
  function* finish() {
    const artifact = yield* findArtifact(book, name);
    function finishOpen(open: Extract<Artifact, { _tag: 'Open' }>) {
      const valid = condition(open.receivedBytes === open.header.byteLength, 'IncompleteArtifact');
      const next: Artifact = { _tag: 'Complete', header: open.header };
      return valid.pipe(Result.map(() => accepted(replaceArtifact(book, next))));
    }
    return yield* Match.value(artifact).pipe(
      Match.tag('Open', finishOpen),
      Match.tag('Complete', () => Result.fail(new EvidenceFailure({ reason: 'CollectorClosed' }))),
      Match.exhaustive,
    );
  }
  const result = Result.gen(finish);
  return result;
}

function commandChunk(book: Book, commandId: string, chunk: Uint8Array) {
  function* append() {
    yield* condition(isChunk(chunk) && isIdentity(commandId), 'InvalidChunk');
    const previous = book.outputs.find((output) => output.commandId === commandId);
    const previousBytes = previous?.byteLength ?? 0;
    const newCount = book.outputs.length + Number(previous === undefined);
    yield* condition(newCount <= limits.commandCount, 'BudgetExceeded');
    yield* condition(
      chunk.byteLength <= book.config.commandOutputBytes - previousBytes,
      'BudgetExceeded',
    );
    yield* condition(
      chunk.byteLength <= book.config.artifactBytes - reservedBytes(book),
      'BudgetExceeded',
    );
    const output = { commandId, byteLength: previousBytes + chunk.byteLength };
    const others = book.outputs.filter((current) => current.commandId !== commandId);
    return accepted({ ...book, outputs: [...others, output] });
  }
  const result = Result.gen(append);
  return result;
}

const isComplete = Schema.is(Schema.Struct({ _tag: Schema.Literal('Complete') }));
function finalize(book: Book) {
  function* complete() {
    const names = new Set(
      book.artifacts.filter(isComplete).map((artifact) => artifact.header.name),
    );
    yield* condition(
      book.config.requiredArtifacts.every((name) => names.has(name)),
      'MissingArtifact',
    );
    yield* condition(book.artifacts.every(isComplete), 'IncompleteArtifact');
    const request = book.config.request;
    const manifest = {
      sessionId: request.sessionId,
      operationId: request.operationId,
      sourceSha: request.sourceSha,
      activation: 'Blocked',
      outcome: 'Blocked',
      cleanup: 'CleanupUnconfirmed',
      integrity: 'Unverified',
      artifacts: book.artifacts.map((artifact) => artifact.header),
      commandOutput: book.outputs,
    };
    const decoded = decodeManifest(manifest).pipe(
      Result.mapError(() => new EvidenceFailure({ reason: 'InvalidEntry' })),
    );
    const report = yield* decoded;
    return [report, book] as const;
  }
  const result = Result.gen(complete);
  return result;
}

function collect(book: Book, action: Action) {
  return Match.value(action).pipe(
    Match.tag('OpenArtifact', ({ input }) => openArtifact(book, input)),
    Match.tag('ArtifactChunk', ({ name, chunk }) => artifactChunk(book, name, chunk)),
    Match.tag('CommandChunk', ({ commandId, chunk }) => commandChunk(book, commandId, chunk)),
    Match.tag('FinishArtifact', ({ name }) => finishArtifact(book, name)),
    Match.tag('Finalize', () => finalize(book)),
    Match.exhaustive,
  );
}

function transition(state: State, action: Action): Transition {
  function collecting(current: Extract<State, { _tag: 'Collecting' }>): Transition {
    function succeeded([value, book]: Change): Transition {
      const next = Match.value(action).pipe(
        Match.tag('Finalize', () => ({ _tag: 'Sealed' as const, book })),
        Match.orElse(() => ({ _tag: 'Collecting' as const, book })),
      );
      return [Result.succeed(value), next];
    }
    function failed(failure: EvidenceFailure): Transition {
      return [Result.fail(failure), { _tag: 'Rejected', book: current.book, failure }];
    }
    return Result.match(collect(current.book, action), { onSuccess: succeeded, onFailure: failed });
  }
  return Match.value(state).pipe(
    Match.tag('Collecting', collecting),
    Match.tag('Rejected', (current) => [Result.fail(current.failure), current] as const),
    Match.tag(
      'Sealed',
      (current) =>
        [Result.fail(new EvidenceFailure({ reason: 'CollectorClosed' })), current] as const,
    ),
    Match.exhaustive,
  );
}

function validLimits(config: EvidenceLimits) {
  return [
    new Set(config.requiredArtifacts).size === config.requiredArtifacts.length,
    config.commandOutputBytes <= config.request.budget.commandOutputBytes,
    config.artifactBytes <= config.request.budget.artifactBytes,
  ].every(Boolean);
}

/** Meters metadata only. It never stores chunks or verifies their claimed hashes. */
export function makeEvidenceCollector(input: unknown) {
  function* constructCollector() {
    const decoded = yield* Schema.decodeUnknownEffect(EvidenceLimits, strict)(input);
    const config = structuredClone(decoded);
    yield* Effect.fromResult(condition(validLimits(config), 'InvalidLimits'));
    const state = yield* Ref.make<State>({
      _tag: 'Collecting',
      book: { config, artifacts: [], outputs: [] },
    });
    function dispatch(action: Action) {
      const updating = Ref.modify(state, (current) => transition(current, action));
      return updating;
    }
    return {
      openArtifact: (entry: unknown) => dispatch({ _tag: 'OpenArtifact', input: entry }),
      appendArtifact: (name: string, chunk: Uint8Array) =>
        dispatch({ _tag: 'ArtifactChunk', name, chunk }),
      appendOutput: (commandId: string, chunk: Uint8Array) =>
        dispatch({ _tag: 'CommandChunk', commandId, chunk }),
      finishArtifact: (name: string) => dispatch({ _tag: 'FinishArtifact', name }),
      finalize: () => dispatch({ _tag: 'Finalize' }),
    };
  }
  const workflow = Effect.gen(constructCollector);
  return workflow;
}
