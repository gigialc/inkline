import { NextResponse } from "next/server";
import { verifyRegistrationResponse, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { rp, newId } from "@/lib/webauthn";

export const runtime = "nodejs";

/**
 * POST { challengeId, response }
 * Verifies the WebAuthn response against the stored challenge: origin, RP ID hash, user-verification flag,
 * signature over authenticatorData || sha256(clientDataJSON) with the stored public key, and signature counter.
 * Registration → stores the credential → { registered: true, credId }  (client then signs the email in a 2nd ceremony)
 * Authentication → stores a receipt → { receiptId }
 */
export async function POST(req: Request) {
  const pool = await db();
  try {
    const { challengeId, response } = await req.json();
    const { rpID, origin } = await rp();

    // single-use, unexpired challenge — consumed atomically
    const ch = (await pool.query(
      "UPDATE challenges SET used = true WHERE id = $1 AND used = false AND expires_at > now() RETURNING *",
      [challengeId]
    )).rows[0];
    if (!ch) return NextResponse.json({ error: "challenge unknown, used, or expired" }, { status: 400 });

    if (ch.kind === "registration") {
      const v = await verifyRegistrationResponse({
        response,
        expectedChallenge: ch.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!v.verified || !v.registrationInfo) return NextResponse.json({ error: "registration not verified" }, { status: 400 });
      const c = v.registrationInfo.credential;
      await pool.query(
        "INSERT INTO credentials (id, public_key, counter, transports, aaguid) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
        [c.id, Buffer.from(c.publicKey), c.counter, c.transports ?? [], v.registrationInfo.aaguid]
      );
      return NextResponse.json({ registered: true, credId: c.id });
    }

    const cred = (await pool.query("SELECT * FROM credentials WHERE id = $1", [ch.cred_id])).rows[0];
    if (!cred) return NextResponse.json({ error: "unknown credential" }, { status: 400 });

    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: cred.id, publicKey: new Uint8Array(cred.public_key), counter: Number(cred.counter), transports: cred.transports },
      requireUserVerification: true,
    });
    if (!v.verified) return NextResponse.json({ error: "signature not verified" }, { status: 400 });

    await pool.query("UPDATE credentials SET counter = $2 WHERE id = $1", [cred.id, v.authenticationInfo.newCounter]);
    const receiptId = newId(10);
    await pool.query(
      `INSERT INTO receipts (id, body_hash, credential_id, challenge, signature, authenticator_data, client_data_json, user_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [receiptId, ch.body_hash, cred.id, ch.challenge, response.response.signature, response.response.authenticatorData, response.response.clientDataJSON, v.authenticationInfo.userVerified]
    );
    return NextResponse.json({ receiptId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
