# Inkline

**Touch ID on send. A small stamp proves a human stood behind this email.**

Inkline is a Chrome extension for Gmail. When you hit Send, Touch ID pops. If you confirm, the email ends with a small line after your signature:

> *[logo] human verified · Touch ID*

No biometric, no stamp. That's the whole rule.

## Why

AI can write an email. It can even fake typing rhythm. What it can't do is put a finger on a sensor. Inkline doesn't try to detect AI text — it attests that a human physically authorized this exact message, using the same passkey hardware (Secure Enclave / Windows Hello / Face ID) that protects your logins.

The stamp is plain text plus a hosted image, so **any recipient in any mail client sees it with nothing installed.**

Typed, dictated, pasted from your own notes — all fine. The proof is the human at the sensor, not the keystrokes.

## How it works

1. You hit Send in Gmail. The send is held.
2. A small window opens on the Inkline site (`/sign?c=<sha256(email body)>`) and asks for Touch ID. First time, it creates a passkey on your device — also via Touch ID.
3. The WebAuthn signature is handed back to the extension, the stamp is appended after your last line, and Send is re-triggered.
4. Cancel, close the window, or wait 90 s → the email sends normally with **no** stamp. You're never trapped.

```
Gmail tab ──INKLINE_SIGN_REQUEST──▶ background.js ──opens──▶ /sign (WebAuthn)
    ▲                                    │                       │
    └────────INKLINE_SIGN_DONE───────────┘◀──sign-bridge.js──────┘
```

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
| `site/sign/page.tsx` | The `/sign` page (Next.js) — deployed on the Inkline website; included here for reference |
| `test/e2e.mjs` | Real end-to-end test (see below) |

## Test

Loads the real extension into Playwright's Chromium, serves a fake Gmail at the real origin, uses the live `/sign` page with a virtual Touch ID:

```
npm i -D playwright && npx playwright install chromium
node test/e2e.mjs
```

Expect `sends after touch id (expect 1): 1` and `stamp: human verified · Touch ID`.

## Roadmap

- **Verifiable stamps.** Today the stamp is a claim. Next: store the passkey public key + each signature, and link the stamp to `/r/<id>` so any recipient can check that the signature matches the email.
- Outlook web, Firefox, Safari.
- Effort receipts (time spent, rewrites) as an optional extra line.

## Privacy

Your passkey never leaves your device. The extension only sends a SHA-256 hash of the email body to the sign page as the WebAuthn challenge. No email content, recipients, or keystrokes are transmitted or stored anywhere.

## License

MIT — see [LICENSE](LICENSE).
