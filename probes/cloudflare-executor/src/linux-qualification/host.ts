import { Effect } from 'effect';

import { CacheMetadata, makeCacheMetadata } from './cache.ts';
import type { QualificationRequest } from './contract.ts';
import { QualificationAuthority, runQualification } from './controller.ts';
import { DockerProcess, makeDockerProcess, requireSupervisor } from './docker-process.ts';
import { DockerSession, makeDockerSession } from './docker-session.ts';
import { QualificationOutput, makeQualificationOutput } from './durable-output.ts';
import {
  LinuxInputHost,
  LinuxInputs,
  makeLinuxInputHost,
  makeLinuxInputs,
  ReviewedInputContext,
} from './inputs.ts';

// Library-only owning boundary. The ordinary CLI has no reviewed provider and
// never calls this factory. Context, authority and tool locations are trusted
// in-process dependencies, not worksheet JSON interpreted as run permission.
export function makeQualificationHost(
  reviewed: typeof ReviewedInputContext.Type,
  locations: {
    checkout: string;
    capsule: string;
    dockerExecutable: '/usr/bin/docker' | '/usr/local/bin/docker';
  },
  authority: typeof QualificationAuthority.Service,
) {
  function* make() {
    const host = yield* makeLinuxInputHost();
    const inputs = yield* makeLinuxInputs(reviewed, locations).pipe(
      Effect.provideService(LinuxInputHost, host),
    );
    function prepareLinuxInputs(request: QualificationRequest) {
      function* prepare() {
        const prepared = yield* inputs.prepareLinuxInputs(request);
        yield* requireSupervisor(
          prepared.readbacks.docker.path === locations.dockerExecutable,
          'InputChanged',
        );
        return prepared;
      }
      const workflow = Effect.gen(prepare);
      return workflow;
    }
    function run(request: QualificationRequest) {
      const workflow = runQualification(request);
      const provided = workflow.pipe(
        Effect.provideService(QualificationAuthority, authority),
        Effect.provideService(LinuxInputs, { ...inputs, prepareLinuxInputs }),
        Effect.provideService(DockerProcess, makeDockerProcess(locations.dockerExecutable)),
        Effect.provideService(DockerSession, makeDockerSession(locations.dockerExecutable)),
        Effect.provideService(CacheMetadata, makeCacheMetadata()),
        Effect.provideService(QualificationOutput, makeQualificationOutput(locations.checkout)),
      );
      return provided;
    }
    return { run };
  }
  const workflow = Effect.gen(make);
  return workflow;
}
