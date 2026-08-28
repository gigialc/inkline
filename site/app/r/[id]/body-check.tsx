"use client";
import { useState } from "react";

/** Same normalization as the extension: collapse whitespace, trim, drop the stamp line itself. */
export function normalizeBody(text: string) {
  return text
    .split("\n")
    .filter((l) => !/human verified/i.test(l))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256b64url(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function BodyCheck({ expected }: { expected: string }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<null | boolean>(null);
  return (
    <div className="mt-8">
      <h2 className="font-semibold mb-2">Check it&apos;s this email</h2>
      <p className="text-sm text-gray-400 mb-2">Paste the email text (from greeting to signature). It&apos;s hashed in your browser and compared to the signed hash — nothing is uploaded.</p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} rows={6}
        className="w-full bg-white/5 border border-white/20 rounded-lg p-3 text-sm" placeholder="Paste the email here…" />
      <button onClick={async () => setResult((await sha256b64url(normalizeBody(text))) === expected)}
        className="mt-2 border border-white/30 rounded-full px-5 py-2 hover:bg-white/10 text-sm">Compare</button>
      {result === true && <p className="text-green-400 mt-3">✓ Matches — this is the text that was signed.</p>}
      {result === false && <p className="text-red-400 mt-3">✗ Doesn&apos;t match. The text differs from what was signed (formatting differences can cause this too).</p>}
    </div>
  );
}
