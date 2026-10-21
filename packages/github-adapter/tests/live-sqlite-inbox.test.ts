import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import {
  Digest,
  LiveAdmissionDraft,
  LiveAdmissionRecord,
  commandKey,
  transportKey,
} from '@ceirean/domain';
import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Data, Effect, FileSystem, Layer, Match, Option, Result, Schema } from 'effect';

import manifest from '../package.json';
import {
  initializeLiveInbox,
  openLiveInbox,
  readLiveInboxStatus,
} from '../src/live-sqlite-inbox.ts';
import {
  encodeEvidence,
  encodePolicy,
  encodeRecord,
  encodeVerified,
} from '../src/live-sqlite-storage.ts';
import {
  draftFixture,
  ownedConfig,
  policyFixture,
  verifiedFixture,
} from './live-sqlite-fixtures.ts';
import { readBoundedLine } from './readiness.ts';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
afterEach(() => mock.restore());

test('storage is an explicit package boundary', () => {
  expect(Reflect.get(manifest.exports, './storage')).toBe('./src/live-sqlite-inbox.ts');
});

async function nativeOwnershipQualification() {
  function* scenario() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-owner-' });
    yield* fs.chmod(root, 0o700);
    const file = `${root}/owner.sqlite`;
    yield* fs.open(file, { flag: 'wx', mode: 0o600, noFollow: true });
    const db = new Database(file, { create: false, strict: true });
    db.run('PRAGMA journal_mode=DELETE');
    db.run('BEGIN EXCLUSIVE');
    db.run('CREATE TABLE identity (value TEXT NOT NULL) STRICT');
    db.run("INSERT INTO identity VALUES ('synthetic')");
    // This is the separate ownership database, not a ledger transaction.
    expect((yield* fs.stat(`${file}-journal`)).mode & 0o777).toBe(0o600);
    db.run('COMMIT');
    db.close();
    const script = `import { Database } from 'bun:sqlite';
      const db = new Database(Bun.argv[1], {create:false, strict:true});
      db.run('PRAGMA busy_timeout=0'); db.run('BEGIN EXCLUSIVE');
      console.log('OWNED'); await Bun.stdin.text();`;
    const child = Bun.spawn(
      [process.execPath, '--no-env-file', '--no-install', '-e', script, file],
      {
        env: { PATH: process.env.PATH ?? '' },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const reader = child.stdout.getReader();
    const ready = yield* Effect.promise(() => readBoundedLine(reader, () => child.kill('SIGKILL')));
    expect(ready).toBe('OWNED');
    const competitor = new Database(file, { create: false, strict: true });
    competitor.run('PRAGMA busy_timeout=0');
    const blocked = Result.try(() => competitor.run('BEGIN EXCLUSIVE'));
    expect(blocked._tag).toBe('Failure');
    child.kill('SIGKILL');
    yield* Effect.promise(() => child.exited);
    competitor.run('BEGIN EXCLUSIVE');
    expect(competitor.query('SELECT value FROM identity').get()).toEqual({ value: 'synthetic' });
    competitor.run('ROLLBACK');
    competitor.close();
    expect((yield* fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(Option.isSome((yield* fs.stat(file)).ino)).toBe(true);
    reader.releaseLock();
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}

test(
  'real Bun rollback EXCLUSIVE blocks a separate process and releases on child death',
  nativeOwnershipQualification,
);

async function strictLifecycle() {
  function* scenario() {
    const { config, fs } = yield* ownedConfig();
    const absent = yield* openLiveInbox(config).pipe(Effect.result);
    expect(absent).toMatchObject({ _tag: 'Failure', failure: { operation: 'open' } });
    expect(yield* fs.exists(config.file)).toBe(false);
    yield* initializeLiveInbox(config);
    const bytes = yield* fs.readFile(config.file);
    expect((yield* initializeLiveInbox(config).pipe(Effect.result))._tag).toBe('Failure');
    expect(yield* fs.readFile(config.file)).toEqual(bytes);
    const { driver } = yield* openLiveInbox(config);
    expect(driver.resolveReplay(verifiedFixture()).pipe(Result.getOrThrow)).toEqual({
      _tag: 'Absent',
    });
    const reply = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(reply._tag).toBe('Recorded');
    expect(driver.resolveReplay(verifiedFixture()).pipe(Result.getOrThrow)._tag).toBe('Duplicate');
    const status = yield* readLiveInboxStatus(config);
    expect(status).toMatchObject({
      decisions: 1,
      receipts: 1,
      authorityRevisions: 1,
      revision: 'local-1',
    });
    expect(yield* openLiveInbox(config).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'OwnershipBusy' },
    });
    for (const suffix of ['', '-wal', '-shm', '.owner.sqlite']) {
      expect((yield* fs.stat(`${config.file}${suffix}`)).mode & 0o777).toBe(0o600);
    }
    const native = new Database(config.file, { readonly: true, create: false });
    expect(native.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(native.query('SELECT count(*) AS n FROM evidence').get()).toEqual({ n: 1 });
    native.close();
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test('strict init/open, immutable evidence, read-only status and exclusive owner', strictLifecycle);

async function invalidStarts() {
  for (const mutation of [
    'empty',
    'legacy',
    'version',
    'scope',
    'policy',
    'record',
    'guard',
    'guard-identity',
  ] as const) {
    function* scenario() {
      const { config, fs } = yield* ownedConfig();
      yield* initializeLiveInbox(config);
      const native = new Database(config.file, { create: false, readwrite: true });
      function legacySchema() {
        for (const table of [
          'metadata',
          'evidence',
          'receipts',
          'decisions',
          'policy',
          'policy_revisions',
        ]) {
          native.run(`DROP TABLE ${table}`);
        }
        native.run(
          'CREATE TABLE authority (scope TEXT PRIMARY KEY NOT NULL, revision TEXT NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), clock_floor INTEGER NOT NULL) STRICT',
        );
        native.run(
          'CREATE TABLE authority_revisions (scope TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(scope,revision)) STRICT',
        );
        native.run(
          'CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, command_key TEXT UNIQUE NOT NULL, record TEXT NOT NULL CHECK(json_valid(record))) STRICT',
        );
        native.run(
          'CREATE TABLE receipts (transport_key TEXT PRIMARY KEY NOT NULL, decision_id INTEGER NOT NULL REFERENCES decisions(id), verified TEXT NOT NULL CHECK(json_valid(verified))) STRICT',
        );
        native.run('PRAGMA user_version=0');
      }
      const mutations = {
        empty: () => native.run('DELETE FROM metadata'),
        legacy: legacySchema,
        version: () => native.run('PRAGMA user_version=2'),
        scope: () => native.run("UPDATE metadata SET scope='wrong'"),
        policy: () => native.run('DELETE FROM policy'),
        record: () =>
          native.run("INSERT INTO decisions(id,command_key,record) VALUES(1,'wrong','{}')"),
        guard: () => undefined,
        'guard-identity': () => undefined,
      };
      mutations[mutation]();
      native.close();
      function corruptGuard() {
        const owner = new Database(`${config.file}.owner.sqlite`, {
          create: false,
          readwrite: true,
        });
        owner.run("UPDATE ownership SET identity='wrong'");
        owner.close();
      }
      const isGuard = Schema.is(Schema.Literal('guard'));
      const isGuardIdentity = Schema.is(Schema.Literal('guard-identity'));
      const remove = Effect.succeed(isGuard(mutation));
      const corrupt = Effect.succeed(isGuardIdentity(mutation));
      yield* fs.remove(`${config.file}.owner.sqlite`).pipe(Effect.when(remove));
      yield* Effect.sync(corruptGuard).pipe(Effect.when(corrupt));
      const before = yield* fs.readFile(config.file);
      expect((yield* openLiveInbox(config).pipe(Effect.result))._tag).toBe('Failure');
      expect(yield* fs.readFile(config.file)).toEqual(before);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
}
test(
  'normal start refuses partial/corrupt/legacy/wrong scope/version/ownership without changing bytes',
  invalidStarts,
);

async function finalBarriers() {
  function* scenario() {
    const { config, setClock } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver, updatePolicy } = yield* openLiveInbox(config);
    for (const at of [
      { wallMs: 999, monotonicMs: 200 },
      { wallMs: 1000, monotonicMs: 199 },
    ]) {
      setClock(at);
      expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)).toMatchObject({
        decision: { reason: 'InvalidClock' },
      });
    }
    setClock({ wallMs: 6900, monotonicMs: 200 });
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)).toMatchObject({
      decision: { reason: 'AuthorityExpired' },
    });
    setClock({ wallMs: 1000, monotonicMs: 6100 });
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)).toMatchObject({
      decision: { reason: 'AuthorityExpired' },
    });
    setClock({ wallMs: 1000, monotonicMs: 200 });
    const next = { ...policyFixture(), revision: 'local-2', allowedOperatorIds: [] };
    expect(updatePolicy({ expectedRevision: 'wrong', next }).pipe(Result.getOrThrow)).toMatchObject(
      { _tag: 'Refused', reason: 'AuthorityChanged' },
    );
    expect(updatePolicy({ expectedRevision: 'local-1', next }).pipe(Result.getOrThrow)).toEqual({
      _tag: 'Installed',
    });
    expect(
      updatePolicy({ expectedRevision: 'local-2', next: policyFixture() }).pipe(Result.getOrThrow),
    ).toMatchObject({ _tag: 'Refused', reason: 'RevisionReused' });
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)).toMatchObject({
      decision: { reason: 'AuthorityChanged' },
    });
    const local = {
      verified: verifiedFixture(),
      expectedLocalRevision: 'local-2',
      decision: { _tag: 'Rejected' as const, reason: 'OperatorDenied' as const },
      provenance: { _tag: 'LocalPolicy' as const, revision: 'local-2' },
      evaluatedAtMs: 1000,
      evaluatedMonotonicMs: 200,
    };
    expect(driver.commit(local).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    const changed = {
      ...local.verified,
      receipt: { ...local.verified.receipt, rawBodyDigest: Digest.make('b'.repeat(64)) },
    };
    expect(driver.resolveReplay(changed).pipe(Result.getOrThrow)).toEqual({
      _tag: 'Conflict',
      reason: 'DeliveryConflict',
    });
    expect(driver.resolveReplay(verifiedFixture(55, 67)).pipe(Result.getOrThrow)).toEqual({
      _tag: 'Conflict',
      reason: 'DeliveryConflict',
    });
    expect(
      driver
        .resolveReplay({
          ...verifiedFixture(55, 67),
          receipt: { ...verifiedFixture().receipt, deliveryId: 'another' },
        })
        .pipe(Result.getOrThrow),
    ).toEqual({ _tag: 'Conflict', reason: 'CommandConflict' });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'commit rechecks local revision and both evaluation clocks, exact expiry, replay conflicts',
  finalBarriers,
);

