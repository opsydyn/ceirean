import { Effect, Exit, Match, Option, Schema, Scope } from 'effect';

import { productionListener } from '../../scripts/linux-replay-platform.ts';
import type { AdmittedArtifacts } from './archives.ts';

const blockedBody = new TextEncoder().encode('BlockedMissingBunMetadata');
const RequestRecord = Schema.Struct({
  method: Schema.String,
  path: Schema.String,
  outcome: Schema.Literals(['Verified', 'BlockedMissingBunMetadata']),
});
const encodeRecord = Schema.encodeSync(Schema.fromJsonString(RequestRecord));
const RequestSnapshot = Schema.Struct({
  blocked: Schema.Boolean,
  truncated: Schema.Boolean,
  requests: Schema.Array(RequestRecord),
});
const encodeSnapshot = Schema.encodeSync(Schema.fromJsonString(RequestSnapshot));
const isGet = Schema.is(Schema.Literal('GET'));
export function startReplayOn(artifacts: AdmittedArtifacts, listen: typeof productionListener) {
  function* start() {
    const requests: (typeof RequestRecord.Type)[] = [];
    let blocked = false;
    let truncated = false;
    let logBytes = 0;
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    function respond(request: { method: string; path: string }) {
      const valid =
        isGet(request.method) &&
        request.path.length <= 2048 &&
        !blocked &&
        /^\/(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+\/-\/[A-Za-z0-9_.+-]+\.tgz$/.test(request.path);
      const bytes = Match.value(valid).pipe(
        Match.when(true, () => artifacts.read(request.path)),
        Match.orElse(() => undefined),
      );
      const outcome = Option.fromUndefinedOr(bytes).pipe(
        Option.match({
          onNone: () => 'BlockedMissingBunMetadata' as const,
          onSome: () => 'Verified' as const,
        }),
      );
      const path = Array.from(request.path.slice(0, 2048), (character) =>
        Match.value(character.codePointAt(0)!).pipe(
          Match.when(
            (code) => code >= 32 && code <= 126,
            () => character,
          ),
          Match.orElse(() => '?'),
        ),
      ).join('');
      const record = RequestRecord.make({ method: request.method.slice(0, 16), path, outcome });
      const nextBlocked = blocked || bytes === undefined;
      const wrapper = RequestSnapshot.make({ blocked: nextBlocked, truncated, requests: [] });
      const wrapperBytes = new TextEncoder().encode(encodeSnapshot(wrapper)).length;
      const size =
        new TextEncoder().encode(encodeRecord(record)).length + Number(requests.length > 0);
      const countFits = requests.length < 1024;
      // Include wrapper/flags and each comma before retaining the record. Later
      // flag transitions only shorten the wrapper (false -> true).
      const sizeFits = size <= 262144 - wrapperBytes - logBytes;
      const pathFits = request.path.length <= 2048;
      const fits = countFits && sizeFits && pathFits;
      function recordAccepted() {
        requests.push(record);
        logBytes += size;
        return true;
      }
      const accepted = Match.value(fits).pipe(
        Match.when(true, recordAccepted),
        Match.orElse(() => false),
      );
      truncated = truncated || !accepted;
      blocked = blocked || !accepted;
      blocked = blocked || bytes === undefined;
      return Match.value(!blocked && bytes !== undefined).pipe(
        Match.when(true, () => ({ status: 200, body: bytes! })),
        Match.orElse(() => ({ status: 409, body: blockedBody })),
      );
    }
    const acquiring = Scope.provide(listen(respond), scope);
    const starting = acquiring.pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
    const bound = yield* starting;
    function readRequestSnapshot() {
      return RequestSnapshot.make({
        blocked,
        truncated,
        requests: requests.map((request) => RequestRecord.make(request)),
      });
    }
    return {
      ...bound,
      stop: () => Scope.close(scope, Exit.void),
      snapshotRequests: () => Effect.sync(readRequestSnapshot),
    };
  }
  const workflow = Effect.gen(start);
  return workflow;
}
export function startReplay(artifacts: AdmittedArtifacts) {
  return startReplayOn(artifacts, productionListener);
}
