import { NextResponse } from "next/server";
import { generateRegistrationOptions, generateAuthenticationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { rp, RP_NAME, challengeFor, newId, fromB64url, CHALLENGE_TTL_MS } from "@/lib/webauthn";

export const runtime = "nodejs";

/**
 * POST { bodyHash, credId? }
 * Issues a server-side, single-use challenge bound to the email hash.
 * → { challengeId, kind: 'registration' | 'authentication', options }
 */
export async function POST(req: Request) {
  try {
    const { bodyHash, credId } = await req.json();
    if (typeof bodyHash !== "string") return NextResponse.json({ error: "bodyHash required" }, { status: 400 });
    const { rpID } = await rp();
    const pool = await db();
    const challenge = challengeFor(bodyHash);
    const challengeId = newId(16);
    const expires = new Date(Date.now() + CHALLENGE_TTL_MS);

    const cred = credId ? (await pool.query("SELECT id, transports FROM credentials WHERE id = $1", [credId])).rows[0] : null;

    if (cred) {
      const options = await generateAuthenticationOptions({
        rpID,
        challenge: fromB64url(challenge),
        allowCredentials: [{ id: cred.id, transports: cred.transports }],
        userVerification: "required",
        timeout: 60000,
      });
      await pool.query(
        "INSERT INTO challenges (id, challenge, body_hash, kind, cred_id, expires_at) VALUES ($1,$2,$3,'authentication',$4,$5)",
        [challengeId, options.challenge, bodyHash, cred.id, expires]
      );
      return NextResponse.json({ challengeId, kind: "authentication", options });
    }

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      challenge: fromB64url(challenge),
      userName: "inkline",
      userDisplayName: "Inkline",
      attestationType: "none",
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
      timeout: 60000,
    });
    await pool.query(
      "INSERT INTO challenges (id, challenge, body_hash, kind, expires_at) VALUES ($1,$2,$3,'registration',$4)",
      [challengeId, options.challenge, bodyHash, expires]
    );
    return NextResponse.json({ challengeId, kind: "registration", options });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
