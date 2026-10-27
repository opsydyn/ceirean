import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Match,
  Option,
  Result,
  Schema,
  Scope,
} from 'effect';

import { evidenceRequirements, requiredCases, type CleanupObservation } from './contract.ts';
import { assertDockerReadback } from './docker-controls.ts';
import { readDockerEvidence } from './docker-evidence.ts';
import { DockerProcess, requireSupervisor, SupervisorError } from './docker-process.ts';
import { DockerSession } from './docker-session.ts';
import {
  openWorkerEvidenceChannel,
  WorkerEvidenceReady,
  WorkerWarmupReady,
  type WorkerMode,
} from './live-handoff.ts';
import { PreparedInputs } from './prepared-inputs.ts';
import { toolPins } from './tool-pins.ts';

export { DockerProcess, makeDockerProcess } from './docker-process.ts';
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isEmpty = Schema.is(Schema.Literal(''));
const isConfirmed = Schema.is(Schema.Literal('ConfirmedRemoval'));
const isTimeout = Schema.is(Schema.Struct({ _tag: Schema.Literal('TimeoutError') }));
const isQualification = Schema.is(Schema.Literal('Qualification'));
const ImageReadback = Schema.Array(
  Schema.Struct({ Image: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)) }),
);
const PausedReadback = Schema.Array(
  Schema.Struct({
    Id: Schema.String,
    State: Schema.Struct({ Running: Schema.Boolean, Paused: Schema.Boolean }),
  }),
);
const decodeImage = Schema.decodeUnknownEffect(Schema.fromJsonString(ImageReadback));
const decodePaused = Schema.decodeUnknownEffect(Schema.fromJsonString(PausedReadback));
const ownedInspect = Schema.Array(
  Schema.Struct({
    Id: Schema.String,
    Name: Schema.String,
    State: Schema.optionalKey(Schema.Struct({ Running: Schema.Boolean })),
    Config: Schema.Struct({ Labels: Schema.Record(Schema.String, Schema.String) }),
  }),
);
const decodeOwnership = Schema.decodeUnknownEffect(Schema.fromJsonString(ownedInspect));
export function fixedCreateArguments(input: {
  name: string;
  token: string;
  uid: number;
  gid: number;
  root: string;
  mode?: WorkerMode;
}) {
  const owner = `uid=${input.uid},gid=${input.gid}`;
  return [
    'create',
    '--interactive',
    '--pull=never',
    '--name',
    input.name,
    '--label',
    `ceirean.qualification=${input.token}`,
    '--network=none',
    '--read-only',
    '--user',
    `${input.uid}:${input.gid}`,
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--ipc=private',
    '--cpus=2',
    '--memory=4294967296',
    '--memory-swap=4294967296',
    '--pids-limit=128',
    '--tmpfs',
    `/work:rw,noexec,nosuid,nodev,size=2952790016,mode=0700,${owner}`,
    '--tmpfs',
    `/home:rw,noexec,nosuid,nodev,size=134217728,mode=0700,${owner}`,
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,nodev,size=134217728,mode=0700,${owner}`,
    '--mount',
    `type=bind,src=${input.root},dst=/inputs,readonly`,
    '--mount',
    `type=bind,src=${input.root}/tools,dst=/tools,readonly`,
    '--workdir=/work',
    '--env',
    'TMPDIR=/work',
    '--env',
    'HOME=/home',
    '--env',
    'PATH=/tools:/usr/local/bin',
    '--env',
    'LANG=C',
    '--env',
    'LC_ALL=C',
    '--entrypoint=/tools/node',
    toolPins.installerImage,
    '/tools/worker.mjs',
    Match.value(input.mode ?? 'Qualification').pipe(
      Match.when('Qualification', () => '--worker'),
      Match.when('InterruptWarmup', () => '--rehearse-interrupt-warmup'),
      Match.when('Deadline', () => '--rehearse-deadline'),
      Match.exhaustive,
    ),
  ];
}

// Register before create. A lost acknowledgement remains uncertain even after
// an empty name lookup: the daemon may complete that request later.
export function superviseFixedWorker(inputs: PreparedInputs, mode: WorkerMode = 'Qualification') {
  function* supervise() {
    const fs = yield* FileSystem.FileSystem;
    const docker = yield* DockerProcess;
    const supervisorScope = yield* Scope.Scope;
    const transports: Effect.Success<ReturnType<typeof DockerSession.Service.attach>>[] = [];
    const handoffs: Effect.Success<ReturnType<typeof openWorkerEvidenceChannel>>[] = [];
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-supervisor-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.chmod(root, 0o700);
    const owner = yield* fs.stat(inputs.root);
    const uid = Option.getOrElse(owner.uid, () => 0);
    const gid = Option.getOrElse(owner.gid, () => 0);
    const safeOwner = [uid > 0, gid > 0, (owner.mode & 0o777) === 0o700].every(Boolean);
    yield* requireSupervisor(safeOwner, 'BlockedControls');
    const canonical = yield* fs.realPath(inputs.root);
    const safeRoot = [canonical === inputs.root, !inputs.root.includes(',')].every(Boolean);
    yield* requireSupervisor(safeRoot, 'InputChanged');
    const preparedPath = `${inputs.root}/prepared.json`;
    const prepared = encode({ ...inputs, root: '/inputs' });
    const exists = yield* fs.exists(preparedPath);
    function checkPrepared() {
      function* check() {
        const text = yield* fs.readFileString(preparedPath);
        yield* requireSupervisor(text === prepared, 'InputChanged');
      }
      const workflow = Effect.gen(check);
      return workflow;
    }
    yield* Match.value(exists).pipe(
      Match.when(true, checkPrepared),
      Match.orElse(() => fs.writeFileString(preparedPath, prepared, { flag: 'wx', mode: 0o600 })),
    );
    const token = yield* Effect.try(() => crypto.randomUUID());
    const name = `ceirean-linux-${token}`;
    yield* fs.writeFileString(
      `${inputs.root}/producer-${mode}.json`,
      encode({ producerId: token, mode, request: inputs.admission.request }),
      { flag: 'wx', mode: 0o600 },
    );
    const evidenceRoot = `${root}/export`;
    yield* fs.makeDirectory(evidenceRoot, { mode: 0o700 });
    const state: {
      acknowledged: boolean;
      workerExit: number | undefined;
      cleanup: CleanupObservation;
      containerId: string | undefined;
      ready: typeof WorkerEvidenceReady.Type | undefined;
      installerConfigSha256: string | undefined;
      warmup: typeof WorkerWarmupReady.Type | undefined;
      pausedTop: string | undefined;
      deadlineElapsed: boolean;
      interrupted: boolean;
    } = {
      acknowledged: false,
      workerExit: undefined,
      cleanup: { _tag: 'Unknown', evidence: ['cleanup.json'] },
      containerId: undefined,
      ready: undefined,
      installerConfigSha256: undefined,
      warmup: undefined,
      pausedTop: undefined,
      deadlineElapsed: false,
      interrupted: false,
    };
    const paused = yield* Deferred.make<void>();
    yield* fs.writeFileString(
      `${root}/ownership.json`,
      encode({ name, token, create: 'Pending' }),
      { flag: 'wx', mode: 0o600 },
    );
    function command(args: readonly string[], timeout = 90000, expired?: Deferred.Deferred<void>) {
      function* invoke() {
        const blocked = expired !== undefined && Deferred.isDoneUnsafe(expired);
        const action = Match.value(blocked).pipe(
          Match.when(true, () => Effect.fail(new SupervisorError({ code: 'CleanupUnknown' }))),
          Match.orElse(() => docker.run(args, root, timeout)),
        );
        const output = yield* action;
        const bounded = [output.stdout, output.stderr].every(
          (text) => new TextEncoder().encode(text).length <= 262144,
        );
        yield* requireSupervisor(bounded);
        return output;
      }
      const workflow = Effect.gen(invoke);
      return workflow;
    }
    function inventory(timeout = 90000) {
      function* list() {
        const listed = yield* command(
          [
            'container',
            'ls',
            '--all',
            '--no-trunc',
            '--filter',
            `name=^/${name}$`,
            '--format',
            '{{.ID}}',
          ],
          timeout,
        );
        const readable = [listed.exitCode === 0, isEmpty(listed.stderr)].every(Boolean);
        yield* requireSupervisor(readable, 'CleanupUnknown');
        const ids = listed.stdout.trim().split('\n').filter(Boolean);
        const known = [ids.length <= 1, ids.every((id) => /^[a-f0-9]{64}$/.test(id))].every(
          Boolean,
        );
        yield* requireSupervisor(known, 'CleanupUnknown');
        return ids;
      }
      const workflow = Effect.gen(list);
      return workflow;
    }
    function confirmOwner(expectedRunning?: boolean, timeout = 90000) {
      function* inspect() {
        const inspected = yield* command(['inspect', '--type=container', name], timeout);
        const readable = [inspected.exitCode === 0, isEmpty(inspected.stderr)].every(Boolean);
        yield* requireSupervisor(readable, 'CleanupUnknown');
        const items = yield* decodeOwnership(inspected.stdout);
        const stateMatches = Option.match(Option.fromNullishOr(expectedRunning), {
          onNone: () => true,
          onSome: (expected) => items.every((item) => item.State?.Running === expected),
        });
        const owned = [
          items.length === 1,
          items.every((item) => item.Name === `/${name}`),
          items.every((item) => item.Config.Labels['ceirean.qualification'] === token),
          items.every((item) => /^[a-f0-9]{64}$/.test(item.Id)),
          items.every((item) => state.containerId === undefined || item.Id === state.containerId),
          stateMatches,
        ].every(Boolean);
        yield* requireSupervisor(owned, 'CleanupUnknown');
        return items[0]!.Id;
      }
      const workflow = Effect.gen(inspect);
      return workflow;
    }
    function* removeOwned(expired: Deferred.Deferred<void>) {
      for (const expectedId of yield* inventory(20000)) {
        const id = yield* confirmOwner(undefined, 20000);
        yield* requireSupervisor(id === expectedId, 'CleanupUnknown');
        const stopping = command(['stop', '--time=3', id], 3000, expired).pipe(
          Effect.timeout(3000),
          Effect.catchDefect(() => Effect.fail(new SupervisorError({ code: 'CleanupUnknown' }))),
          Effect.result,
        );
        yield* stopping;
        const removed = yield* command(['rm', '--force', id], 20000, expired);
        yield* requireSupervisor(removed.exitCode === 0, 'CleanupUnknown');
      }
    }
    function cleanup() {
      function* clean() {
        const expired = yield* Deferred.make<void>();
        const settled = yield* Deferred.make<void>();
        let removalSucceeded = false;
        function* expirePhase() {
          yield* Effect.sleep(20000);
          yield* Deferred.succeed(expired, undefined);
        }
        const timer = yield* Effect.gen(expirePhase).pipe(Effect.forkChild);
        function* waitForExpiry() {
          yield* Deferred.await(expired).pipe(Effect.timeoutOption(30000));
          yield* Effect.fail(new SupervisorError({ code: 'CleanupUnknown' }));
        }
        function* removePhase() {
          const expiry = Effect.gen(waitForExpiry);
          const removal = yield* Effect.gen(() => removeOwned(expired)).pipe(
            Effect.raceFirst(expiry),
            Effect.scoped,
            Effect.catchDefect(() => Effect.fail(new SupervisorError({ code: 'CleanupUnknown' }))),
            Effect.result,
          );
          removalSucceeded = Result.isSuccess(removal);
          yield* Deferred.succeed(settled, undefined);
          return removal;
        }
        function* readPhase() {
          const expiration = Deferred.await(expired).pipe(Effect.timeout(30000));
          const settlement = Deferred.await(settled).pipe(Effect.timeout(30000));
          yield* Effect.raceFirst(settlement, expiration).pipe(Effect.scoped);
          const afterRemoval = removalSucceeded;
          const readback = yield* inventory(10000).pipe(
            Effect.timeout(10000),
            Effect.catchDefect(() => Effect.fail(new SupervisorError({ code: 'CleanupUnknown' }))),
            Effect.result,
          );
          return { readback, afterRemoval };
        }
        const [removal, observation] = yield* Effect.all(
          [Effect.gen(removePhase), Effect.gen(readPhase)],
          { concurrency: 2 },
        );
        yield* Fiber.interrupt(timer);
        const readback = observation.readback;
        const confirmed = [
          Result.isSuccess(removal),
          observation.afterRemoval,
          state.acknowledged,
        ].every(Boolean);
        const resources = Result.getOrElse(readback, () => [] as string[]);
        const status = {
          readable: Result.isSuccess(readback),
          absent: resources.length === 0,
          confirmed,
        };
        state.cleanup = Match.value(status).pipe(
          Match.when({ readable: true, absent: true, confirmed: true }, () => ({
            _tag: 'ConfirmedRemoval' as const,
            evidence: ['cleanup.json'],
          })),
          Match.when({ readable: true, absent: false }, () => ({
            _tag: 'RemainingResources' as const,
            resources,
            evidence: ['cleanup.json'],
          })),
          Match.orElse(() => ({ _tag: 'Unknown' as const, evidence: ['cleanup.json'] })),
        );
      }
      const workflow = Effect.gen(clean);
      const bounded = workflow.pipe(
        Effect.scoped,
        Effect.interruptible,
        Effect.timeout(30000),
        Effect.catchDefect(() => Effect.fail(new SupervisorError({ code: 'CleanupUnknown' }))),
        Effect.result,
      );
      function record(result: Result.Result<void, unknown>) {
        state.cleanup = Result.match(result, {
          onSuccess: () => state.cleanup,
          onFailure: () => ({ _tag: 'Unknown', evidence: ['cleanup.json'] }),
        });
      }
      const recorded = bounded.pipe(Effect.map(record));
      return recorded;
    }
    function* execute() {
      yield* Effect.addFinalizer(cleanup);
      const created = yield* command(
        fixedCreateArguments({ name, token, uid, gid, root: inputs.root, mode }),
      );
      const acknowledged = [
        created.exitCode === 0,
        /^[a-f0-9]{64}\n?$/.test(created.stdout),
        isEmpty(created.stderr),
      ].every(Boolean);
      yield* requireSupervisor(acknowledged, 'CleanupUnknown');
      state.acknowledged = true;
      state.containerId = created.stdout.trim();
      const id = yield* confirmOwner();
      yield* requireSupervisor(id === created.stdout.trim(), 'CleanupUnknown');
      const effective = yield* command(['inspect', '--type=container', name]);
      yield* requireSupervisor(effective.exitCode === 0);
      yield* assertDockerReadback(effective.stdout, { uid, gid, root: inputs.root });
      const image = yield* decodeImage(effective.stdout);
      state.installerConfigSha256 = image[0]?.Image?.replace(/^sha256:/, '');
      const sessions = yield* DockerSession;
      const attaching = sessions.attach(name, root).pipe(Scope.provide(supervisorScope));
      const session = yield* attaching;
      transports.push(session);
      const opening = openWorkerEvidenceChannel(session.stdout, inputs, token).pipe(
        Scope.provide(supervisorScope),
      );
      const channel = yield* opening;
      handoffs.push(channel);
      const frame = yield* channel.ready;
      for (const rehearsal of [mode].filter((value) => !isQualification(value))) {
        const warmup = yield* Schema.decodeUnknownEffect(WorkerWarmupReady)(frame);
        yield* requireSupervisor(warmup.mode === rehearsal, 'InputChanged');
        yield* confirmOwner(true);
        const frozen = yield* command(['pause', id]);
        yield* requireSupervisor(frozen.exitCode === 0 && isEmpty(frozen.stderr));
        const inspected = yield* command(['inspect', '--type=container', name]);
        yield* requireSupervisor(inspected.exitCode === 0 && isEmpty(inspected.stderr));
        const pausedItems = yield* decodePaused(inspected.stdout);
        yield* requireSupervisor(
          pausedItems.length === 1 &&
            pausedItems.every((item) => item.Id === id && item.State.Running && item.State.Paused),
        );
        const top = yield* command(['top', id, '-eo', 'pid,comm']);
        const rows = top.stdout.trim().split('\n');
        const liveWarmup = [
          top.exitCode === 0,
          isEmpty(top.stderr),
          /^\s*PID\s+COMMAND\s*$/.test(rows[0] ?? ''),
          rows.slice(1).every((row) => /^\s*[1-9][0-9]*\s+(?:node|bun)\s*$/.test(row)),
          rows.slice(1).filter((row) => /\s+bun\s*$/.test(row)).length === 1,
        ].every(Boolean);
        yield* requireSupervisor(liveWarmup);
        state.warmup = warmup;
        state.pausedTop = top.stdout;
        yield* Deferred.succeed(paused, undefined);
        const hold = session.wait.pipe(Effect.andThen(requireSupervisor(false)));
        function markDeadline(error: unknown) {
          const recording = Effect.sync(() => {
            state.deadlineElapsed = isTimeout(error);
          });
          return recording;
        }
        const deadline = hold.pipe(Effect.timeout(1000), Effect.tapError(markDeadline));
        const held = Match.value(rehearsal).pipe(
          Match.when('Deadline', () => deadline),
          Match.orElse(() => hold),
        );
        yield* held;
      }
      const ready = yield* Schema.decodeUnknownEffect(WorkerEvidenceReady)(frame);
      state.ready = ready;
      const requiredFiles = requiredCases
        .slice(0, 9)
        .map((caseId) => evidenceRequirements[caseId].name);
      const files = [
        ...requiredFiles.filter(() => ready.workerExit === 0),
        'worker-diagnostic.json',
      ];
      for (const file of files) {
        yield* confirmOwner(true);
        const exported = yield* command(['cp', `${name}:/work/evidence/${file}`, '-']);
        yield* requireSupervisor(exported.exitCode === 0);
        const bytes = yield* readDockerEvidence(exported.bytes, file);
        yield* fs.writeFile(`${evidenceRoot}/${file}`, bytes, { flag: 'wx', mode: 0o600 });
      }
      yield* confirmOwner(true);
      yield* session.acknowledge(inputs.admission.request.run.runId, token);
      const attachedExit = yield* session.wait;
      yield* requireSupervisor(attachedExit.exitCode === ready.workerExit);
      yield* channel.finished;
      yield* confirmOwner(false);
      const waited = yield* command(['wait', name], 90000);
      const stopped = [
        waited.exitCode === 0,
        /^(0|[1-9][0-9]{0,2})\n?$/.test(waited.stdout),
        Number(waited.stdout.trim()) === ready.workerExit,
      ].every(Boolean);
      yield* requireSupervisor(stopped);
      state.workerExit = ready.workerExit;
    }
    const execution = Effect.gen(execute);
    function* interrupted() {
      const running = execution.pipe(Effect.scoped, Effect.forkChild);
      const fiber = yield* running;
      const premature = Fiber.join(fiber).pipe(Effect.andThen(requireSupervisor(false)));
      yield* Effect.raceFirst(Deferred.await(paused), premature).pipe(Effect.scoped);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      yield* requireSupervisor(Exit.hasInterrupts(exit));
      state.interrupted = true;
    }
    const selected = Match.value(mode).pipe(
      Match.when('InterruptWarmup', () => Effect.gen(interrupted)),
      Match.orElse(() => execution),
    );
    const bounded = selected.pipe(Effect.timeout(540000), Effect.scoped, Effect.result);
    const result = yield* bounded;
    const draining = Effect.all(
      [
        ...transports.filter(() => !isQualification(mode)).map((transport) => transport.wait),
        ...handoffs.map((handoff) => handoff.finished),
      ],
      { concurrency: 2 },
    );
    const drainable = Match.value(isConfirmed(state.cleanup._tag)).pipe(
      Match.when(true, () => draining),
      Match.orElse(() => requireSupervisor(false)),
    );
    const drained = yield* drainable.pipe(Effect.timeout(90000), Effect.result);
    yield* fs.writeFileString(
      `${evidenceRoot}/cleanup.json`,
      encode({ observation: state.cleanup }),
      { flag: 'wx', mode: 0o600 },
    );
    const complete = [
      Result.isSuccess(result),
      Result.isSuccess(drained),
      isConfirmed(state.cleanup._tag),
    ].every(Boolean);
    const rehearsed = [
      state.warmup !== undefined,
      state.pausedTop !== undefined,
      Result.isSuccess(drained),
      isConfirmed(state.cleanup._tag),
      Match.value(mode).pipe(
        Match.when('InterruptWarmup', () => Result.isSuccess(result)),
        Match.when(
          'Deadline',
          () => state.deadlineElapsed && Result.isFailure(result) && isTimeout(result.failure),
        ),
        Match.orElse(() => false),
      ),
    ].every(Boolean);
    const termination = Match.value({
      interrupted: state.interrupted,
      deadline: state.deadlineElapsed,
    }).pipe(
      Match.when({ interrupted: true }, () => 'Interrupted' as const),
      Match.when({ deadline: true }, () => 'DeadlineElapsed' as const),
      Match.orElse(() => 'Unconfirmed' as const),
    );
    return {
      complete,
      workerExit: state.workerExit,
      cleanup: state.cleanup,
      evidenceRoot,
      name,
      producerId: token,
      containerId: state.containerId,
      ready: state.ready,
      installerConfigSha256: state.installerConfigSha256,
      rehearsal: {
        mode,
        termination,
        confirmed: rehearsed,
        warmup: state.warmup,
        pausedTop: state.pausedTop,
      },
    };
  }
  const workflow = Effect.gen(supervise);
  return workflow;
}
