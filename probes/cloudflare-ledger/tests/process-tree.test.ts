import { Effect, FileSystem, Match, Result, Schema } from 'effect';

export const processIdsCodec = Schema.fromJsonString(Schema.Array(Schema.Int));
export const encodeProcessIds = Schema.encodeUnknownSync(processIdsCodec);
export const decodeProcessIds = Schema.decodeUnknownSync(processIdsCodec);

export function ownedProcessIds() {
  const scan = Bun.spawnSync(['/bin/ps', '-axo', 'pid=,ppid='], {
    env: {},
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const output = new TextDecoder().decode(scan.stdout);
  const rows = output
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const owned = new Set([process.pid]);
  let previous = 0;
  while (previous !== owned.size) {
    previous = owned.size;
    for (const row of rows.filter((entry) => owned.has(entry[1] ?? -1))) owned.add(row[0] ?? -1);
  }
  owned.delete(process.pid);
  return { exitCode: scan.exitCode, pids: [...owned] };
}

export function processIsAlive(pid: number) {
  const observed = Result.try({ try: () => process.kill(pid, 0), catch: (error) => error });
  const absent = Schema.is(Schema.Struct({ code: Schema.Literal('ESRCH') }));
  return Result.match(observed, { onSuccess: () => true, onFailure: (error) => !absent(error) });
}

export function* recordOwnedProcesses() {
  const fs = yield* FileSystem.FileSystem;
  const scan = yield* Effect.try(() => ownedProcessIds());
  const checked = Match.value(scan.exitCode).pipe(
    Match.when(0, () => Effect.void),
    Match.orElse(() => Effect.die('Cannot inspect owned process tree')),
  );
  yield* checked;
  yield* fs.writeFileString('owned-processes.json', encodeProcessIds(scan.pids));
}
