import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { Effect, Match, Schema } from 'effect';

import { runCli } from '../src/cli.ts';
import { openLocalGitHubApp } from '../src/composition.ts';
import { main } from '../src/main.ts';
import { api, argv, initialize, payload, webhook, withFixture, type Fixture } from './fixtures.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
async function qualify(run: (fixture: Fixture) => Promise<void>) {
  await Effect.runPromise(withFixture(run));
}
async function writePolicy(fixture: Fixture, changes: object) {
  await Effect.runPromise(
    fixture.fs.writeFileString(
      fixture.configFile,
      encode({
        ...fixture.config,
        policy: { ...fixture.config.policy, ...changes },
      }),
    ),
  );
}
for (const changes of [
  { revision: 'local-2' },
  { allowedOperatorIds: [67] },
  { appId: 78 },
  { installationId: 12 },
  { ownerId: 34 },
  { repositoryId: 23 },
  { policyRevision: 'policy-2' },
  { profile: { _tag: 'Disabled' } },
  { profile: { _tag: 'Enabled', profileId: 'other', profileRevision: 'profile-1' } },
  { profile: { _tag: 'Enabled', profileId: 'foldkit', profileRevision: 'profile-2' } },
]) {
  async function mismatch(fixture: Fixture) {
    await initialize(fixture);
    const github = api();
    const file = `${fixture.root}/github-admission.sqlite`;
    const before = await Effect.runPromise(fixture.fs.readFile(file));
    await writePolicy(fixture, changes);
    async function unexpectedlyOpened(app: Awaited<ReturnType<typeof openLocalGitHubApp>>) {
      await app.dispose();
      return true;
    }
    const opened = await openLocalGitHubApp(argv(fixture, 'start'), {
      host: fixture.host,
      fetch: github.fetch,
    }).then(unexpectedlyOpened, () => false);
    expect(opened).toBe(false);
    expect(github.calls).toEqual([]);
    expect(await Effect.runPromise(fixture.fs.readFile(file))).toEqual(before);
    const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
    expect(status.output).toMatchObject({ revision: 'local-1', decisions: 0, receipts: 0 });
    await writePolicy(fixture, {});
    const matching = await openLocalGitHubApp(argv(fixture, 'start'), {
      host: fixture.host,
      fetch: github.fetch,
    });
    await matching.dispose();
  }
  test(`I1 start refuses complete policy mismatch ${encode(changes)} and releases ownership`, () =>
    qualify(mismatch));
}

for (const reason of [
  'AuthorityChanged',
  'RevisionReused',
  'CapacityExceeded',
  'Installed',
] as const) {
  async function configureOutcome(fixture: Fixture) {
    await initialize(fixture);
    const db = new Database(`${fixture.root}/github-admission.sqlite`, {
      create: false,
      readwrite: true,
    });
    const snapshot = db
      .query<{ snapshot: string }, []>('SELECT snapshot FROM policy_revisions')
      .get();
    function fillCapacity() {
      for (let index = 1; index < 256; index++) {
        db.run('INSERT INTO policy_revisions VALUES (?,?)', [
          `history-${index}`,
          encode({ ...fixture.config.policy, revision: `history-${index}` }),
        ]);
      }
    }
    const filling = Match.value(reason).pipe(
      Match.when('CapacityExceeded', fillCapacity),
      Match.orElse(() => undefined),
    );
    void filling;
    expect(snapshot).toBeDefined();
    db.close();
    await Match.value(reason).pipe(
      Match.when('RevisionReused', () => undefined),
      Match.orElse(() => writePolicy(fixture, { revision: 'local-2' })),
    );
    const expected = Match.value(reason).pipe(
      Match.when('AuthorityChanged', () => 'wrong'),
      Match.orElse(() => 'local-1'),
    );
    const args = [...argv(fixture, 'configure'), '--expected-revision', expected];
    let output: unknown;
    async function invoke(input: ReadonlyArray<string>) {
      const result = await runCli(input, { host: fixture.host, silent: true });
      output = result.output;
      return result;
    }
    const code = await main(args, invoke);
    const expectedResult = Match.value(reason).pipe(
      Match.when('Installed', () => ({
        output: { _tag: 'Installed' },
        code: 0,
        json: '{"_tag":"Installed"}',
      })),
      Match.orElse((reason) => ({
        output: { _tag: 'Refused', reason },
        code: 1,
        json: `{"_tag":"Refused","reason":"${reason}"}`,
      })),
    );
    expect(output).toEqual(expectedResult.output);
    expect(code).toBe(expectedResult.code);
    expect(encode(output)).toBe(expectedResult.json);
  }
  test(`I2 main preserves structured configure ${reason} and exit outcome`, () =>
    qualify(configureOutcome));
}

async function statusHistory(fixture: Fixture) {
  await initialize(fixture);
  const github = api();
  async function fetch(url: string, init: RequestInit) {
    const response = await github.fetch(url, init);
    return Match.value(github.calls.length).pipe(
      Match.when(10, () => Response.json({ permission: 'read', user: { id: 66 } })),
      Match.orElse(() => response),
    );
  }
  const app = await openLocalGitHubApp(argv(fixture, 'start'), { host: fixture.host, fetch });
  async function exercise() {
    for (const [comment, operator] of [
      [55, 66],
      [56, 67],
      [57, 66],
    ]) {
      const response = await app.fetch(
        await webhook(payload(comment, operator), `delivery-${comment}`),
      );
      expect(Object.keys(await response.json()).sort()).toEqual(['correlationId', 'disposition']);
    }
    const file = `${fixture.root}/github-admission.sqlite`;
    const before = await Effect.runPromise(fixture.fs.readFile(file));
    const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
    expect(status.output).toMatchObject({
      decisions: 3,
      evidence: 2,
      policy: fixture.config.policy,
      policies: [fixture.config.policy],
      outcomes: [
        {
          operatorId: 66,
          localPolicyRevision: 'local-1',
          decision: { _tag: 'AdmittedPreview' },
          provenance: {
            _tag: 'LiveChecked',
            evidence: { basePermission: 'write', operatorId: 66 },
          },
        },
        {
          operatorId: 67,
          decision: { _tag: 'Rejected', reason: 'OperatorDenied' },
          provenance: { _tag: 'LocalPolicy', revision: 'local-1' },
        },
        {
          operatorId: 66,
          decision: { _tag: 'Rejected', reason: 'OperatorDenied' },
          provenance: { _tag: 'LiveChecked', evidence: { basePermission: 'read' } },
        },
      ],
    });
    expect(await Effect.runPromise(fixture.fs.readFile(file))).toEqual(before);
    const text = encode(status.output);
    for (const excluded of [
      'synthetic-token',
      'synthetic-webhook',
      'PRIVATE KEY',
      'rawBodyDigest',
      '/ceirean assess',
      'ownerLogin',
      'repositoryName',
      'startedMonotonicMs',
    ])
      expect(text).not.toContain(excluded);
    expect(github.calls).toHaveLength(10);
    const publicStatus = await app.fetch(new Request('http://127.0.0.1/status'));
    expect(publicStatus.status).toBe(404);
  }
  await exercise().finally(app.dispose);
  const db = new Database(`${fixture.root}/github-admission.sqlite`, {
    create: false,
    readwrite: true,
  });
  db.run("UPDATE evidence SET evidence=json_set(evidence,'$.basePermission','none') WHERE rowid=1");
  db.close();
  const corrupted = runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  await expect(corrupted).rejects.toBeDefined();
}
test('I3 local status projects admitted, local-refused and live-refused histories from active-owner snapshot', () =>
  qualify(statusHistory));
