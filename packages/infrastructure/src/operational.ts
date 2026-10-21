import { AlchemyContext } from 'alchemy/AlchemyContext';
import { rootDir } from 'alchemy/Auth/Paths';
import { Stage } from 'alchemy/Stage';
import { Config, ConfigProvider, Context, Effect, FileSystem, Option, Result } from 'effect';

import { cloudflareToken } from './config.ts';

export const AlchemyAuthHome = Context.Reference<string>('ceirean/AlchemyAuthHome', {
  defaultValue: rootDir,
});

const approved = {
  root: '/Users/alancurrie/Library/Application Support/Ceirean/infrastructure',
  stage: 'rehearsal',
  directoryType: 'Directory',
};
const directories = [
  approved.root,
  `${approved.root}/.alchemy`,
  `${approved.root}/.alchemy/state`,
  `${approved.root}/auth`,
];
const metadataUnavailable = new Config.ConfigError(
  new ConfigProvider.SourceError({
    message: 'Cannot verify protected operational directory metadata.',
  }),
);

function checkSafety(condition: boolean, message: string) {
  const error = new ConfigProvider.SourceError({ message });
  const validate = Result.liftPredicate(
    (value: boolean) => value,
    () => new Config.ConfigError(error),
  );
  return validate(condition);
}

function* qualifyOperationalContext() {
  const stage = yield* Stage;
  const context = yield* AlchemyContext;
  yield* Effect.fromResult(
    checkSafety(stage === approved.stage, 'Operational preparation requires rehearsal stage.'),
  );
  yield* Effect.fromResult(
    checkSafety(!context.dev && !context.adopt, 'Dev mode and adoption must be disabled.'),
  );
  yield* Effect.fromResult(
    checkSafety(
      context.dotAlchemy === `${approved.root}/.alchemy`,
      'Alchemy state must use the protected operational directory.',
    ),
  );
  const auth = yield* Config.String('ALCHEMY_HOME');
  const actualAuth = yield* AlchemyAuthHome;
  yield* Effect.fromResult(
    checkSafety(
      auth === `${approved.root}/auth` && actualAuth === auth,
      'Alchemy authentication must use the protected operational directory.',
    ),
  );

  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.realPath('.').pipe(Effect.mapError(() => metadataUnavailable));
  yield* Effect.fromResult(
    checkSafety(cwd === approved.root, 'Run preparation from the protected operational directory.'),
  );
  const rootInfo = yield* fs.stat(approved.root).pipe(Effect.mapError(() => metadataUnavailable));
  const owner = Option.getOrUndefined(rootInfo.uid);
  yield* Effect.fromResult(
    checkSafety(owner !== undefined, 'Operational directory ownership must be verifiable.'),
  );
  for (const directory of directories) {
    const canonical = yield* fs
      .realPath(directory)
      .pipe(Effect.mapError(() => metadataUnavailable));
    yield* Effect.fromResult(
      checkSafety(
        canonical === directory,
        'Operational directories must not resolve through redirected paths.',
      ),
    );
    const info = yield* fs.stat(directory).pipe(Effect.mapError(() => metadataUnavailable));
    yield* Effect.fromResult(
      checkSafety(
        info.type === approved.directoryType && (info.mode & 0o7777) === 0o700,
        'Operational directories must be owner-only directories (0700).',
      ),
    );
    yield* Effect.fromResult(
      checkSafety(
        Option.getOrUndefined(info.uid) === owner,
        'Operational directories must have consistent ownership.',
      ),
    );
  }
  yield* cloudflareToken;
}

export const operationalContext = Effect.gen(qualifyOperationalContext);
