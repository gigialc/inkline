// Relays Touch ID sign requests between the Gmail tab and the Inkline /sign popup window.
// The pending map lives in chrome.storage.session because MV3 service workers are killed after ~30s idle,
// and a passkey ceremony can easily take longer than that.
const log = (...a) => console.log('[inkline bg]', ...a);
const SIGN_URL = 'https://inkline-website-three.vercel.app/sign';

async function getPending() { return (await chrome.storage.session.get({ pending: {} })).pending; }
async function setPending(p) { await chrome.storage.session.set({ pending: p }); }

async function deliver(gmailTabId, payload) {
  try { await chrome.tabs.sendMessage(gmailTabId, { ...payload, type: 'INKLINE_SIGN_DONE' }); log('delivered to', gmailTabId); }
  catch (e) { log('DELIVER FAILED to', gmailTabId, e && e.message); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  log('message', msg.type, 'from tab', sender.tab && sender.tab.id, 'window', sender.tab && sender.tab.windowId);
  if (msg.type === 'INKLINE_SIGN_REQUEST' && sender.tab) {
    sendResponse({ ok: true });
    const gmailTabId = sender.tab.id;
    (async () => {
      try {
        // dev override: chrome.storage.local.set({ signUrl: 'http://localhost:3000/sign' })
        const signUrl = (await chrome.storage.local.get({ signUrl: SIGN_URL })).signUrl || SIGN_URL;
        const w = await chrome.windows.create({ url: `${signUrl}?h=${encodeURIComponent(msg.bodyHash)}`, type: 'popup', width: 420, height: 460, focused: true });
        const p = await getPending(); p[w.id] = gmailTabId; await setPending(p);
        log('opened sign window', w.id, 'for gmail tab', gmailTabId);
      } catch (e) {
        deliver(gmailTabId, { ok: false, error: 'could not open Touch ID window: ' + (e && e.message) });
      }
    })();
    return;
  }
  if (msg.type === 'INKLINE_SIGN_RESULT' && sender.tab) {
    sendResponse({ ok: true });
    const winId = sender.tab.windowId;
    (async () => {
      const p = await getPending();
      const gmailTabId = p[winId];
      log('result from window', winId, 'pending', JSON.stringify(p), 'ok', msg.ok, msg.error || '');
      if (gmailTabId == null) return; // duplicate result or unknown window
      delete p[winId]; await setPending(p);
      await deliver(gmailTabId, msg);
      setTimeout(() => chrome.windows.remove(winId).catch(() => {}), 600);
    })();
  }
});

// User closed the popup without finishing → tell Gmail to proceed unsigned.
chrome.windows.onRemoved.addListener(async (winId) => {
  const p = await getPending();
  log('window removed', winId, 'pending', JSON.stringify(p));
  const gmailTabId = p[winId];
  if (gmailTabId == null) return;
  delete p[winId]; await setPending(p);
  deliver(gmailTabId, { ok: false, error: 'cancelled' });
});
