# Inkline

**Touch ID on send. A small stamp proves a human stood behind this email.**

Inkline is a Chrome extension for Gmail. When you hit Send, Touch ID pops. If you confirm, the email ends with a small line after your signature:

> *[logo] human verified · Touch ID* → links to a receipt page anyone can check

No biometric, no stamp. That's the whole rule.

## Why

AI can write an email. It can even fake typing rhythm. What it can't do is put a finger on a sensor. Inkline doesn't try to detect AI text — it attests that a human physically authorized this exact message, using the same passkey hardware (Secure Enclave / Windows Hello / Face ID) that protects your logins.

The stamp is plain text plus a hosted image, so **any recipient in any mail client sees it with nothing installed.**

Typed, dictated, pasted from your own notes — all fine. The proof is the human at the sensor, not the keystrokes.

## How it works

1. You hit Send in Gmail. The send is held. The extension hashes the email body (SHA-256, whitespace-normalized).
2. A small window opens on the Inkline site (`/sign?h=<hash>`). The page asks the server for a **single-use challenge** whose bytes contain that hash, then asks for Touch ID. First time on a device it registers a passkey (Touch ID), then signs (Touch ID again).
3. The server verifies the WebAuthn response — origin, RP ID hash, user-verification flag, signature against the stored public key, signature counter, challenge unused and unexpired — and issues a **receipt id**.
4. The extension appends the stamp, linked to `/r/<receipt id>`, and re-triggers Send.
5. Cancel, close the window, or wait 90 s → the email sends normally with **no** stamp. You're never trapped.

```
Gmail tab ──INKLINE_SIGN_REQUEST──▶ background.js ──opens──▶ /sign ──▶ POST /api/sign/start   (challenge ⊃ sha256(body))
    ▲                                    │                    │        Touch ID (WebAuthn)
    │                                    │                    └──▶ POST /api/sign/finish  (verify → receipt)
    └────────INKLINE_SIGN_DONE───────────┘◀──sign-bridge.js────┘
```

### What a receipt proves
`/r/<id>` shows when the signature was made, that the authenticator confirmed user verification, which passkey signed, and the email hash. A recipient can paste the email text to check it hashes to the signed value — in their browser, nothing uploaded. It proves **a person authorized this exact text**, not who they are (there are no accounts yet).

### Threat model, honestly
- A computer-use agent can type an email and click Send. It cannot produce a Secure Enclave signature with user verification.
- A human can Touch ID an AI-written email. Inkline attests authorization, not authorship.
- Anyone can register a passkey. Identity binding (this passkey belongs to this email address) is the next layer.

## Install (developer mode)

1. Clone this repo.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the repo folder.
3. Open Gmail, compose, Send → Touch ID.

After pulling updates: click ↻ on the extension **and reload the Gmail tab** (a banner reminds you if you forget). The popup shows the running version.

Works on Chrome and other Chromium browsers (Edge, Brave, Arc). Firefox and Safari: not yet.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest |
| `content.js` | Runs in Gmail: tracks the compose box, intercepts Send, injects the stamp |
| `background.js` | Opens the Touch ID window, relays the signature back to the Gmail tab |
| `sign-bridge.js` | Runs on `/sign`, forwards the WebAuthn result to the extension |
| `popup.html/js` | On/off toggle, version, last-send status, your receipt log |
| `site/` | Server side (Next.js, deployed on the Inkline website): `/sign` page, `/api/sign/start`, `/api/sign/finish`, `/r/[id]` receipt page, `lib/webauthn.ts`, `lib/db.ts` (Postgres). Copied here for audit; canonical in the website repo. |
| `test/e2e.mjs` | Real end-to-end test (see below) |

## Test

Loads the real extension into Playwright's Chromium, serves a fake Gmail at the real origin, uses the live `/sign` page with a virtual Touch ID:

```
npm i -D playwright && npx playwright install chromium
node test/e2e.mjs
```

Expect `sends after touch id (expect 1): 1`, `stamp: human verified · Touch ID`, and a receipt page.
To test against a local server: run the site with `DATABASE_URL=postgres://localhost/inkline`, then `E2E_SITE=http://localhost:3000 node test/e2e.mjs`.

## Roadmap

- Identity: bind a passkey to a sender address so the receipt can say *who*, not just *a person*.
- Outlook web, Firefox, Safari.
- Effort receipts (time spent, rewrites) as an optional extra line.

## Privacy

Your passkey never leaves your device. The extension sends only a SHA-256 hash of the email body. The server stores the passkey's public key, the challenge, the signature, and that hash — never email content, recipients, or keystrokes.

## License

MIT — see [LICENSE](LICENSE).
