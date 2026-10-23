import { YAML } from 'bun';
import { Effect, Match, Option, Result, Schema } from 'effect';

import type { PreflightReport, Reason } from './contracts.ts';
import type { HostReadError, makeHostReader, ToolId } from './host-reader.ts';

type Reader = ReturnType<typeof makeHostReader>;
type Observation = Effect.Success<ReturnType<Reader['readRegular']>>;
export interface InspectRequest {
  readonly profile: string;
  readonly colimaRoot: string;
  readonly configPath: string;
  readonly configurationSemantics: 'ReviewedColimaYaml' | 'Unsupported';
  readonly host?:
    | {
        readonly architecture?: unknown;
        readonly totalMemoryBytes?: unknown;
        readonly freeMemoryBytes?: unknown;
        readonly cpuCount?: unknown;
      }
    | undefined;
}

const strict = { onExcessProperty: 'error' } as const;
const Positive = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const MountPath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024));
const Mount = Schema.Struct({
  location: MountPath,
  mountPoint: Schema.optionalKey(MountPath),
  writable: Schema.optionalKey(Schema.Boolean),
});
const Mounts = Schema.Array(Mount).check(Schema.isMaxLength(64));
// Deliberately narrower than the full Colima configuration language.
const Config = Schema.Struct({
  runtime: Schema.optionalKey(Schema.Literal('docker')),
  mounts: Schema.optionalKey(Mounts),
  forwardAgent: Schema.optionalKey(Schema.Boolean),
  cpu: Schema.optionalKey(Positive),
  memory: Schema.optionalKey(Positive),
  disk: Schema.optionalKey(Positive),
  arch: Schema.optionalKey(Schema.Literals(['aarch64', 'x86_64', 'host'])),
  autoActivate: Schema.optionalKey(Schema.Boolean),
});
const ObjectFields = Schema.Record(Schema.String, Schema.Unknown);
const allowed = new Set(Object.keys(Config.fields));
const unknown = { _tag: 'Unknown' } as const;
const isUnknown = Schema.is(Schema.TaggedStruct('Unknown', {}));
const isAvailable = Schema.is(Schema.Struct({ status: Schema.Literal('Available') }));
const isTimedOut = Schema.is(Schema.Struct({ status: Schema.Literal('TimedOut') }));
const isTruncated = Schema.is(Schema.Struct({ status: Schema.Literal('Truncated') }));
const ShortVersion = Schema.String.check(Schema.isMaxLength(64));
const RequestIdentity = Schema.Struct({
  profile: Schema.Literal('ceirean'),
  configurationSemantics: Schema.Literal('ReviewedColimaYaml'),
});
const traversal = new Set(['.', '..']);

