import { LiveAdmissionReply, NonAdmittedDecision } from '@ceirean/domain';
import { IngressFailure } from '@ceirean/github-adapter/protocol';
import { Match, Result, Schema } from 'effect';

import { publicFailure } from './listener.ts';

const PublicReply = Schema.Struct({
  disposition: Schema.Literals(['Recorded', 'Duplicate', 'Rejected', 'Ignored']),
  correlationId: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/)),
});
function response(disposition: (typeof PublicReply.Type)['disposition'], status = 200) {
  return Response.json(PublicReply.make({ disposition, correlationId: crypto.randomUUID() }), {
    status,
  });
}
function refusal(decision: NonAdmittedDecision) {
  function rejected({ reason }: Extract<NonAdmittedDecision, { _tag: 'Rejected' }>) {
    const status = Match.value(reason).pipe(
      Match.whenOr('DeliveryConflict', 'CommandConflict', () => 409),
      Match.when('MalformedInput', () => 400),
      Match.when('FieldTooLarge', () => 413),
      Match.whenOr(
        'CapacityExceeded',
        'AuthorityUnavailable',
        'AuthorityChanged',
        'InvalidAuthority',
        'InvalidClock',
        () => 503,
      ),
      Match.orElse(() => 200),
    );
    return response('Rejected', status);
  }
  return Match.value(decision).pipe(
    Match.tag('Ignored', () => response('Ignored')),
    Match.tag('Rejected', rejected),
    Match.exhaustive,
  );
}
export function projectReply(reply: LiveAdmissionReply) {
  function recorded({ record }: Extract<LiveAdmissionReply, { _tag: 'Recorded' }>) {
    return Match.value(record.decision).pipe(
      Match.tag('Rejected', refusal),
      Match.tag('AdmittedPreview', () => response('Recorded')),
      Match.exhaustive,
    );
  }
  return Match.value(reply).pipe(
    Match.tag('Recorded', recorded),
    Match.tag('Duplicate', () => response('Duplicate')),
    Match.tag('Unrecorded', ({ decision }) => refusal(decision)),
    Match.exhaustive,
  );
}
const Unrecorded = Schema.TaggedStruct('Unrecorded', { decision: NonAdmittedDecision });
const ProtocolResponse = Schema.Union([Unrecorded, IngressFailure, PublicReply]);
const isUnrecorded = Schema.is(Unrecorded);
const isIngressFailure = Schema.is(IngressFailure);
export async function projectProtocolResponse(input: Response) {
  async function project() {
    const body: unknown = await input.json();
    const decoded = Schema.decodeUnknownResult(ProtocolResponse)(body);
    function outcome(value: Result.Result.Success<typeof decoded>) {
      return Match.value(value).pipe(
        Match.when(isUnrecorded, ({ decision }) => refusal(decision)),
        Match.when(isIngressFailure, ({ code }) => publicFailure(input.status, code)),
        Match.orElse((reply) => Response.json(reply, { status: input.status })),
      );
    }
    return Result.match(decoded, {
      onSuccess: outcome,
      onFailure: () => publicFailure(503, 'OperationalFailure'),
    });
  }
  return project().catch(() => publicFailure(503, 'OperationalFailure'));
}
