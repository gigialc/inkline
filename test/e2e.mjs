import { chromium } from 'playwright';
import { fileURLToPath } from 'url'; import path from 'path';
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
// serve a fake Gmail at the real origin so the content script attaches
await ctx.route('https://mail.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: `
<div role="dialog"><div contenteditable="true" aria-label="Message Body" id="body"><div>Hi there</div></div>
<div role="button" aria-label="Send ‪(⌘Enter)‬" id="send">Send</div></div>
<script>window.__sends=0; document.getElementById('send').addEventListener('click', () => window.__sends++);</script>` }));
let sw = ctx.serviceWorkers()[0];
if (!sw) { try { sw = await ctx.waitForEvent('serviceworker', { timeout: 8000 }); } catch {} }
console.log('service worker:', sw ? sw.url() : 'NONE');
if (sw) sw.on('console', m => console.log('[sw]', m.text()));
// E2E_SITE=http://localhost:3078 → point the extension at a local dev server (needs DATABASE_URL there)
if (sw && process.env.E2E_SITE) await sw.evaluate((u) => chrome.storage.local.set({ signUrl: u + '/sign' }), process.env.E2E_SITE);
const gmail = await ctx.newPage();
gmail.on('console', m => console.log('[gmail]', m.text()));
await gmail.goto('https://mail.google.com/mail/u/0/#inbox'); await gmail.waitForTimeout(2500);


const popupPromise = ctx.waitForEvent('page', { timeout: 10000 });
await gmail.evaluate(()=>{const el=document.getElementById('body');el.focus();const r=document.createRange();r.setStart(el.firstChild.firstChild,0);r.collapse(true);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);});
await gmail.keyboard.type('Hello, testing end to end. ');
await gmail.click('#send');
console.log('sends right after click (expect 0):', await gmail.evaluate(() => window.__sends));
let popup;
try { popup = await popupPromise; } catch { console.log('NO POPUP WINDOW OPENED'); await ctx.close(); process.exit(1); }
popup.on('console', m => console.log('[sign]', m.text()));
const cdp = await ctx.newCDPSession(popup);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol:'ctap2', transport:'internal', hasResidentKey:true, hasUserVerification:true, isUserVerified:true, automaticPresenceSimulation:true } });
console.log('popup url:', popup.url().slice(0, 60));
const t0 = Date.now();
while (!popup.isClosed() && Date.now() - t0 < 15000) await gmail.waitForTimeout(250);
console.log('popup closed by itself after ms:', Date.now() - t0, popup.isClosed());
await gmail.waitForTimeout(1000);
console.log('sends after touch id (expect 1):', await gmail.evaluate(() => window.__sends));
console.log('stamp:', await gmail.evaluate(() => document.querySelector('[data-inkline-stamp]')?.textContent));
const href = await gmail.evaluate(() => document.querySelector('[data-inkline-stamp] a')?.href);
console.log('receipt link:', href);
if (href) { const rp = await ctx.newPage(); await rp.goto(href); await rp.waitForTimeout(1500); console.log('RECEIPT PAGE:', (await rp.textContent('body')).replace(/\s+/g,' ').slice(0, 160)); }
const extId = sw.url().split('/')[2];
const pp = await ctx.newPage(); await pp.goto(`chrome-extension://${extId}/popup.html`); await pp.waitForTimeout(500);
console.log('POPUP PAGE:', (await pp.textContent('body')).replace(/\s+/g,' ').slice(0,200));
await ctx.close();
