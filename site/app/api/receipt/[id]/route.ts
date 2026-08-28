import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await db();
  const r = (await pool.query(
    `SELECT r.id, r.body_hash, r.verified_at, r.user_verified, r.credential_id, r.challenge, r.signature, r.authenticator_data, r.client_data_json,
            c.created_at AS credential_created_at, c.aaguid
     FROM receipts r JOIN credentials c ON c.id = r.credential_id WHERE r.id = $1`, [id]
  )).rows[0];
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(r);
}
