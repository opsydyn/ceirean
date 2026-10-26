import { Effect, FileSystem, Match, Option, Schema } from 'effect';

import { CacheMetadata } from './cache.ts';
import {
  CaseObservation,
  ControlReadbacks,
  CleanupObservation,
  QualificationAdmission,
  evidenceRequirements,
  requiredCases,
  strict,
} from './contract.ts';
import { requireSupervisor } from './docker-process.ts';
import type { PreparedInputs } from './prepared-inputs.ts';

const sameObservation = Schema.toEquivalence(CaseObservation);
const sameCleanup = Schema.toEquivalence(CleanupObservation);
const sameSource = Schema.toEquivalence(QualificationAdmission.fields.source);
const sameReadbacks = Schema.toEquivalence(ControlReadbacks);
const isHostCase = Schema.is(Schema.Literal('CancellationDeadline'));
const isRemoved = Schema.is(Schema.Literal('ConfirmedRemoval'));
const isFile = Schema.is(Schema.Literal('File'));
const CaseFile = Schema.Struct({
  caseId: CaseObservation.fields.caseId,
  checks: Schema.Array(Schema.String),
  observation: CaseObservation,
  details: Schema.Unknown,
});
const Diagnostic = Schema.Struct({
  _tag: Schema.Literal('PendingHostFinalization'),
  activation: Schema.Literal('Blocked'),
  exitCode: Schema.Literal(0),
  observations: Schema.Array(CaseObservation),
  seedAdmission: QualificationAdmission.fields.seed,
  qualificationReceipt: Schema.Literal('NotProduced'),
});
const decodeDiagnostic = Schema.decodeUnknownEffect(Schema.fromJsonString(Diagnostic), strict);
const decodeCaseFile = Schema.decodeUnknownEffect(Schema.fromJsonString(CaseFile), strict);
const CleanupFile = Schema.Struct({ observation: CleanupObservation });
const decodeCleanupFile = Schema.decodeUnknownEffect(Schema.fromJsonString(CleanupFile), strict);
export const evidenceNames = [
  ...Object.values(evidenceRequirements).map((item) => item.name),
  'worker-diagnostic.json',
  'cleanup.json',
] as const;
async function digest(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function hashEvidence(bytes: Uint8Array) {
  const hashing = Effect.tryPromise(() => digest(bytes));
  return hashing;
}
// The optional seal is in-process trusted boundary output, never the diagnostic's
// seedAdmission field. Absence cannot be repaired by JSON claiming provenance.
export function admitEvidenceFiles(
  inputs: PreparedInputs,
  root: string,
  cleanup: CleanupObservation,
  seal?: QualificationAdmission['seed'],
) {
  function* admit() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    yield* requireSupervisor((yield* fs.realPath(root)) === root);
    let used = 0;
    const deliveryFiles: {
      name: (typeof evidenceNames)[number];
      byteLength: number;
      sha256: string;
      identity: { dev: bigint; ino: bigint; mode: number };
    }[] = [];
    function read(name: (typeof evidenceNames)[number]) {
      function* readFile() {
        const path = `${root}/${name}`;
        const before = yield* metadata.lstat(path);
        const regularBoundedFile = [
          isFile(before.type),
          before.nlink === 1n,
          before.size > 0n,
          before.size <= BigInt(16777216 - used),
        ].every(Boolean);
        yield* requireSupervisor(regularBoundedFile);
        const handle = yield* fs.open(path, { flag: 'r', noFollow: true });
        const opened = yield* handle.stat;
        const sameFile = [opened.dev === before.dev, Option.contains(before.ino)(opened.ino)].every(
          Boolean,
        );
        yield* requireSupervisor(sameFile);
        const chunks: Uint8Array[] = [];
        let size = 0;
        function* append(chunk: Uint8Array) {
          yield* requireSupervisor(chunk.length <= 16777216 - used);
          used += chunk.length;
          size += chunk.length;
          chunks.push(new Uint8Array(chunk));
        }
        let part = yield* handle.readAlloc(65536);
        while (Option.isSome(part)) {
          const chunk = part.value;
          yield* Effect.gen(() => append(chunk));
          part = yield* handle.readAlloc(65536);
        }
        const after = yield* metadata.lstat(path);
        const unchanged = [
          before.dev === after.dev,
          before.ino === after.ino,
          before.mode === after.mode,
          before.size === after.size,
          isFile(after.type),
          after.nlink === 1n,
          BigInt(size) === after.size,
        ].every(Boolean);
        yield* requireSupervisor(unchanged);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const text = yield* Effect.try(() =>
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        );
        const sha256 = yield* hashEvidence(bytes);
        deliveryFiles.push({
          name,
          byteLength: size,
          sha256,
          identity: { dev: before.dev, ino: before.ino, mode: before.mode },
        });
        return { text, byteLength: size, sha256 };
      }
      const reading = Effect.gen(readFile);
      return reading;
    }
    const diagnosticFile = yield* read('worker-diagnostic.json');
    const diagnostic = yield* decodeDiagnostic(diagnosticFile.text);
    const producerIds = diagnostic.observations.map((item) => item.caseId);
    const producerComplete = [
      producerIds.length === 9,
      requiredCases.slice(0, 9).every((id, index) => producerIds[index] === id),
    ].every(Boolean);
    yield* requireSupervisor(producerComplete);
    const trustedSeal = yield* Schema.decodeUnknownEffect(
      QualificationAdmission.fields.seed,
      strict,
    )(seal);
    const sealCoherent = [
      trustedSeal.sha256 === diagnostic.seedAdmission.sha256,
      trustedSeal.sourceSha256 === inputs.admission.source.sha256,
      trustedSeal.sourceSha256 === diagnostic.seedAdmission.sourceSha256,
    ].every(Boolean);
    yield* requireSupervisor(sealCoherent, 'InputChanged');
    yield* requireSupervisor(
      sameSource(inputs.admission.source, {
        ...inputs.admission.source,
        sha256: inputs.source.sha256,
      }),
      'InputChanged',
    );
    const files = [];
    const observations: CaseObservation[] = [];
    for (const caseId of requiredCases) {
      const required = evidenceRequirements[caseId];
      const actual = yield* read(required.name);
      const data = yield* decodeCaseFile(actual.text);
      const expected = diagnostic.observations.filter((item) => item.caseId === caseId);
      const hostCoherent = [
        isRemoved(cleanup._tag),
        sameReadbacks(data.observation.readbacks, diagnostic.observations[0]!.readbacks),
      ].every(Boolean);
      const producerCoherent = [
        expected.length === 1,
        expected.every((item) => sameObservation(data.observation, item)),
      ].every(Boolean);
      const coherentObservation = Match.value(isHostCase(caseId)).pipe(
        Match.when(true, () => hostCoherent),
        Match.orElse(() => producerCoherent),
      );
      const contentCoherent = [
        data.caseId === caseId,
        coherentObservation,
        data.checks.length === required.checks.length,
        new Set(data.checks).size === data.checks.length,
        required.checks.every((check) => data.checks.includes(check)),
      ].every(Boolean);
      yield* requireSupervisor(contentCoherent);
      observations.push(data.observation);
      files.push({
        _tag: 'Admitted' as const,
        caseId,
        name: required.name,
        byteLength: actual.byteLength,
        sha256: actual.sha256,
        truncated: false,
        integrity: 'Verified' as const,
        checks: data.checks,
        observation: data.observation,
      });
    }
    const cleanupFile = yield* read('cleanup.json');
    const cleanupData = yield* decodeCleanupFile(cleanupFile.text);
    yield* requireSupervisor(sameCleanup(cleanupData.observation, cleanup));
    const admission = yield* Schema.decodeUnknownEffect(
      QualificationAdmission,
      strict,
    )({
      request: inputs.admission.request,
      source: inputs.admission.source,
      seed: trustedSeal,
      evidence: {
        provenance: 'BoundedActualFileAdmission',
        cases: files,
        cleanup: {
          _tag: 'Admitted',
          name: 'cleanup.json',
          byteLength: cleanupFile.byteLength,
          sha256: cleanupFile.sha256,
          truncated: false,
          integrity: 'Verified',
          observation: cleanup,
        },
      },
    });
    return { admission, observations, totalBytes: used, deliveryFiles };
  }
  const workflow = Effect.gen(admit);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
