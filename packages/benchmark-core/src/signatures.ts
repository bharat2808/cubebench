import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return (
    '{' +
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v))
      .join(',') +
    '}'
  );
}
export const digest = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export class ResultSigner {
  readonly privateKey: KeyObject;
  readonly publicKey: string;
  readonly keyId: string;
  constructor(path?: string) {
    if (path && existsSync(path)) {
      this.privateKey = createPrivateKey(readFileSync(path));
    } else {
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
      if (path) {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, this.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
          mode: 0o600,
          flag: 'wx',
        });
      }
    }
    this.publicKey = createPublicKey(this.privateKey)
      .export({ format: 'pem', type: 'spki' })
      .toString();
    this.keyId = digest(this.publicKey).slice(0, 16);
  }
  sign(value: unknown) {
    return sign(null, Buffer.from(canonicalJson(value)), this.privateKey).toString('base64url');
  }
  verify(value: unknown, signature: string) {
    try {
      return verify(
        null,
        Buffer.from(canonicalJson(value)),
        this.publicKey,
        Buffer.from(signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }
}
