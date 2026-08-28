"use client";
import { useEffect, useRef, useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

/**
 * Inkline signing page. Opened by the extension at send time: /sign?h=<base64url sha256(email body)>
 * 1. asks the server for a single-use challenge bound to the email hash
 * 2. runs the platform authenticator (Touch ID / Face ID / Windows Hello)
 * 3. server verifies the response and issues a receipt id
 * 4. hands { receiptId, receiptUrl } back to the extension via postMessage
 * First visit on a device registers a passkey (Touch ID), then signs the email (Touch ID again).
 */
type Status = "idle" | "working" | "done" | "error";

export default function SignPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const post = (payload: Record<string, unknown>) => {
    let acked = false;
    const onAck = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === "INKLINE_SIGN_ACK") acked = true; };
    window.addEventListener("message", onAck);
    let tries = 0;
    const send = () => {
      if (acked || tries++ >= 10) { window.removeEventListener("message", onAck); return; }
      window.postMessage({ type: "INKLINE_SIGN_RESULT", ...payload }, window.location.origin);
      setTimeout(send, 400);
    };
    send();
  };

  async function api<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `${path} failed`);
    return j as T;
  }

  async function run() {
    setStatus("working"); setError(null);
    try {
      const bodyHash = new URLSearchParams(window.location.search).get("h");
      if (!bodyHash) throw new Error("Missing email hash");
      let credId = localStorage.getItem("inkline_cred_id");

      // Registration (first time on this device), then fall through to signing.
      let start = await api<{ challengeId: string; kind: string; options: never }>("/api/sign/start", { bodyHash, credId });
      if (start.kind === "registration") {
        setStep("Setting up your passkey — confirm with Touch ID");
        const reg = await startRegistration({ optionsJSON: start.options });
        const fin = await api<{ credId: string }>("/api/sign/finish", { challengeId: start.challengeId, response: reg });
        credId = fin.credId;
        localStorage.setItem("inkline_cred_id", credId);
        start = await api("/api/sign/start", { bodyHash, credId });
        if (start.kind !== "authentication") throw new Error("Passkey registered but not found for signing");
      }

      setStep("Confirm with Touch ID to sign this email");
      const auth = await startAuthentication({ optionsJSON: start.options });
      const fin = await api<{ receiptId: string }>("/api/sign/finish", { challengeId: start.challengeId, response: auth });
      const receiptUrl = `${window.location.origin}/r/${fin.receiptId}`;
      post({ ok: true, credId, receiptId: fin.receiptId, receiptUrl });
      setStatus("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // a stale credential id (e.g. passkey deleted) → clear and let the user retry as registration
      if (/unknown credential|not found for signing|NotAllowedError|InvalidStateError/i.test(msg)) localStorage.removeItem("inkline_cred_id");
      setError(msg); setStatus("error");
      post({ ok: false, error: msg });
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-dvh bg-black text-white flex flex-col items-center justify-center p-8 text-center font-sans">
      <div className="text-5xl mb-4">✍︎</div>
      <h1 className="text-2xl font-bold mb-2 font-[family-name:var(--font-righteous)]">Inkline</h1>
      {status === "working" && <p className="text-gray-300">{step || "Starting…"}</p>}
      {status === "done" && <p className="text-green-400">Signed and verified. You can close this window.</p>}
      {status === "error" && (
        <>
          <p className="text-red-400 mb-4 max-w-xs break-words">{error}</p>
          <button onClick={run} className="border border-white/30 rounded-full px-5 py-2 hover:bg-white/10">Try again</button>
        </>
      )}
      {status === "idle" && (
        <button onClick={run} className="border border-white/30 rounded-full px-5 py-2 hover:bg-white/10">Sign with Touch ID</button>
      )}
      <p className="text-xs text-gray-500 mt-8 max-w-xs">
        Your passkey never leaves this device. The server only receives a signature over a hash of the email and verifies it.
      </p>
    </div>
  );
}
