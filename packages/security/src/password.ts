import { pbkdf2 } from "node:crypto";

import {
  base64UrlToBytes,
  bytesToBase64Url,
  randomBase64Url,
  timingSafeEqual,
} from "./encoding";

const ALGORITHM = "pbkdf2_sha256";
const DEFAULT_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export async function hashPassword(password: string): Promise<string> {
  assertAcceptablePassword(password);

  const salt = randomBase64Url(SALT_BYTES);
  const hash = await derivePasswordHash(password, salt, DEFAULT_ITERATIONS);

  return `${ALGORITHM}$${DEFAULT_ITERATIONS}$${salt}$${hash}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;

  const candidateHash = await derivePasswordHash(
    password,
    parsed.salt,
    parsed.iterations,
  );

  return timingSafeEqual(candidateHash, parsed.hash);
}

export function assertAcceptablePassword(password: string): void {
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters long.");
  }

  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("Password must include uppercase, lowercase, and number characters.");
  }
}

function parsePasswordHash(value: string):
  | {
      iterations: number;
      salt: string;
      hash: string;
    }
  | null {
  const [algorithm, iterationsText, salt, hash] = value.split("$");
  const iterations = Number(iterationsText);

  if (algorithm !== ALGORITHM || !Number.isInteger(iterations) || !salt || !hash) {
    return null;
  }

  return { iterations, salt, hash };
}

async function derivePasswordHash(
  password: string,
  salt: string,
  iterations: number,
): Promise<string> {
  // Cloudflare's Node compatibility runtime provides PBKDF2 through OpenSSL.
  // It is compatible with the existing PBKDF2-SHA-256 storage format and avoids
  // Worker-specific SubtleCrypto failures during password verification.
  return new Promise((resolve, reject) => {
    pbkdf2(password, base64UrlToBytes(salt), iterations, KEY_BITS / 8, "sha256", (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(bytesToBase64Url(new Uint8Array(key)));
    });
  });
}
