import { headers } from "next/headers";
import { randomBytes } from "crypto";

export const RP_NAME = "Inkline";

/** RP ID and origin derived from the request, so prod, previews and localhost all work. */
export async function rp() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
}

export const b64url = (buf: Uint8Array | Buffer) => Buffer.from(buf).toString("base64url");
export const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

/** Challenge = 16 random bytes || sha256(email body). The signature literally covers the email hash. */
export function challengeFor(bodyHash: string) {
  const hash = fromB64url(bodyHash);
  if (hash.length !== 32) throw new Error("bodyHash must be a base64url SHA-256");
  return b64url(Buffer.concat([randomBytes(16), Buffer.from(hash)]));
}

export const newId = (n = 12) => randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n);

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
