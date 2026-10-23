import { FileSystem, Schema } from 'effect';

const Interpreter = Schema.String.check(Schema.isPattern(/^\/[!-~]+$/));

export function* writeFixtureLauncher(path: string, execPath: string) {
  const interpreter = Schema.decodeUnknownSync(Interpreter)(execPath);
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(`${import.meta.dir}/child.ts`);
  yield* fs.writeFileString(path, `#!${interpreter} --no-env-file\n${source}`);
  yield* fs.chmod(path, 0o700);
}