async function rollbackAndBusy() {
  for (const point of [
    'AfterDecision',
    'AfterEvidence',
    'AfterReceipt',
    'BeforeCommit',
    'AfterCommit',
  ] as const) {
    function* scenario() {
      const { config } = yield* ownedConfig();
      yield* initializeLiveInbox(config);
      function fault(at: string) {
        return Match.value(at === point).pipe(
          Match.when(true, () => {
            throw new SyntheticFailure({ point });
          }),
          Match.orElse(() => false),
        );
      }
      const { driver } = yield* openLiveInbox({ ...config, testFault: fault });
      expect(driver.commit(draftFixture())._tag).toBe('Failure');
      const status = yield* readLiveInboxStatus(config);
      const committed = Schema.is(Schema.Literal('AfterCommit'));
      const expected = Number(committed(point));
      expect(status).toMatchObject({ decisions: expected, receipts: expected, evidence: expected });
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
  function* busy() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver } = yield* openLiveInbox(config);
    const competitor = new Database(config.file, { create: false, readwrite: true });
    competitor.run('BEGIN IMMEDIATE');
    const blocked = driver.commit(draftFixture());
    expect(blocked).toMatchObject({ _tag: 'Failure', failure: { code: 'Busy' } });
    competitor.run('ROLLBACK');
    competitor.close();
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)._tag).toBe('Recorded');
  }
  const program = Effect.gen(busy);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'native rollback leaves no partial decision/evidence/receipt; after-commit loss replays; Busy is explicit',
  rollbackAndBusy,
);

