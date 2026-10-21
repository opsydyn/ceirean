import { AdmissionReply, type NonAdmittedDecision, type VerifiedCommand } from '@ceirean/domain';
import { makeVerifiedGitHubIngress, type CapturedBody } from '@ceirean/github-adapter/protocol';
import { Match, Schema } from 'effect';

function decisionResponse(decision: NonAdmittedDecision) {
  const status = Match.value(decision.reason).pipe(
    Match.when('FieldTooLarge', () => 413),
    Match.when('MalformedInput', () => 400),
    Match.whenOr(
      'DeliveryConflict',
      'CommandConflict',
      'AuthorityChanged',
      'CapacityExceeded',
      () => 409,
    ),
    Match.orElse(() => 200),
  );
  return Response.json({ _tag: 'Unrecorded', decision }, { status });
}

export function makeGitHubIngress(config: {
  readonly secret: string;
  readonly ingressScopeId: string;
  readonly capture: (request: Request) => Promise<CapturedBody>;
  readonly admit: (command: VerifiedCommand) => Promise<AdmissionReply>;
}) {
  const { secret, ingressScopeId, capture, admit } = config;
  async function onVerified(command: VerifiedCommand) {
    const reply = Schema.decodeUnknownSync(AdmissionReply)(await admit(command));
    return Match.value(reply).pipe(
      Match.tag('Unrecorded', ({ decision }) => decisionResponse(decision)),
      Match.orElse((recorded) => Response.json(recorded)),
    );
  }
  return makeVerifiedGitHubIngress({ secret, ingressScopeId, capture, onVerified });
}
