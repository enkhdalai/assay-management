import * as asn1js from "asn1js";
import { BasicOCSPResponse, Certificate, CertificateChainValidationEngine, OCSPRequest, OCSPResponse } from "pkijs";

import type { EdgeApiEnv } from "../app";

const MAX_OCSP_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_OCSP_RESPONSE_BYTES = 1024 * 1024;
const OCSP_TIMEOUT_MS = 15_000;

type EsignProvider = "monpass" | "tridum";
type ProviderTrustConfiguration = {
  provider: EsignProvider;
  root: Certificate;
  nationalIssuing: Certificate;
  issuer: Certificate;
  providerChain: Certificate[];
  ocspUrl: string;
};

export class EsignTrustConfigurationError extends Error {
  constructor() {
    super("eSign CA chain тохируулаагүй байна.");
  }
}

export type EsignTrustValidation = {
  provider: EsignProvider;
  certificateChain: string[];
  validationEvidence: {
    provider: EsignProvider;
    trust: "ca_chain_and_ocsp_verified";
    ocspUrl: string;
    ocspCheckedAt: string;
    ocspThisUpdate: string;
    ocspNextUpdate: string | null;
    ocspResponseSha256: string;
    certificatePathLength: number;
  };
};

function base64ToBytes(value: string, label: string): Uint8Array {
  const normalized = value.replace(/\s/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label} Base64 формат буруу байна.`);
  }
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

function normalizePem(value: string): string {
  const trimmed = value.trim();
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  // Cloudflare secrets can preserve one or more layers of escaped newlines,
  // whereas dotenv expands them when it reads a quoted local value.
  return unquoted.replace(/\\+r\\+n/g, "\n").replace(/\\+n/g, "\n").replace(/\\+r/g, "\r");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function pemToCertificate(pem: string, label: string): Certificate {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(normalizePem(pem));
  if (!match) throw new Error(`${label} PEM формат буруу байна.`);
  const parsed = asn1js.fromBER(toArrayBuffer(base64ToBytes(match[1], label)));
  if (parsed.offset === -1) throw new Error(`${label} ASN.1 формат буруу байна.`);
  return new Certificate({ schema: parsed.result });
}

function base64DerToCertificate(value: string, label: string): Certificate {
  const parsed = asn1js.fromBER(toArrayBuffer(base64ToBytes(value, label)));
  if (parsed.offset === -1) throw new Error(`${label} ASN.1 формат буруу байна.`);
  return new Certificate({ schema: parsed.result });
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Base64Url(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toBase64(digest).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function providerConfigurations(env: EdgeApiEnv): { providers: ProviderTrustConfiguration[]; configurationErrors: string[] } {
  const rootPem = env.MONGOLIAN_NATIONAL_ROOT_CA_PEM ?? env.MONPASS_TRUST_ROOT_CA_PEM;
  const nationalIssuingPem = env.MONGOLIAN_NATIONAL_ISSUING_CA_PEM ?? env.MONPASS_TRUST_ISSUING_CA_PEM;
  if (!rootPem || !nationalIssuingPem) throw new EsignTrustConfigurationError();

  const root = pemToCertificate(rootPem, "Үндэсний root CA");
  const nationalIssuing = pemToCertificate(nationalIssuingPem, "Үндэсний issuing CA");
  const providers: ProviderTrustConfiguration[] = [];
  const configurationErrors: string[] = [];
  if (env.MONPASS_TRUST_CLASS2_4_CA_PEM && env.MONPASS_OCSP_URL) {
    try {
      const issuer = pemToCertificate(env.MONPASS_TRUST_CLASS2_4_CA_PEM, "MonPass Class 2-4 CA");
      providers.push({ provider: "monpass", root, nationalIssuing, issuer, providerChain: [issuer], ocspUrl: env.MONPASS_OCSP_URL });
    } catch (error) {
      configurationErrors.push(`monpass: ${error instanceof Error ? error.message : "CA тохиргоо буруу байна."}`);
    }
  }
  if (env.TRIDUM_TRUST_ISSUING_CA_PEM && env.TRIDUM_TRUST_ISSUING_SUB_CA_PEM && env.TRIDUM_OCSP_URL) {
    try {
      const issuing = pemToCertificate(env.TRIDUM_TRUST_ISSUING_CA_PEM, "Tridum issuing CA");
      const issuer = pemToCertificate(env.TRIDUM_TRUST_ISSUING_SUB_CA_PEM, "Tridum sub CA");
      providers.push({ provider: "tridum", root, nationalIssuing, issuer, providerChain: [issuer, issuing], ocspUrl: env.TRIDUM_OCSP_URL });
    } catch (error) {
      configurationErrors.push(`tridum: ${error instanceof Error ? error.message : "CA тохиргоо буруу байна."}`);
    }
  }
  if (!providers.length) {
    if (configurationErrors.length) throw new Error(`eSign CA chain тохиргоо буруу байна. ${configurationErrors.join("; ")}`);
    throw new EsignTrustConfigurationError();
  }
  return { providers, configurationErrors };
}

async function resolveProviderForSigner(signer: Certificate, providers: ProviderTrustConfiguration[], configurationErrors: string[]) {
  const failures: string[] = [];
  for (const config of providers) {
    const chain = new CertificateChainValidationEngine({
      trustedCerts: [config.root],
      certs: [signer, ...config.providerChain, config.nationalIssuing],
      checkDate: new Date(),
    });
    const result = await chain.verify();
    if (result.result) return { config, result };
    failures.push(`${config.provider}: ${result.resultMessage}`);
  }
  throw new Error(`Гарын үсгийн сертификат тохируулсан CA chain-тэй таарахгүй байна. ${[...failures, ...configurationErrors].join("; ")}`);
}

async function postOcspRequest(ocspUrl: string, requestBytes: ArrayBuffer): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCSP_TIMEOUT_MS);
  try {
    const response = await fetch(ocspUrl, {
      method: "POST",
      headers: { "content-type": "application/ocsp-request", accept: "application/ocsp-response" },
      // A TypedArray gives Workers a fixed Content-Length. Tridum's responder
      // accepts the equivalent Node request but rejects chunked Worker bodies.
      body: new Uint8Array(requestBytes),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OCSP хариу алдаатай байна (${response.status}).`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_OCSP_RESPONSE_BYTES) throw new Error("OCSP хариу хэт том байна.");
    const responseBytes = await response.arrayBuffer();
    if (responseBytes.byteLength > MAX_OCSP_RESPONSE_BYTES) throw new Error("OCSP хариу хэт том байна.");
    return responseBytes;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("OCSP сервер хариу өгөх хугацаа хэтэрсэн байна.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buffersEqual(first: ArrayBuffer, second: ArrayBuffer): boolean {
  const firstBytes = new Uint8Array(first);
  const secondBytes = new Uint8Array(second);
  return firstBytes.byteLength === secondBytes.byteLength && firstBytes.every((value, index) => value === secondBytes[index]);
}