class SyntheticFailure extends Data.TaggedError('SyntheticFailure')<{ readonly point: string }> {}

async function exactCapacities() {
  function* decisions() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver } = yield* openLiveInbox(config);
    for (let id = 1; id <= 256; id++) {
      expect(driver.commit(draftFixture(id)).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    }
    expect(driver.commit(draftFixture(257)).pipe(Result.getOrThrow)).toMatchObject({
      decision: { reason: 'CapacityExceeded' },
    });
    expect(driver.resolveReplay(verifiedFixture(1)).pipe(Result.getOrThrow)._tag).toBe('Duplicate');
    expect((yield* readLiveInboxStatus(config)).decisions).toBe(256);
  }
  const decisionProgram = Effect.gen(decisions);
  const decisionScope = Effect.scoped(decisionProgram);
  const decisionPlatform = Effect.provide(decisionScope, platform);
  await Effect.runPromise(decisionPlatform);
  function* receiptsAndRevisions() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver, updatePolicy } = yield* openLiveInbox(config);
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    for (let id = 1; id < 1024; id++) {
      const verified = {
        ...verifiedFixture(),
        receipt: { ...verifiedFixture().receipt, deliveryId: `alternate-${id}` },
      };
      expect(driver.resolveReplay(verified).pipe(Result.getOrThrow)._tag).toBe('Duplicate');
    }
    expect(driver.resolveReplay(verifiedFixture()).pipe(Result.getOrThrow)._tag).toBe('Duplicate');
    const overflow = {
      ...verifiedFixture(),
      receipt: { ...verifiedFixture().receipt, deliveryId: 'overflow' },
    };
    expect(driver.resolveReplay(overflow).pipe(Result.getOrThrow)).toEqual({
      _tag: 'CapacityExceeded',
    });
    for (let revision = 2; revision <= 256; revision++) {
      const next = { ...policyFixture(), revision: `local-${revision}` };
      expect(
        updatePolicy({ expectedRevision: `local-${revision - 1}`, next }).pipe(Result.getOrThrow),
      ).toEqual({ _tag: 'Installed' });
    }
    expect(
      updatePolicy({
        expectedRevision: 'local-256',
        next: { ...policyFixture(), revision: 'local-257' },
      }).pipe(Result.getOrThrow),
    ).toEqual({ _tag: 'Refused', reason: 'CapacityExceeded' });
    expect(driver.resolveReplay(verifiedFixture()).pipe(Result.getOrThrow)._tag).toBe('Duplicate');
    expect(yield* readLiveInboxStatus(config)).toMatchObject({
      decisions: 1,
      receipts: 1024,
      authorityRevisions: 256,
      revision: 'local-256',
    });
  }
  const receiptProgram = Effect.gen(receiptsAndRevisions);
  const receiptScope = Effect.scoped(receiptProgram);
  const receiptPlatform = Effect.provide(receiptScope, platform);
  await Effect.runPromise(receiptPlatform);
}
test(
  'exact native capacities 256 decisions / 1024 receipts / 256 revisions; known replay at capacity',
  exactCapacities,
  30000,
);

