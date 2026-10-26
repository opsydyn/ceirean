import { Effect, FileSystem, Schema } from 'effect';

import {
  evidenceRequirements,
  requiredCases,
  type CaseObservation,
} from '../src/linux-qualification/contract.ts';
import { LinuxInputs } from '../src/linux-qualification/inputs.ts';
import type { PreparedInputs, ToolDigest } from '../src/linux-qualification/prepared-inputs.ts';
import { inputPins } from '../src/linux-qualification/tool-pins.ts';
import { stage } from './linux-archive-fixtures.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const bytes = (text: string) => new TextEncoder().encode(text);
async function sha(text: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(text)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function ownedFixture() {
  function* make() {
    const fs = yield* FileSystem.FileSystem;
    const inputs = yield* stage([]);
    const sourceBytes = ['owned', 'source\n'].join(' ');
    const source = [
      {
        path: 'fixture.txt',
        mode: '100644' as const,
        objectId: 'a'.repeat(40),
        size: bytes(sourceBytes).length,
        sha256: yield* Effect.promise(() => sha(sourceBytes)),
      },
    ];
    const sourceSha256 = yield* Effect.promise(() => sha(encode(source)));
    const tools: (typeof ToolDigest.Type)[] = [];
    yield* fs.makeDirectory(`${inputs.root}/source`);
    yield* fs.writeFileString(`${inputs.root}/source/fixture.txt`, sourceBytes, { mode: 0o644 });
    yield* fs.makeDirectory(`${inputs.root}/tools`);
    for (const [path, mode, text] of [
      ['node', '100755', 'inert node'],
      ['worker.mjs', '100644', 'inert worker'],
    ] as const) {
      yield* fs.writeFileString(`${inputs.root}/tools/${path}`, text, {
        mode: Number.parseInt(mode, 8),
      });
      tools.push({
        path,
        mode,
        size: bytes(text).length,
        sha256: yield* Effect.promise(() => sha(text)),
      });
    }
    const toolSha256 = yield* Effect.promise(() => sha(encode(tools)));
    const prepared = {
      ...inputs,
      admission: {
        request: {
          ...inputs.admission.request,
          harnessSha256: tools[1]!.sha256,
          toolCapsuleSha256: toolSha256,
        },
        source: { ...inputs.admission.source, sha256: sourceSha256 },
      },
      source: { files: source, sha256: sourceSha256 },
      tools: { ...inputs.tools, files: tools, sha256: toolSha256 },
    };
    const unexpected = Effect.die(new Error('Unexpected acquisition'));
    const boundary: typeof LinuxInputs.Service = {
      prepareLinuxInputs: () => Effect.succeed(structuredClone(prepared)),
      admitSource: () => unexpected,
      discoverTools: () => unexpected,
      validateToolCapsule: () => unexpected,
      admitTools: () => unexpected,
      stageArtifacts: () => unexpected,
    };
    return { fs, prepared, boundary };
  }
  const workflow = Effect.gen(make);
  return workflow;
}

export function producerDocuments(inputs: PreparedInputs) {
  const sha = 'a'.repeat(64);
  const readbacks = {
    _tag: 'Verified' as const,
    os: 'Linux' as const,
    architecture: 'x86_64' as const,
    libc: 'glibc' as const,
    bun: '1.3.11' as const,
    node: '22.23.4' as const,
    runnerImage: 'synthetic',
    runnerVersion: 'synthetic',
    dockerVersion: 'synthetic',
    installerConfigSha256: sha,
    nodeConfigSha256: inputs.tools.nodeConfigSha256,
    nodeExecutableSha256: inputs.tools.files[0]!.sha256,
    controllerExecutableSha256: sha,
    controls: {
      networkNone: true as const,
      readOnlyRoot: true as const,
      unprivileged: true as const,
      capabilitiesDropped: true as const,
      noNewPrivileges: true as const,
      noExtraDevices: true as const,
      privatePidIpc: true as const,
      noPublishedPorts: true as const,
      noDockerSocket: true as const,
      boundedTmpfs: true as const,
      noexecNosuidNodev: true as const,
      networkDnsTcpDenied: true as const,
      resourceLimitsVerified: true as const,
      runnerEligible: true as const,
    },
  };
  const expected = [
    ['Preflight', 'Verified'],
    ['Admission', 'ArchiveRefused'],
    ['Canaries', 'ScriptsSuppressed'],
    ['Warmup', 'CacheMaterialized'],
    ['Offline', 'InstalledFromCache'],
    ['Offline', 'EmptyCacheRefused'],
    ['Offline', 'MissingArtifactRefused'],
    ['Admission', 'CacheIntegrityRefused'],
    ['Isolation', 'CopiesIsolated'],
  ] as const;
  const digests = {
    _tag: 'Recorded' as const,
    sourceBefore: inputs.source.sha256,
    sourceAfter: inputs.source.sha256,
    lockBefore: inputPins.lockSha256,
    lockAfter: inputPins.lockSha256,
    seedBefore: sha,
    seedAfter: sha,
    harnessSha256: inputs.admission.request.harnessSha256,
    toolCapsuleSha256: inputs.tools.sha256,
  };
  const observations: CaseObservation[] = requiredCases.slice(0, 9).map((caseId, index) => ({
    caseId,
    stage: expected[index]![0],
    reason: expected[index]![1],
    outcome: 'Passed',
    evidence: [evidenceRequirements[caseId].name],
    readbacks,
    digests,
  }));
  const seal = {
    provenance: 'TrustedSealBoundary',
    sourceSha256: inputs.source.sha256,
    sha256: sha,
  };
  const documents: Record<string, string> = {};
  for (const observation of observations)
    documents[observation.evidence[0]!] = encode({
      caseId: observation.caseId,
      checks: evidenceRequirements[observation.caseId].checks,
      observation,
      details: {},
    });
  documents['worker-diagnostic.json'] = encode({
    _tag: 'PendingHostFinalization',
    activation: 'Blocked',
    exitCode: 0,
    observations,
    seedAdmission: seal,
    qualificationReceipt: 'NotProduced',
  });
  return documents;
}
