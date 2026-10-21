import { Data, Match, Option, Result } from 'effect';

class ReadinessFailure extends Data.TaggedError('ReadinessFailure')<{
  readonly reason: 'Eof' | 'TooLarge' | 'Timeout';
  readonly bytes: number;
}> {}

// Test protocol only: stdout chunks are not messages. Bound bytes and wall time.
export async function readBoundedLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDeadline: () => void,
  timeoutMs = 5000,
) {
  const bytes = new Uint8Array(4096);
  let used = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onDeadline();
      reject(new ReadinessFailure({ reason: 'Timeout', bytes: used }));
    }, timeoutMs);
  });
  async function accumulate() {
    let line = Option.none<string>();
    while (Option.isNone(line)) {
      const next = await reader.read();
      const available = Match.value(next).pipe(
        Match.when({ done: false }, (value) => Result.succeed(value.value)),
        Match.orElse(() => Result.fail(new ReadinessFailure({ reason: 'Eof', bytes: used }))),
      );
      const chunk = Result.getOrThrow(available);
      const bounded = Match.value(used + chunk.byteLength <= bytes.byteLength).pipe(
        Match.when(true, () => Result.succeed(undefined)),
        Match.orElse(() =>
          Result.fail(new ReadinessFailure({ reason: 'TooLarge', bytes: used + chunk.byteLength })),
        ),
      );
      Result.getOrThrow(bounded);
      const newline = chunk.indexOf(10);
      const count = Match.value(newline).pipe(
        Match.when(
          (value) => value < 0,
          () => chunk.byteLength,
        ),
        Match.orElse((value) => value),
      );
      bytes.set(chunk.subarray(0, count), used);
      used += count;
      function completedLine() {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
        return Option.some(text);
      }
      line = Match.value(newline >= 0).pipe(
        Match.when(true, completedLine),
        Match.orElse(() => Option.none()),
      );
    }
    return Option.getOrThrow(line);
  }
  return Promise.race([accumulate(), deadline]).finally(() => clearTimeout(timer));
}
