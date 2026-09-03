import { base64UrlToBytes, bytesToBase64Url } from "./encoding";

const FORMAT_VERSION = "v1";
const IV_LENGTH = 12;

/** Authenticated AES-256-GCM encryption for sensitive database fields. */
export async function encryptField(value: string, encodedKey: string): Promise<string> {
  const key = await importFieldEncryptionKey(encodedKey, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toBufferSource(iv) }, key, toBufferSource(plaintext));
  return `${FORMAT_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptField(value: string, encodedKey: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== FORMAT_VERSION || !encodedIv || !encodedCiphertext) {
    throw new Error("Unsupported encrypted field format.");
  }
  const key = await importFieldEncryptionKey(encodedKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBufferSource(base64UrlToBytes(encodedIv)) },
    key,
    toBufferSource(base64UrlToBytes(encodedCiphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export function isValidFieldEncryptionKey(encodedKey: string | undefined): boolean {
  if (!encodedKey) return false;
  try {
    return base64UrlToBytes(encodedKey).byteLength === 32;
  } catch {
    return false;
  }
}

export function assertFieldEncryptionKey(encodedKey: string | undefined): asserts encodedKey is string {
  if (!isValidFieldEncryptionKey(encodedKey)) {
    throw new Error("FIELD_ENCRYPTION_KEY must be a 32-byte base64url value.");
  }
}

async function importFieldEncryptionKey(encodedKey: string, usages: KeyUsage[]): Promise<CryptoKey> {
  assertFieldEncryptionKey(encodedKey);
  return crypto.subtle.importKey("raw", toBufferSource(base64UrlToBytes(encodedKey)), { name: "AES-GCM" }, false, usages);
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}