async function resolveResponderCertificate(response: BasicOCSPResponse): Promise<Certificate> {
  const responderId = response.tbsResponseData.responderID;
  for (const certificate of response.certs ?? []) {
    if ("isEqual" in responderId && typeof responderId.isEqual === "function" && certificate.subject.isEqual(responderId)) return certificate;
    if ("valueBlock" in responderId) {
      const keyHash = await crypto.subtle.digest("SHA-1", certificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHex);
      if (buffersEqual(keyHash, responderId.valueBlock.valueHex)) return certificate;
    }
  }
  throw new Error("OCSP responder сертификат хариунд олдсонгүй.");
}

function signatureAlgorithm(algorithmId: string): AlgorithmIdentifier {
  switch (algorithmId) {
    case "1.2.840.113549.1.1.5": return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" };
    case "1.2.840.113549.1.1.11": return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    case "1.2.840.113549.1.1.12": return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" };
    case "1.2.840.113549.1.1.13": return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" };
    default: throw new Error(`OCSP гарын үсгийн алгоритм дэмжигдээгүй байна (${algorithmId}).`);
  }
}

async function verifyResponderSignature(response: BasicOCSPResponse, responder: Certificate): Promise<void> {
  const algorithm = signatureAlgorithm(response.signatureAlgorithm.algorithmId);
  const publicKey = await crypto.subtle.importKey("spki", responder.subjectPublicKeyInfo.toSchema().toBER(false), algorithm, false, ["verify"]);
  const valid = await crypto.subtle.verify(algorithm, publicKey, response.signature.valueBlock.valueHex, response.tbsResponseData.tbsView);
  if (!valid) throw new Error("OCSP хариуны гарын үсэг баталгаажсангүй.");
}