async function reopenAndIsolation() {
  function* scenario() {
    const { config, fs, setClock } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    function* firstLifetime() {
      const { driver } = yield* openLiveInbox(config);
      const input = draftFixture();
      const before = structuredClone(input);
      const record = driver.commit(input).pipe(Result.getOrThrow);
      expect(input).toEqual(before);
      Reflect.set(input.verified.candidate, 'operatorId', 999);
      const historical = driver.resolveReplay(verifiedFixture()).pipe(Result.getOrThrow);
      expect(historical).toMatchObject({ record: { candidate: { operatorId: 66 } } });
      Reflect.set(record, 'record', {});
      expect(driver.resolveReplay(verifiedFixture()).pipe(Result.getOrThrow)).toEqual(historical);
      const raw = yield* fs.readFileString(`${config.file}-wal`);
      expect(raw).not.toContain('evaluatedMonotonicMs');
      expect(raw).not.toContain('startedMonotonicMs');
    }
    const first = Effect.gen(firstLifetime);
    yield* Effect.scoped(first);
    setClock({ wallMs: 999, monotonicMs: 999999 });
    function* secondLifetime() {
      const { driver } = yield* openLiveInbox(config);
      const rolledBack = {
        verified: verifiedFixture(56, 99),
        expectedLocalRevision: 'local-1',
        decision: { _tag: 'Rejected' as const, reason: 'OperatorDenied' as const },
        provenance: { _tag: 'LocalPolicy' as const, revision: 'local-1' },
        evaluatedAtMs: 999,
        evaluatedMonotonicMs: 999999,
      };
      expect(driver.commit(rolledBack).pipe(Result.getOrThrow)).toMatchObject({
        decision: { reason: 'InvalidClock' },
      });
      setClock({ wallMs: 1000, monotonicMs: 200 });
      const ownLease = { ...draftFixture(56), startedMonotonicMs: 199 };
      expect(driver.commit(ownLease).pipe(Result.getOrThrow)._tag).toBe('Recorded');
      const expiredOtherLease = { ...draftFixture(57), startedMonotonicMs: 0 };
      setClock({ wallMs: 1000, monotonicMs: 6000 });
      expect(driver.commit(expiredOtherLease).pipe(Result.getOrThrow)).toMatchObject({
        decision: { reason: 'AuthorityExpired' },
      });
      expect(driver.resolveReplay(verifiedFixture(58)).pipe(Result.getOrThrow)).toEqual({
        _tag: 'Absent',
      });
      expect(driver.loadPolicy('fixture-app').pipe(Result.getOrThrow).policy).toEqual(
        policyFixture(),
      );
    }
    const second = Effect.gen(secondLifetime);
    yield* Effect.scoped(second);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'reopen persists wall floor but no permission cache/absolute monotonic ticks; leases and caller data isolated',
  reopenAndIsolation,
);

async function driftedEvidence() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver } = yield* openLiveInbox(config);
    const draft = draftFixture();
    const mutation = { ...draft, evaluatedMonotonicMs: 99 };
    expect(driver.commit(mutation)._tag).toBe('Failure');
    expect(driver.commit(draft).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    const other = Schema.decodeUnknownSync(LiveAdmissionDraft)({
      ...draftFixture(56),
      decision: { ...draft.decision, commandKey: '[11,22,56]' },
      provenance: {
        _tag: 'LiveChecked',
        evidence: { ...draft.provenance.evidence, commandKey: '[11,22,56]' },
      },
    });
    expect(driver.commit(other)._tag).toBe('Failure');
    expect(yield* readLiveInboxStatus(config)).toMatchObject({
      decisions: 1,
      receipts: 1,
      evidence: 1,
    });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'forged evaluation start and reused evidence identity cannot create partial keys',
  driftedEvidence,
);

