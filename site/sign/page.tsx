"use client";
import { useEffect, useState } from "react";

/**
 * Inkline signing page. Opened by the extension in a small popup at send time:
 *   /sign?c=<base64url challenge = sha256(email body)>
 * Runs a WebAuthn ceremony with the platform authenticator (Touch ID / Face ID / Windows Hello),
 * then hands the result back to the extension's content script via window.postMessage.
 */
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

type Status = "idle" | "working" | "done" | "error";

export default function SignPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<boolean>(false);

  useEffect(() => {
    setRegistered(!!localStorage.getItem("inkline_cred_id"));
  }, []);

  // Post the result until the extension's bridge acks it (retries cover the bridge not being ready yet).
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

  async function run() {
    setStatus("working");
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const c = params.get("c");
      if (!c) throw new Error("Missing challenge");
      const challenge = fromB64url(c);
      const rpId = window.location.hostname;
      let credId = localStorage.getItem("inkline_cred_id");

      if (!credId) {
        // First time on this device: create a passkey. Touch ID is required here too (userVerification).
        const userId = crypto.getRandomValues(new Uint8Array(16));
        const cred = (await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: "Inkline", id: rpId },
            user: { id: userId, name: "inkline", displayName: "Inkline" },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
            timeout: 60000,
          },
        })) as PublicKeyCredential | null;
        if (!cred) throw new Error("No credential returned");
        credId = b64url(cred.rawId);
        localStorage.setItem("inkline_cred_id", credId);
        const resp = cred.response as AuthenticatorAttestationResponse;
        post({ ok: true, registered: true, credId, clientDataJSON: b64url(resp.clientDataJSON), attestationObject: b64url(resp.attestationObject) });
      } else {
        const assertion = (await navigator.credentials.get({
          publicKey: {
            challenge,
            rpId,
            allowCredentials: [{ type: "public-key", id: fromB64url(credId) }],
            userVerification: "required",
            timeout: 60000,
          },
        })) as PublicKeyCredential | null;
        if (!assertion) throw new Error("No assertion returned");
        const resp = assertion.response as AuthenticatorAssertionResponse;
        post({
          ok: true,
          credId,
          signature: b64url(resp.signature),
          authenticatorData: b64url(resp.authenticatorData),
          clientDataJSON: b64url(resp.clientDataJSON),
        });
      }
      setStatus("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("error");
      post({ ok: false, error: msg });
    }
  }

  // Auto-start; Chrome allows the platform authenticator prompt without a click, but we keep a button as fallback.
  useEffect(() => {
    const t = setTimeout(() => { if (status === "idle") run(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-dvh bg-black text-white flex flex-col items-center justify-center p-8 text-center font-sans">
      <div className="text-5xl mb-4">✍︎</div>
      <h1 className="text-2xl font-bold mb-2 font-[family-name:var(--font-righteous)]">Inkline</h1>
      {status === "working" && <p className="text-gray-300">Confirm with Touch ID to sign this email…</p>}
      {status === "done" && <p className="text-green-400">Signed. You can close this window.</p>}
      {status === "error" && (
        <>
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={run} className="border border-white/30 rounded-full px-5 py-2 hover:bg-white/10">Try again</button>
        </>
      )}
      {status === "idle" && (
        <button onClick={run} className="border border-white/30 rounded-full px-5 py-2 hover:bg-white/10">
          {registered ? "Sign with Touch ID" : "Set up Touch ID"}
        </button>
      )}
      <p className="text-xs text-gray-500 mt-8 max-w-xs">
        Your passkey never leaves this device. Inkline only receives a signature over a hash of the email.
      </p>
    </div>
  );
}
