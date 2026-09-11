import * as asn1js from "asn1js";
import {
  BasicOCSPResponse,
  Certificate,
  CertificateChainValidationEngine,
  OCSPRequest,
  OCSPResponse,
} from "pkijs";

import type { EdgeApiEnv } from "../app";

const MAX_OCSP_AGE_MS = 24 * 60 * 60 * 1000;

export class MonpassTrustConfigurationError extends Error {
  constructor() {
    super("MonPass CA chain тохируулаагүй байна.");
  }
}

export type MonpassTrustValidation = {
  certificateChain: string[];
  validationEvidence: {
    trust: "ca_chain_and_ocsp_verified";
    ocspUrl: string;
    ocspCheckedAt: string;
    ocspThisUpdate: string;
    ocspNextUpdate: string | null;
    ocspResponseSha256: string;
    certificatePathLength: number;
  };
};

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pemToCertificate(pem: string, label: string): Certificate {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem);
  if (!match) throw new Error(`${label} PEM формат буруу байна.`);
  const parsed = asn1js.fromBER(base64ToBytes(match[1]).buffer);
  if (parsed.offset === -1) throw new Error(`${label} ASN.1 формат буруу байна.`);
  return new Certificate({ schema: parsed.result });
}

function base64DerToCertificate(value: string, label: string): Certificate {
  const parsed = asn1js.fromBER(base64ToBytes(value).buffer);
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

function trustConfiguration(env: EdgeApiEnv) {
  if (!env.MONPASS_TRUST_ROOT_CA_PEM || !env.MONPASS_TRUST_ISSUING_CA_PEM || !env.MONPASS_TRUST_CLASS2_4_CA_PEM || !env.MONPASS_OCSP_URL) {
    throw new MonpassTrustConfigurationError();
  }
  return {
    root: pemToCertificate(env.MONPASS_TRUST_ROOT_CA_PEM, "Үндэсний root CA"),
    issuing: pemToCertificate(env.MONPASS_TRUST_ISSUING_CA_PEM, "Үндэсний issuing CA"),
    monpass: pemToCertificate(env.MONPASS_TRUST_CLASS2_4_CA_PEM, "MonPass Class 2-4 CA"),
    ocspUrl: env.MONPASS_OCSP_URL,
  };
}

/**
 * Establishes the signer path against the pinned Mongolian CA hierarchy, then
 * checks the leaf status with the MonPass Class 2-4 OCSP responder.
 */
export async function verifyMonpassCertificateTrust(
  signerCertificate: string,
  env: EdgeApiEnv,
): Promise<MonpassTrustValidation> {
  const config = trustConfiguration(env);
  const signer = base64DerToCertificate(signerCertificate, "Гарын үсэг зурсан сертификат");
  const chain = new CertificateChainValidationEngine({
    trustedCerts: [config.root],
    certs: [signer, config.monpass, config.issuing],
    checkDate: new Date(),
  });
  const chainResult = await chain.verify();
  if (!chainResult.result) throw new Error(`CA chain баталгаажсангүй: ${chainResult.resultMessage}`);

  const ocspRequest = new OCSPRequest();
  await ocspRequest.createForCertificate(signer, {
    issuerCertificate: config.monpass,
    hashAlgorithm: "SHA-1",
  });
  const requestBytes = ocspRequest.toSchema().toBER(false);
  const response = await fetch(config.ocspUrl, {
    method: "POST",
    headers: {
      "content-type": "application/ocsp-request",
      accept: "application/ocsp-response",
    },
    body: requestBytes,
  });
  if (!response.ok) throw new Error(`MonPass OCSP хариу алдаатай байна (${response.status}).`);
  const responseBytes = await response.arrayBuffer();
  const parsedResponse = asn1js.fromBER(responseBytes);
  if (parsedResponse.offset === -1) throw new Error("MonPass OCSP хариу ASN.1 формат буруу байна.");
  const ocspResponse = new OCSPResponse({ schema: parsedResponse.result });
  if (ocspResponse.responseStatus.valueBlock.valueDec !== 0 || !ocspResponse.responseBytes) {
    throw new Error("MonPass OCSP сертификатын төлөв буцаасангүй.");
  }
  const parsedBasic = asn1js.fromBER(ocspResponse.responseBytes.response.valueBlock.valueHex);
  if (parsedBasic.offset === -1) throw new Error("MonPass OCSP гарын үсгийн бүтэц буруу байна.");
  const basicResponse = new BasicOCSPResponse({ schema: parsedBasic.result });
  const responseSignatureValid = await basicResponse.verify({
    trustedCerts: [config.monpass, ...(basicResponse.certs ?? [])],
  });
  if (!responseSignatureValid) throw new Error("MonPass OCSP хариуны гарын үсэг баталгаажсангүй.");
  const status = await basicResponse.getCertificateStatus(signer, config.monpass);
  if (!status.isForCertificate || status.status !== 0) {
    throw new Error(status.status === 1 ? "Гарын үсгийн сертификат хүчингүй болсон байна." : "Гарын үсгийн сертификатын OCSP төлөв тодорхойгүй байна.");
  }
  // getCertificateStatus verifies the matching CertID. Read the response time
  // separately so stale good responses cannot be treated as fresh evidence.
  const requestedCertId = ocspRequest.tbsRequest.requestList[0]?.reqCert;
  const matchingResponse = basicResponse.tbsResponseData.responses.find(
    (item) => requestedCertId != null && item.certID.isEqual(requestedCertId),
  );
  if (!matchingResponse) throw new Error("MonPass OCSP сертификатын дэлгэрэнгүй төлөв олдсонгүй.");
  const thisUpdate = matchingResponse.thisUpdate;
  const nextUpdate = matchingResponse.nextUpdate ?? null;
  const now = Date.now();
  if (thisUpdate.getTime() > now + 5 * 60 * 1000 || thisUpdate.getTime() < now - MAX_OCSP_AGE_MS || (nextUpdate && nextUpdate.getTime() < now)) {
    throw new Error("MonPass OCSP хариу хуучирсан байна.");
  }

  return {
    certificateChain: [signerCertificate, toBase64(config.monpass.toSchema().toBER(false)), toBase64(config.issuing.toSchema().toBER(false)), toBase64(config.root.toSchema().toBER(false))],
    validationEvidence: {
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
