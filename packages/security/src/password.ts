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
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(base64UrlToBytes(salt)),
      iterations,
    },
    keyMaterial,
    KEY_BITS,
  );

  return bytesToBase64Url(new Uint8Array(bits));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
