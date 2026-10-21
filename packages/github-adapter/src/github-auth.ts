import { GitHubId } from '@ceirean/domain';
import { LiveAuthorityError } from '@ceirean/engine';
import { Result, Schema } from 'effect';
import { importPKCS8, SignJWT } from 'jose';

// GitHub's downloaded PKCS#1 keys must be converted locally by the operator.
export async function importAppSigner(appId: number, privateKey: string) {
  function acquire() {
    Schema.decodeUnknownSync(GitHubId)(appId);
    return importPKCS8(privateKey, 'RS256');
  }
  function signer(key: CryptoKey) {
    return (wallMs: number) =>
      new SignJWT()
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(String(appId))
        .setIssuedAt(Math.floor(wallMs / 1000) - 60)
        .setExpirationTime(Math.floor(wallMs / 1000) + 540)
        .sign(key);
  }
  return Promise.resolve()
    .then(acquire)
    .then(signer)
    .then(Result.succeed, () =>
      Result.fail(new LiveAuthorityError({ phase: 'signing', code: 'InvalidKey' })),
    );
}
