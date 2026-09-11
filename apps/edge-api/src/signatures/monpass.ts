const textEncoder = new TextEncoder();

type DerElement = { tag: number; start: number; valueStart: number; end: number };
type MonpassResponse = {
  certificate: string;
  signature: string;
  status: string;
  tobesigned: string;
};

export type CryptographicallyVerifiedMonpassSignature = {
  provider: "monpass";
  signerCertificate: string;
  signatureValue: string;
  signatureAlgorithm: "SHA256withRSA";
  signedAt: string;
  validationEvidence: {
    verification: "cryptographically_verified_pending_ca_validation";
    keyId: string;
    tokenSerialNumber: string;
    providerTimestamp: number;
    certificateSerialNumber: string;
    certificateNotBefore: string;
    certificateNotAfter: string;
    tobesigned: string;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function decodeBase64(value: string, label: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error(`${label} формат буруу байна.`);
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error(`${label} формат буруу байна.`);
  }
}

function readDer(bytes: Uint8Array, start: number): DerElement {
  if (start + 2 > bytes.length) throw new Error("Сертификатын бүтэц буруу байна.");
  const tag = bytes[start]!;
  const firstLength = bytes[start + 1]!;
  let length = 0;
  let valueStart = start + 2;
  if (firstLength < 0x80) length = firstLength;
  else {
    const count = firstLength & 0x7f;
    if (!count || count > 4 || valueStart + count > bytes.length) throw new Error("Сертификатын урт буруу байна.");
    for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[valueStart + index]!;
    valueStart += count;
  }
  const end = valueStart + length;
  if (end > bytes.length) throw new Error("Сертификатын урт буруу байна.");
  return { tag, start, valueStart, end };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function parseAsn1Time(bytes: Uint8Array, element: DerElement): string {
  if (element.tag !== 0x17 && element.tag !== 0x18) throw new Error("Сертификатын хүчинтэй хугацаа буруу байна.");
  const value = String.fromCharCode(...bytes.slice(element.valueStart, element.end));
  const match = (element.tag === 0x17
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/
    : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/).exec(value);
  if (!match) throw new Error("Сертификатын хүчинтэй хугацаа буруу байна.");
  const year = element.tag === 0x17 ? Number(match[1]) + (Number(match[1]) >= 50 ? 1900 : 2000) : Number(match[1]);
  const timestamp = Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? "0"));
  if (!Number.isFinite(timestamp)) throw new Error("Сертификатын хүчинтэй хугацаа буруу байна.");
  return new Date(timestamp).toISOString();
}

function certificateDetails(certificate: Uint8Array) {
  const outer = readDer(certificate, 0);
  if (outer.tag !== 0x30 || outer.end !== certificate.length) throw new Error("X.509 сертификат буруу байна.");
  const tbs = readDer(certificate, outer.valueStart);
  if (tbs.tag !== 0x30) throw new Error("X.509 сертификат буруу байна.");
  let cursor = tbs.valueStart;
  if (readDer(certificate, cursor).tag === 0xa0) cursor = readDer(certificate, cursor).end;
  const serial = readDer(certificate, cursor); cursor = serial.end;
  cursor = readDer(certificate, cursor).end; // certificate signature algorithm
  cursor = readDer(certificate, cursor).end; // issuer
  const validity = readDer(certificate, cursor); cursor = validity.end;
  if (validity.tag !== 0x30) throw new Error("Сертификатын хүчинтэй хугацаа буруу байна.");
  const notBefore = readDer(certificate, validity.valueStart);
  const notAfter = readDer(certificate, notBefore.end);
  cursor = readDer(certificate, cursor).end; // subject
  const subjectPublicKeyInfo = readDer(certificate, cursor);
  if (subjectPublicKeyInfo.tag !== 0x30) throw new Error("Сертификатын нийтийн түлхүүр буруу байна.");
  return {
    serialNumber: hex(certificate.slice(serial.valueStart, serial.end)),
    notBefore: parseAsn1Time(certificate, notBefore),
    notAfter: parseAsn1Time(certificate, notAfter),
    subjectPublicKeyInfo: certificate.slice(subjectPublicKeyInfo.start, subjectPublicKeyInfo.end),
  };
}

/** Verifies the exact Tridum eSign response format supplied by MonPass tokens. */
export async function verifyMonpassSignature(responseValue: unknown, expectedDocumentHash: string): Promise<CryptographicallyVerifiedMonpassSignature> {
  let parsedResponse = responseValue;
  if (typeof responseValue === "string") {
    if (responseValue.length > 131072) throw new Error("eSign-ийн хариу зөвшөөрөгдөх хэмжээнээс хэтэрсэн байна.");
    try { parsedResponse = JSON.parse(responseValue); } catch { throw new Error("eSign-ийн хариу JSON форматтай биш байна."); }
  }
  const response = asRecord(parsedResponse) as Partial<MonpassResponse> | null;
  if (!response || response.status !== "success" || typeof response.certificate !== "string"
    || typeof response.signature !== "string" || typeof response.tobesigned !== "string") {
    throw new Error("eSign-ийн амжилттай гарын үсгийн хариу биш байна.");
  }
  let signedEnvelope: Record<string, unknown> | null = null;
  try { signedEnvelope = asRecord(JSON.parse(response.tobesigned)); } catch { /* Handled below. */ }
  if (!signedEnvelope || signedEnvelope.data !== expectedDocumentHash || typeof signedEnvelope.keyID !== "string"
    || typeof signedEnvelope.sn !== "string" || !/^\d{10,13}$/.test(String(signedEnvelope.timeStamp))) {
    throw new Error("eSign-ийн гарын үсэг зурсан утга гэрчилгээний hash-тэй таарахгүй байна.");
  }
  const providerTimestamp = Number(signedEnvelope.timeStamp);
  if (Math.abs(Date.now() - providerTimestamp * 1000) > 15 * 60 * 1000) {
    throw new Error("eSign-ийн гарын үсгийн хугацаа хэтэрсэн байна. Дахин гарын үсэг зурна уу.");
  }
  const certificate = decodeBase64(response.certificate, "Сертификат");
  const signature = decodeBase64(response.signature, "Гарын үсэг");
  const details = certificateDetails(certificate);
  const now = Date.now();
  if (now < Date.parse(details.notBefore) || now > Date.parse(details.notAfter)) {
    throw new Error("Гарын үсгийн сертификат хүчинтэй хугацаандаа биш байна.");
  }
  const key = await crypto.subtle.importKey("spki", details.subjectPublicKeyInfo, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, textEncoder.encode(response.tobesigned));
  if (!verified) throw new Error("eSign-ийн RSA гарын үсэг баталгаажсангүй.");
  return {
    provider: "monpass", signerCertificate: response.certificate, signatureValue: response.signature,
    signatureAlgorithm: "SHA256withRSA", signedAt: new Date(providerTimestamp * 1000).toISOString(),
    validationEvidence: {
      verification: "cryptographically_verified_pending_ca_validation", keyId: signedEnvelope.keyID,
      tokenSerialNumber: signedEnvelope.sn, providerTimestamp, certificateSerialNumber: details.serialNumber,
      certificateNotBefore: details.notBefore, certificateNotAfter: details.notAfter, tobesigned: response.tobesigned,
    },
  };
}