async function lastWriteBarrier() {
  function* scenario() {
    const { config, setClock } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    function fault(point: string) {
      return Match.value(point).pipe(
        Match.when('BeforeCommit', () => setClock({ wallMs: 6900, monotonicMs: 6100 })),
        Match.orElse(() => undefined),
      );
    }
    const { driver } = yield* openLiveInbox({ ...config, testFault: fault });
    const reply = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(reply).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'AuthorityExpired' } });
    expect(yield* readLiveInboxStatus(config)).toMatchObject({
      decisions: 0,
      evidence: 0,
      receipts: 0,
    });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'final clock barrier after writes rolls back keys when evidence expires before commit',
  lastWriteBarrier,
);

async function corruptActiveEvidence() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver } = yield* openLiveInbox(config);
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    const native = new Database(config.file, { create: false, readwrite: true });
    native.run('DELETE FROM evidence');
    native.close();
    const reply = driver.resolveReplay(verifiedFixture());
    expect(reply).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidData' } });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'active replay refuses missing per-decision evidence rather than silently trusting JSON alone',
  corruptActiveEvidence,
);

async function nativeInterleaving() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver, updatePolicy } = yield* openLiveInbox(config);
    const competing = new Database(config.file, { create: false, readwrite: true });
    competing.run('BEGIN IMMEDIATE');
    const firstOperator = draftFixture(55, policyFixture(), 66);
    const secondOperator = draftFixture(55, policyFixture(), 67);
    const busy = driver.commit(firstOperator);
    expect(busy).toMatchObject({ _tag: 'Failure', failure: { code: 'Busy' } });
    competing.run('ROLLBACK');
    competing.close(true);
    expect(driver.commit(secondOperator).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    const first = draftFixture(55, policyFixture(), 66);
    const loser = {
      ...first,
      verified: {
        ...first.verified,
        receipt: { ...first.verified.receipt, deliveryId: 'loser-delivery' },
      },
    };
    expect(driver.commit(loser).pipe(Result.getOrThrow)).toMatchObject({
      _tag: 'Unrecorded',
      decision: { reason: 'CommandConflict' },
    });
    const stale = draftFixture(56);
    expect(
      updatePolicy({
        expectedRevision: 'local-1',
        next: { ...policyFixture(), revision: 'local-2' },
      }).pipe(Result.getOrThrow)._tag,
    ).toBe('Installed');
    expect(driver.commit(stale).pipe(Result.getOrThrow)).toMatchObject({
      decision: { reason: 'AuthorityChanged' },
    });
    expect(yield* readLiveInboxStatus(config)).toMatchObject({
      decisions: 1,
      evidence: 1,
      receipts: 1,
    });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'two native connections interleave one command, different operators, and local policy update',
  nativeInterleaving,
);

