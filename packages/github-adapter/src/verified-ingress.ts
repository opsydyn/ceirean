import { createGitHubChannel } from '@flue/github';
import {
  DeliveryId,
  IngressScopeId,
  type VerifiedCommand,
  type NonAdmittedDecision,
} from '@leviathan/domain';
import { Match, Option, Result, Schema } from 'effect';

import { normaliseGitHubDelivery } from './github-payload.ts';
import { RequestBodyError, type CapturedBody } from './request-body.ts';

export const IngressFailure = Schema.TaggedStruct('IngressFailure', {
  code: Schema.Literals([
    'MalformedInput',
    'InvalidSignature',
    'TooLarge',
    'FieldTooLarge',
    'UnsupportedMediaType',
    'Aborted',
    'ReadFailed',
    'DigestFailed',
    'OperationalFailure',
    'Disposed',
  ]),
});
function failure(status: number, code: (typeof IngressFailure.Type)['code']) {
  return Response.json(IngressFailure.make({ _tag: 'IngressFailure', code }), { status });
}
function decisionResponse(decision: NonAdmittedDecision) {
  const status = Match.value(decision.reason).pipe(
    Match.when('FieldTooLarge', () => 413),
    Match.when('MalformedInput', () => 400),
    Match.orElse(() => 200),
  );
  return Response.json({ _tag: 'Unrecorded', decision }, { status });
}
function operationalFailure() {
  return failure(503, 'OperationalFailure');
}
function bodyFailure({ code }: RequestBodyError) {
  const status = Match.value(code).pipe(
    Match.when('TooLarge', () => 413),
    Match.when('DigestFailed', () => 503),
    Match.orElse(() => 400),
  );
  return failure(status, code);
}
function captureFailure(error: unknown) {
  const knownError = Match.instanceOf(RequestBodyError);
  return Match.value(error).pipe(
    Match.when(knownError, bodyFailure),
    Match.orElse(operationalFailure),
  );
}
function preflight(request: Request, ingressScopeId: string) {
  const length = request.headers.get('content-length');
  const media = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const metadataSchema = Schema.Struct({
    scope: IngressScopeId,
    delivery: DeliveryId,
    event: DeliveryId,
  });
  const metadata = Schema.decodeUnknownResult(metadataSchema)({
    scope: ingressScopeId,
    delivery: request.headers.get('x-github-delivery'),
    event: request.headers.get('x-github-event'),
  });
  const oversizedMetadata = ['x-github-delivery', 'x-github-event'].some(
    (header) => new TextEncoder().encode(request.headers.get(header) ?? '').length > 128,
  );
  const correctPath = Schema.is(Schema.Literal('/webhook'));
  const correctMethod = Schema.is(Schema.Literal('POST'));
  const correctMedia = Schema.is(Schema.Literal('application/json'));
  return Match.value(true).pipe(
    Match.when(
      () => request.signal.aborted,
      () => Option.some(failure(400, 'Aborted')),
    ),
    Match.when(
      () => !correctPath(new URL(request.url).pathname) || !correctMethod(request.method),
      () => Option.some(failure(400, 'MalformedInput')),
    ),
    Match.when(
      () => !correctMedia(media),
      () => Option.some(failure(415, 'UnsupportedMediaType')),
    ),
    Match.when(
      () => length !== null && !/^\d+$/.test(length),
      () => Option.some(failure(400, 'MalformedInput')),
    ),
    Match.when(
      () => length !== null && Number(length) > 65536,
      () => Option.some(failure(413, 'TooLarge')),
    ),
    Match.when(
      () => oversizedMetadata,
      () => Option.some(failure(413, 'FieldTooLarge')),
    ),
    Match.when(
      () => Result.isFailure(metadata),
      () => Option.some(failure(400, 'MalformedInput')),
    ),
    Match.orElse(() => Option.none<Response>()),
  );
}
function validUtf8(bytes: Uint8Array) {
  return Result.try({
    try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    catch: () => undefined,
  });
}
export function makeVerifiedGitHubIngress(config: {
  readonly secret: string;
  readonly ingressScopeId: string;
  readonly capture: (request: Request) => Promise<CapturedBody>;
  readonly onVerified: (command: VerifiedCommand) => Promise<Response>;
}) {
  const { secret, ingressScopeId, capture, onVerified } = config;
  async function verified(request: Request, captured: CapturedBody) {
    // The SDK channel and digest closure belong to this request, not the application.
    let applicationResponse = Option.none<Response>();
    async function callback(eventName: string, payload: unknown, deliveryId: string) {
      function normalize() {
        const normalized = normaliseGitHubDelivery({
          eventName,
          payload,
          receipt: {
            ingressScopeId,
            deliveryId,
            eventName: 'issue_comment',
            rawBodyDigest: captured.digest,
          },
        });
        return Result.match(normalized, { onFailure: decisionResponse, onSuccess: onVerified });
      }
      return Match.value(true).pipe(
        Match.when(
          () => request.signal.aborted,
          () => failure(400, 'Aborted'),
        ),
        Match.when(
          () => Result.isFailure(validUtf8(captured.bytes)),
          () => failure(400, 'MalformedInput'),
        ),
        Match.orElse(normalize),
      );
    }
    const channel = createGitHubChannel({
      webhookSecret: secret,
      bodyLimit: 65536,
      webhook: async ({ delivery }) => {
        const response = await callback(delivery.name, delivery.payload, delivery.deliveryId).catch(
          operationalFailure,
        );
        applicationResponse = Option.some(response);
        return response;
      },
    });
    const local = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: new Uint8Array(captured.bytes),
    });
    const router = channel.route();
    router.onError(operationalFailure);
    const sdkResponse = await router.fetch(local);
    function pingOutcome() {
      return Result.match(validUtf8(captured.bytes), {
        onFailure: () => failure(400, 'MalformedInput'),
        onSuccess: () => decisionResponse({ _tag: 'Ignored', reason: 'UnsupportedEvent' }),
      });
    }
    function sdkOutcome() {
      return Match.value(sdkResponse.status).pipe(
        Match.when(200, pingOutcome),
        Match.when(401, () => failure(401, 'InvalidSignature')),
        Match.whenOr(400, 413, 415, (status) => failure(status, 'MalformedInput')),
        Match.orElse(operationalFailure),
      );
    }
    return Option.match(applicationResponse, {
      onSome: (response) => response,
      onNone: sdkOutcome,
    });
  }
  async function fetch(request: Request): Promise<Response> {
    const early = preflight(request, ingressScopeId);
    return Option.match(early, {
      onSome: (response) => response,
      onNone: () =>
        capture(request)
          .then((captured) => verified(request, captured))
          .catch(captureFailure),
    });
  }
  return { fetch };
}

export { captureRequestBody, RequestBodyError, type CapturedBody } from './request-body.ts';
export { normaliseGitHubDelivery } from './github-payload.ts';
