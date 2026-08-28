import { db } from "@/lib/db";
import BodyCheck from "./body-check";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let r: Record<string, unknown> | null = null;
  try {
    const pool = await db();
    r = (await pool.query(
      `SELECT r.id, r.body_hash, r.verified_at, r.user_verified, r.credential_id, c.created_at AS credential_created_at
       FROM receipts r JOIN credentials c ON c.id = r.credential_id WHERE r.id = $1`, [id]
    )).rows[0] ?? null;
  } catch { r = null; }

  return (
    <div className="min-h-dvh bg-black text-white font-sans flex flex-col items-center p-8">
      <div className="w-full max-w-xl">
        <h1 className="text-3xl font-bold mb-1 font-[family-name:var(--font-righteous)]">Inkline receipt</h1>
        {!r ? (
          <p className="text-red-400 mt-6">No receipt with id <code>{id}</code>. This stamp could not be verified.</p>
        ) : (
          <>
            <p className="text-green-400 text-xl mt-6 mb-6">✓ A human signed this email with Touch ID</p>
            <dl className="space-y-3 text-sm">
              <Row k="Signed at" v={new Date(r.verified_at as string).toLocaleString("en-US", { timeZoneName: "short" })} />
              <Row k="User verification" v={r.user_verified ? "biometric / PIN confirmed by the authenticator" : "not confirmed"} />
              <Row k="Passkey" v={`${String(r.credential_id).slice(0, 12)}… (registered ${new Date(r.credential_created_at as string).toLocaleDateString()})`} />
              <Row k="Email hash" v={<code className="break-all">{String(r.body_hash)}</code>} />
              <Row k="Receipt" v={<code>{String(r.id)}</code>} />
            </dl>
            <BodyCheck expected={String(r.body_hash)} />
            <p className="text-xs text-gray-500 mt-10 leading-relaxed">
              How this was verified: the server issued a single-use challenge containing this email&apos;s SHA-256, the sender&apos;s device
              signed it with a hardware passkey after biometric confirmation, and the server checked the origin, RP ID, user-verification
              flag, signature and counter before issuing this receipt. It proves a person authorized this exact text — not who they are.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-white/10 pb-3">
      <dt className="text-gray-400">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