async function committedNativeWinners() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver } = yield* openLiveInbox(config);
    const original = draftFixture(55);
    const duplicate = Schema.decodeUnknownSync(LiveAdmissionDraft.members[1])({
      ...original,
      provenance: {
        ...original.provenance,
        evidence: { ...original.provenance.evidence, evidenceId: 'losing-duplicate-evidence' },
      },
      decision: { ...original.decision, evidenceRevision: 'losing-duplicate-evidence' },
    });
    const conflict = draftFixture(55, policyFixture(), 67);
    const losing = {
      ...conflict,
      verified: {
        ...conflict.verified,
        receipt: { ...conflict.verified.receipt, deliveryId: 'native-loser' },
      },
    };
    const winner = LiveAdmissionRecord.make({
      decisionId: '1',
      commandKey: commandKey(duplicate.verified.candidate),
      candidate: duplicate.verified.candidate,
      localPolicyRevision: duplicate.expectedLocalRevision,
      provenance: original.provenance,
      decision: original.decision,
      evaluatedAtMs: duplicate.evaluatedAtMs,
      committedAtMs: 1000,
    });
    // Deliberately bypass only the test's owner resource: a raw native ledger writer.
    const native = new Database(config.file, { create: false, readwrite: true, strict: true });
    native.run('PRAGMA foreign_keys=ON');
    function win() {
      native
        .query('INSERT INTO decisions VALUES(?,?,?)')
        .run(1, winner.commandKey, encodeRecord(winner));
      native
        .query('INSERT INTO evidence VALUES(?,?,?)')
        .run(
          original.provenance.evidence.evidenceId,
          1,
          encodeEvidence(original.provenance.evidence),
        );
      native
        .query('INSERT INTO receipts VALUES(?,?,?)')
        .run(
          transportKey(
            duplicate.verified.receipt.ingressScopeId,
            duplicate.verified.receipt.deliveryId,
          ),
          1,
          encodeVerified(duplicate.verified),
        );
    }
    native.transaction(win).immediate();
    expect(driver.commit(duplicate).pipe(Result.getOrThrow)).toEqual({
      _tag: 'Duplicate',
      record: winner,
    });
    expect(driver.commit(losing).pipe(Result.getOrThrow)).toMatchObject({
      _tag: 'Unrecorded',
      decision: { reason: 'CommandConflict' },
    });
    expect(native.query('SELECT record FROM decisions').all()).toEqual([
      { record: encodeRecord(winner) },
    ]);
    expect(native.query('SELECT evidence_id, evidence FROM evidence').all()).toEqual([
      {
        evidence_id: original.provenance.evidence.evidenceId,
        evidence: encodeEvidence(original.provenance.evidence),
      },
    ]);
    expect(native.query('SELECT transport_key FROM receipts').all()).toEqual([
      {
        transport_key: transportKey(
          duplicate.verified.receipt.ingressScopeId,
          duplicate.verified.receipt.deliveryId,
        ),
      },
    ]);
    native.close(true);
    expect(yield* readLiveInboxStatus(config)).toMatchObject({
      decisions: 1,
      evidence: 1,
      receipts: 1,
    });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'independent native committed winner defeats evaluated duplicate and different-operator drafts',
  committedNativeWinners,
);

