import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { ROLES, type Role } from '../src/app/core/models/domain.models';
import type { ServerConfig } from './config';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 64;

/** `scrypt$N$r$p$salt$hash`, all base64url. No plain or reversible passwords are ever stored. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The role in a token is informational: every request reloads the account, so role changes apply at once. */
export interface TokenClaims {
  readonly sub: string;
  readonly role: Role;
}

export async function issueToken(config: ServerConfig, claims: TokenClaims): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + config.tokenTtlHours * 3_600_000;
  const token = await new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('aon')
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(config.jwtSecret);
  return { token, expiresAt };
}

export async function readToken(config: ServerConfig, token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, { issuer: 'aon', algorithms: ['HS256'] });
    const role = payload['role'];
    if (typeof payload.sub !== 'string' || typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) return null;
    return { sub: payload.sub, role: role as Role };
  } catch {
    return null;
  }
}

/** Short-lived signature for photo URLs served by the local file store (an <img> cannot send headers). */
export async function signFileKey(config: ServerConfig, key: string, ttlSeconds: number): Promise<string> {
  return new SignJWT({ key })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('aon-file')
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(config.jwtSecret);
}

export async function readFileKey(config: ServerConfig, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, { issuer: 'aon-file', algorithms: ['HS256'] });
    return typeof payload['key'] === 'string' ? payload['key'] : null;
  } catch {
    return null;
  }
}

/**
 * Slows down password guessing: at most 10 failed logins per username and per address in 15 minutes.
 * In-memory, so it is per instance; enough to blunt casual guessing on a small crew app.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();
  private static readonly WINDOW_MS = 15 * 60_000;
  private static readonly LIMIT = 10;

  blocked(keys: readonly string[]): boolean {
    const now = Date.now();
    return keys.some((k) => (this.failures.get(k) ?? []).filter((t) => now - t < LoginThrottle.WINDOW_MS).length >= LoginThrottle.LIMIT);
  }

  fail(keys: readonly string[]): void {
    const now = Date.now();
    for (const k of keys) {
      const list = (this.failures.get(k) ?? []).filter((t) => now - t < LoginThrottle.WINDOW_MS);
      list.push(now);
      this.failures.set(k, list);
    }
  }

  clear(keys: readonly string[]): void {
    for (const k of keys) this.failures.delete(k);
  }
}