function readOcspStatus(response: BasicOCSPResponse, request: OCSPRequest) {
  const requestedCertId = request.tbsRequest.requestList[0]?.reqCert;
  const matchingResponse = response.tbsResponseData.responses.find((item) => requestedCertId != null && item.certID.isEqual(requestedCertId));
  if (!matchingResponse) throw new Error("OCSP сертификатын дэлгэрэнгүй төлөв олдсонгүй.");
  const statusTag = matchingResponse.certStatus.idBlock.tagNumber;
  if (statusTag === 1) throw new Error("Гарын үсгийн сертификат хүчингүй болсон байна.");
  if (statusTag !== 0) throw new Error("Гарын үсгийн сертификатын OCSP төлөв тодорхойгүй байна.");
  return matchingResponse;
}

/** Identifies the provider only from the validated signer CA chain, then verifies its OCSP response. */
export async function verifyEsignCertificateTrust(signerCertificate: string, env: EdgeApiEnv): Promise<EsignTrustValidation> {
  const signer = base64DerToCertificate(signerCertificate, "Гарын үсэг зурсан сертификат");
  const { providers, configurationErrors } = providerConfigurations(env);
  const { config, result: chainResult } = await resolveProviderForSigner(signer, providers, configurationErrors);
  const request = new OCSPRequest();
  await request.createForCertificate(signer, { issuerCertificate: config.issuer, hashAlgorithm: "SHA-1" });
  // A newly created OCSP request has no cached BER state; `true` serializes it.
  const responseBytes = await postOcspRequest(config.ocspUrl, request.toSchema(true).toBER(false));
  const parsedResponse = asn1js.fromBER(responseBytes);
  if (parsedResponse.offset === -1) throw new Error("OCSP хариу ASN.1 формат буруу байна.");
  const ocspResponse = new OCSPResponse({ schema: parsedResponse.result });
  if (ocspResponse.responseStatus.valueBlock.valueDec !== 0 || !ocspResponse.responseBytes) throw new Error("OCSP сертификатын төлөв буцаасангүй.");
  const parsedBasic = asn1js.fromBER(ocspResponse.responseBytes.response.valueBlock.valueHex);
  if (parsedBasic.offset === -1) throw new Error("OCSP гарын үсгийн бүтэц буруу байна.");
  const basicResponse = new BasicOCSPResponse({ schema: parsedBasic.result });
  const responder = await resolveResponderCertificate(basicResponse);
  const responderChain = new CertificateChainValidationEngine({
    trustedCerts: [config.root],
    certs: [responder, ...config.providerChain, config.nationalIssuing],
    checkDate: new Date(),
  });
  const responderChainResult = await responderChain.verify();
  if (!responderChainResult.result) throw new Error(`OCSP responder CA chain баталгаажсангүй: ${responderChainResult.resultMessage}`);
  await verifyResponderSignature(basicResponse, responder);
  const matchingResponse = readOcspStatus(basicResponse, request);
  const thisUpdate = matchingResponse.thisUpdate;
  const nextUpdate = matchingResponse.nextUpdate ?? null;
  const now = Date.now();
  if (thisUpdate.getTime() > now + 5 * 60 * 1000 || thisUpdate.getTime() < now - MAX_OCSP_AGE_MS || (nextUpdate && nextUpdate.getTime() < now)) {
    throw new Error("OCSP хариу хуучирсан байна.");
  }
  return {
    provider: config.provider,
    certificateChain: [
      signerCertificate,
      ...config.providerChain.map((certificate) => toBase64(certificate.toSchema().toBER(false))),
      toBase64(config.nationalIssuing.toSchema().toBER(false)),
      toBase64(config.root.toSchema().toBER(false)),
    ],
    validationEvidence: {
      provider: config.provider,
      trust: "ca_chain_and_ocsp_verified",
      ocspUrl: config.ocspUrl,
      ocspCheckedAt: new Date().toISOString(),
      ocspThisUpdate: thisUpdate.toISOString(),
      ocspNextUpdate: nextUpdate?.toISOString() ?? null,
      ocspResponseSha256: await sha256Base64Url(responseBytes),
      certificatePathLength: chainResult.certificatePath?.length ?? 0,
    },
  };
}