function numberObservation(value: unknown, minimum = 1) {
  const Bound = Schema.Int.check(Schema.isBetween({ minimum, maximum: Number.MAX_SAFE_INTEGER }));
  const valid = Schema.is(Bound)(value);
  return Match.value(valid).pipe(
    Match.when(true, () => ({ _tag: 'Known' as const, value: Number(value) })),
    Match.orElse(() => unknown),
  );
}
function consistentFree(
  total: ReturnType<typeof numberObservation>,
  free: ReturnType<typeof numberObservation>,
) {
  return Match.value({ total, free }).pipe(
    Match.when(
      { total: { _tag: 'Known' }, free: { _tag: 'Known' } },
      (m) => m.free.value <= m.total.value,
    ),
    Match.orElse(() => false),
  );
}
function hostSnapshot(host: InspectRequest['host']): PreflightReport['host'] {
  const architecture = Match.value(host?.architecture).pipe(
    Match.when('arm64', (value) => ({ _tag: 'Known' as const, value })),
    Match.when('x64', (value) => ({ _tag: 'Known' as const, value })),
    Match.orElse(() => unknown),
  );
  const totalMemoryBytes = numberObservation(host?.totalMemoryBytes);
  const free = numberObservation(host?.freeMemoryBytes, 0);
  const freeMemoryBytes = Match.value(consistentFree(totalMemoryBytes, free)).pipe(
    Match.when(true, () => free),
    Match.orElse(() => unknown),
  );
  return {
    architecture,
    totalMemoryBytes,
    freeMemoryBytes,
    cpuCount: numberObservation(host?.cpuCount),
  };
}
function acceptedRequest(request: InspectRequest) {
  return [
    Schema.is(RequestIdentity)(request),
    /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(request.colimaRoot),
    !request.colimaRoot.split('/').some((segment) => traversal.has(segment)),
    request.colimaRoot.length <= 450,
    request.configPath === `${request.colimaRoot}/ceirean/colima.yaml`,
  ].every(Boolean);
}
function validObservation(observation: Observation, limit: number) {
  const encoded = new TextEncoder().encode(observation.text);
  return [
    !observation.truncated,
    observation.bytes.length <= limit,
    encoded.length === observation.bytes.length,
    encoded.every((byte, index) => byte === observation.bytes[index]),
  ].every(Boolean);
}
function versionStatus(error: HostReadError) {
  return Match.value(error.code).pipe(
    Match.when('TimedOut', () => 'TimedOut' as const),
    Match.when('Unavailable', () => 'Unavailable' as const),
    Match.when('OutputTooLarge', () => 'Truncated' as const),
    Match.when('FileTooLarge', () => 'Truncated' as const),
    Match.orElse(() => 'Invalid' as const),
  );
}
function clientVersion(
  tool: ToolId,
  observation: Observation,
): PreflightReport['versions'][number] {
  const pattern = Match.value(tool).pipe(
    Match.when(
      'Colima',
      () => /^colima version ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\n?$/,
    ),
    Match.when(
      'Docker',
      () =>
        /^Docker version ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)), build [a-f0-9]{1,64}\n?$/,
    ),
    Match.exhaustive,
  );
  const version = pattern.exec(observation.text)?.[1];
  return Match.value({ complete: validObservation(observation, 65536), version }).pipe(
    Match.when({ complete: false }, () => ({ tool, status: 'Truncated' as const })),
    Match.when({ version: Schema.is(ShortVersion) }, (v) => ({
      tool,
      status: 'Available' as const,
      version: v.version,
    })),
    Match.orElse(() => ({ tool, status: 'Invalid' as const })),
  );
}
function emptyConfig(status: PreflightReport['config']['status']): PreflightReport['config'] {
  return { status, mounts: 'Unknown', forwardAgent: 'Unknown', proposedEndpoint: unknown };
}
function addWhen(blockers: Set<Reason>, condition: boolean, reason: Reason) {
  return Match.value(condition).pipe(
    Match.when(true, () => blockers.add(reason)),
    Match.orElse(() => blockers),
  );
}
function insufficientMemory(host: PreflightReport['host'], config: typeof Config.Type) {
  return Match.value({ free: host.freeMemoryBytes, memory: config.memory }).pipe(
    Match.when(
      { free: { _tag: 'Known' }, memory: Schema.is(Positive) },
      (v) => v.memory >= v.free.value / 1073741824,
    ),
    Match.orElse(() => false),
  );
}
function insufficientCpu(host: PreflightReport['host'], config: typeof Config.Type) {
  return Match.value({ cpu: host.cpuCount, allocation: config.cpu }).pipe(
    Match.when(
      { cpu: { _tag: 'Known' }, allocation: Schema.is(Positive) },
      (v) => v.allocation >= v.cpu.value,
    ),
    Match.orElse(() => false),
  );
}
function safeConfig(
  config: typeof Config.Type,
  request: InspectRequest,
  host: PreflightReport['host'],
  blockers: Set<Reason>,
): PreflightReport['config'] {
  const incomplete =
    (config.mounts?.length ?? 0) === 0 ||
    [config.forwardAgent, config.runtime].some((v) => v === undefined);
  const unsafe = [
    (config.mounts?.length ?? 0) > 0,
    config.forwardAgent === true,
    config.autoActivate === true,
  ].some(Boolean);
  addWhen(blockers, incomplete, 'UnknownConfiguration');
  addWhen(blockers, unsafe, 'UnsafeConfiguration');
  addWhen(blockers, insufficientMemory(host, config), 'LimitExceeded');
  addWhen(blockers, insufficientCpu(host, config), 'LimitExceeded');
  const mounts = Match.value(config.mounts).pipe(
    Match.when(undefined, () => 'Unknown' as const),
    Match.when(
      (m) => m.length === 0,
      () => 'Unknown' as const,
    ),
    Match.orElse(() => 'Enabled' as const),
  );
  const forwardAgent = Match.value(config.forwardAgent).pipe(
    Match.when(false, () => 'Disabled' as const),
    Match.when(true, () => 'Enabled' as const),
    Match.orElse(() => 'Unknown' as const),
  );
  const proposedEndpoint = Match.value(config.runtime).pipe(
    Match.when('docker', () => ({
      _tag: 'Proposed' as const,
      endpoint: `unix://${request.colimaRoot}/ceirean/docker.sock`,
    })),
    Match.orElse(() => unknown),
  );
  return { status: 'Read', mounts, forwardAgent, proposedEndpoint };
}
function projectConfig(
  value: unknown,
  request: InspectRequest,
  host: PreflightReport['host'],
  blockers: Set<Reason>,
) {
  function invalid() {
    blockers.add('InvalidConfiguration');
    return emptyConfig('Invalid');
  }
  function unsupported() {
    blockers.add('UnknownConfiguration');
    return emptyConfig('Unsupported');
  }
  function decode(value: Record<string, unknown>): PreflightReport['config'] {
    const decoded = Schema.decodeUnknownResult(Config)(value, strict);
    const projected = Result.match(decoded, {
      onFailure: invalid,
      onSuccess: (config) => safeConfig(config, request, host, blockers),
    });
    return Match.value(Object.keys(value).some((key) => !allowed.has(key))).pipe(
      Match.when(true, unsupported),
      Match.orElse(() => projected),
    );
  }
  const object = Schema.decodeUnknownResult(ObjectFields)(value);
  return Result.match(object, { onFailure: invalid, onSuccess: decode });
}
function compact(text: string) {
  return text.replace(/\s+/g, '');
}
function roundTrips(value: unknown, text: string) {
  // Bun overwrites duplicate keys. Structured round-trip equality rejects those
  // and other noncanonical syntax rather than trusting the overwritten object.
  return compact(YAML.stringify(value, null, 2)) === compact(text);
}
function* parseConfig(
  value: Observation,
  request: InspectRequest,
  host: PreflightReport['host'],
  blockers: Set<Reason>,
) {
  function parse() {
    const parsed = YAML.parse(value.text);
    const canonical = roundTrips(parsed, value.text);
    return { parsed, canonical };
  }
  const parsed = Effect.try({
    try: parse,
    catch: () => ({ _tag: 'InvalidYaml' as const }),
  });
  const result = yield* parsed.pipe(Effect.result);
  const projected = Result.match(result, {
    onFailure: () => emptyConfig('Invalid'),
    onSuccess: (value) => projectConfig(value.parsed, request, host, blockers),
  });
  const canonical = Result.match(result, {
    onFailure: () => false,
    onSuccess: (value) => value.canonical,
  });
  addWhen(blockers, !canonical, 'UnknownConfiguration');
  return Match.value(canonical).pipe(
    Match.when(false, () => emptyConfig('Unsupported')),
    Match.orElse(() => projected),
  );
}
function* readConfig(
  reader: Reader,
  request: InspectRequest,
  host: PreflightReport['host'],
  blockers: Set<Reason>,
) {
  const observed = yield* reader.readRegular('ColimaConfig').pipe(Effect.result);
  function unreadable(error: HostReadError) {
    blockers.add('PrerequisiteUnavailable');
    addWhen(blockers, error.truncated, 'OutputTruncated');
    addWhen(blockers, isTimedOut({ status: versionStatus(error) }), 'TimedOut');
    return { text: '', bytes: new Uint8Array(), truncated: false as const, observedAtMs: 0 };
  }
  const value = Result.getOrElse(observed, unreadable);
  const indirect = /(?:^|[\s[{,])(?:[&*!]|<<:)/m.test(value.text);
  const accepted = [Result.isSuccess(observed), validObservation(value, 262144), !indirect].every(
    Boolean,
  );
  const parsing = Effect.gen(() => parseConfig(value, request, host, blockers));
  const shouldParse = Effect.sync(() => accepted);
  const parsed = yield* parsing.pipe(Effect.when(shouldParse));
  addWhen(blockers, indirect, 'UnknownConfiguration');
  addWhen(blockers, !validObservation(value, 262144), 'OutputTruncated');
  const projected = Option.getOrElse(parsed, () => emptyConfig('Unsupported'));
  return Match.value(Result.isSuccess(observed)).pipe(
    Match.when(false, () => emptyConfig('Unreadable')),
    Match.orElse(() => projected),
  );
}
function* inspect(reader: Reader, input: InspectRequest) {
  const request = { ...input };
  const blockers = new Set<Reason>(['CheckBlocked', 'MissingEvidence', 'ActivationUnresolved']);
  const host = hostSnapshot(request.host);
  addWhen(blockers, Object.values(host).some(isUnknown), 'PrerequisiteUnavailable');
  const versions: Array<PreflightReport['versions'][number]> = [];
  const accepted = acceptedRequest(request);
  const shouldRead = Effect.sync(() => accepted);
  for (const tool of ['Colima', 'Docker'] as const) {
    const program = Effect.suspend(() => reader.runVersion(tool));
    const reading = program.pipe(Effect.result);
    const observed = yield* reading.pipe(Effect.when(shouldRead));
    function projectVersion(result: Result.Result<Observation, HostReadError>) {
      return Result.match(result, {
        onFailure: (error) => ({ tool, status: versionStatus(error) }),
        onSuccess: (value) => clientVersion(tool, value),
      });
    }
    const version = Option.match(observed, {
      onNone: () => ({ tool, status: 'Invalid' as const }),
      onSome: projectVersion,
    });
    addWhen(blockers, !isAvailable(version), 'PrerequisiteUnavailable');
    addWhen(blockers, isTimedOut(version), 'TimedOut');
    addWhen(blockers, isTruncated(version), 'OutputTruncated');
    versions.push(version);
  }
  const reading = Effect.gen(() => readConfig(reader, request, host, blockers));
  const observed = yield* reading.pipe(Effect.when(shouldRead));
  const config = Option.getOrElse(observed, () => emptyConfig('Unsupported'));
  addWhen(blockers, !accepted, 'InvalidConfiguration');
  const report: PreflightReport = {
    _tag: 'PreflightReport',
    profile: 'ceirean',
    canExecuteReplay: false,
    nativeReadiness: 'Unqualified',
    host,
    versions,
    config,
    blockers: [...blockers],
    activationDraft: {
      _tag: 'Unresolved',
      missing: [
        'Image',
        'DaemonIdentity',
        'Commands',
        'Security',
        'Storage',
        'Network',
        'VmAllocation',
        'Budgets',
        'Cleanup',
        'Approval',
      ],
    },
  };
  return report;
}
/** Trusted composition must bind request and reader to the same approved root,
 * review client-only version semantics, and supply measured host data or omit it.
 * No platform services are provided here; version text never proves daemon safety.
 */
export function inspectHost(reader: Reader, request: InspectRequest) {
  const program = Effect.gen(() => inspect(reader, request));
  return program;
}