async function committedNativePolicy() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const fault = mock((point: string) => point);
    const { driver } = yield* openLiveInbox({ ...config, testFault: fault });
    const stale = draftFixture(56);
    const native = new Database(config.file, { create: false, readwrite: true, strict: true });
    native.run('PRAGMA foreign_keys=ON');
    const next = { ...policyFixture(), revision: 'local-2' };
    function revise() {
      native
        .query('INSERT INTO policy_revisions VALUES(?,?)')
        .run(next.revision, encodePolicy(next));
      native.query('UPDATE policy SET revision=? WHERE id=1').run(next.revision);
    }
    native.transaction(revise).immediate();
    expect(driver.commit(stale).pipe(Result.getOrThrow)).toMatchObject({
      _tag: 'Unrecorded',
      decision: { reason: 'AuthorityChanged' },
    });
    expect(fault.mock.calls).not.toContainEqual(['AfterDecision']);
    expect(native.query('SELECT command_key FROM decisions').all()).toEqual([]);
    expect(native.query('SELECT evidence_id FROM evidence').all()).toEqual([]);
    expect(native.query('SELECT transport_key FROM receipts').all()).toEqual([]);
    native.close(true);
    expect(yield* readLiveInboxStatus(config)).toMatchObject({
      decisions: 0,
      evidence: 0,
      receipts: 0,
      authorityRevisions: 2,
    });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'independent native committed policy revision defeats an already evaluated draft',
  committedNativePolicy,
);

async function constructionAndLimits() {
  function* scenario() {
    const { config, fs } = yield* ownedConfig();
    for (const limits of [
      { decisions: 257, receipts: 1024, authorityRevisions: 256 },
      { decisions: 256, receipts: 1025, authorityRevisions: 256 },
      { decisions: 256, receipts: 1024, authorityRevisions: 257 },
      { decisions: 0, receipts: 1024, authorityRevisions: 256 },
    ]) {
      const invalid = yield* initializeLiveInbox({ ...config, limits }).pipe(Effect.result);
      expect(invalid._tag).toBe('Failure');
      expect(yield* fs.exists(config.file)).toBe(false);
    }
    yield* initializeLiveInbox(config);
    config.limits.decisions = 1;
    const opening = openLiveInbox(config);
    config.limits.decisions = 256;
    config.ingressScopeId = 'other';
    config.file = `${config.file}-other`;
    config.clock = () => ({ wallMs: 0, monotonicMs: 0 });
    const { driver } = yield* opening;
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    expect(driver.commit(draftFixture(56)).pipe(Result.getOrThrow)).toMatchObject({
      decision: { reason: 'CapacityExceeded' },
    });
    expect(driver.loadPolicy('fixture-app').pipe(Result.getOrThrow).at.wallMs).toBe(1000);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'limits cannot exceed ceilings and construction snapshots scope/path/limits/callable identities',
  constructionAndLimits,
);

async function consistentStatusSnapshot() {
  function* scenario() {
    const { config, setClock } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver } = yield* openLiveInbox(config);
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    let armed = true;
    function observe<Row, Params extends SQLQueryBindings | SQLQueryBindings[]>(
      this: Database,
      sql: string,
    ) {
      function interleave() {
        armed = false;
        setClock({ wallMs: 1001, monotonicMs: 201 });
        expect(driver.commit(draftFixture(56)).pipe(Result.getOrThrow)._tag).toBe('Recorded');
      }
      const trigger = Option.liftPredicate(
        sql,
        (value) => armed && this.filename === config.file && value.includes('AS decisions'),
      );
      Option.map(trigger, interleave);
      return this.prepare<Row, Params>(sql);
    }
    spyOn(Database.prototype, 'query').mockImplementation(observe);
    const status = yield* readLiveInboxStatus(config);
    expect(armed).toBe(false);
    expect(status).toMatchObject({ decisions: 2, evidence: 2, receipts: 2 });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'status validates one coherent native snapshot while a competing connection commits',
  consistentStatusSnapshot,
);

async function localRefusalCannotMaskEvidence() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const { driver } = yield* openLiveInbox(config);
    const draft = draftFixture(55, policyFixture(), 99);
    const forged = Schema.decodeUnknownSync(LiveAdmissionDraft)({
      ...draft,
      decision: { _tag: 'Rejected', reason: 'OperatorDenied' },
      provenance: {
        _tag: 'LiveChecked',
        evidence: { ...draft.provenance.evidence, appId: 999, basePermission: 'none' },
      },
    });
    const reply = driver.commit(forged).pipe(Result.getOrThrow);
    expect(reply).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'AuthorityChanged' } });
    expect((yield* readLiveInboxStatus(config)).decisions).toBe(0);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'local allowlist denial cannot hide unrelated LiveChecked evidence behind the same rejection reason',
  localRefusalCannotMaskEvidence,
);
