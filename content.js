/**
 * Inkline — human-verified stamp for Gmail.
 *
 * On send, asks for Touch ID (WebAuthn passkey on the Inkline site). If you confirm, the email gets a
 * small stamp after your last line:
 *
 *   [logo] human verified · Touch ID
 *
 * No stamp without the biometric. Typing/paste/time stats are still collected for your own popup log,
 * but they never gate the stamp — typed, dictated, or pasted-from-your-notes are all fine if a human signs it.
 */
(() => {
  if (window.__inklineLoaded) return;
  window.__inklineLoaded = true;

  const STAMP_IMG = 'https://inkline-website-three.vercel.app/inklinestamp.png'; // PNG: Gmail does not render SVG in mail
  const CONFIG = {
    maxPasteRatio: 0.30,
    minTypedChars: 20,
    minMinutesToShow: 3,
    minRewritesToShow: 2,
    rewriteBurstChars: 15,
    idleGapMs: 120_000,
  };

  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  // After the extension is reloaded, old content scripts keep running but chrome.runtime.id becomes undefined
  // and every chrome.* call throws "Extension context invalidated". Check before touching the API.
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  let enabled = true;
  if (hasChrome && alive()) {
    try {
      chrome.storage.local.get({ enabled: true }, (v) => { enabled = v.enabled !== false; });
      chrome.storage.onChanged.addListener((ch) => { if (ch.enabled) enabled = ch.enabled.newValue !== false; });
    } catch { /* stale context */ }
  }

  // ---------- tracking ----------
  const sessions = new WeakMap(); // body element -> session

  const textLen = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().length;

  function newSession(el) {
    return {
      el,
      startedAt: null,
      lastInputAt: null,
      activeMs: 0,
      typed: 0,
      pasted: 0,
      deleted: 0,
      rewrites: 0,
      deleteBurst: 0,
      pendingPaste: 0,
      signed: null,     // Touch ID result, or {skipped:true}
      lastLen: textLen(el),
    };
  }

  function onInput(e) {
    const el = e.currentTarget;
    const s = sessions.get(el);
    if (!s) return;
    const now = Date.now();
    if (!s.startedAt) s.startedAt = now;
    if (s.lastInputAt) {
      const gap = now - s.lastInputAt;
      if (gap < CONFIG.idleGapMs) s.activeMs += gap;
    }
    s.lastInputAt = now;

    const len = textLen(el);
    const delta = len - s.lastLen;
    s.lastLen = len;
    const type = e.inputType || '';

    if (delta > 0) {
      if (!e.isTrusted || type.startsWith('insertFromPaste') || type === 'insertFromDrop' || s.pendingPaste > 0) {
        s.pasted += delta;
        s.pendingPaste = 0;
      } else {
        s.typed += delta;
      }
      if (s.deleteBurst >= CONFIG.rewriteBurstChars) s.rewrites += 1;
      s.deleteBurst = 0;
    } else if (delta < 0) {
      s.deleted += -delta;
      s.deleteBurst += -delta;
    }
  }

  function onPaste(e) {
    const s = sessions.get(e.currentTarget);
    if (!s) return;
    const t = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    s.pendingPaste = t.length || 1;
  }

  function track(el) {
    if (sessions.has(el)) return;
    sessions.set(el, newSession(el));
    el.addEventListener('paste', onPaste, true);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeydown, true);
  }

  function findBodies(root = document) {
    return [...root.querySelectorAll(
      '[contenteditable="true"][aria-label*="Message Body"], div[contenteditable="true"][g_editable="true"], div[role="textbox"][contenteditable="true"]'
    )];
  }

  // ---------- receipt ----------
  function receiptFor(s) {
    const finalLen = textLen(s.el);
    const total = s.typed + s.pasted;
    const pasteRatio = total > 0 ? s.pasted / total : 0;
    const minutes = Math.round(s.activeMs / 60000);
    const touchId = !!(s.signed && s.signed.ok);
    if (!touchId) return null; // biometric or nothing
    return {
      text: 'human verified \u00B7 Touch ID',
      touchId,
      typed: s.typed, pasted: s.pasted, deleted: s.deleted, rewrites: s.rewrites,
      minutes, pasteRatio: +pasteRatio.toFixed(2), finalLen, at: Date.now(),
    };
  }

  /** Markup Gmail keeps when it serializes the body: <div>, <i>, <font color>, <br>. Styles/images get stripped. */
  function stampNode(text) {
    const line = document.createElement('div');
    line.setAttribute('data-inkline-stamp', '1');
    const i = document.createElement('i');
    const f = document.createElement('font');
    f.setAttribute('color', '#8a8a8a');
    f.setAttribute('size', '1');
    const img = document.createElement('img');
    img.src = STAMP_IMG; img.alt = '\u270D\uFE0E'; img.width = 14; img.height = 14;
    img.setAttribute('style', 'width:14px;height:14px;vertical-align:-2px;margin-right:4px;');
    f.appendChild(img);
    f.appendChild(document.createTextNode(text));
    i.appendChild(f);
    line.appendChild(i);
    return line;
  }

  /** Append the stamp on its own line right after the last thing the user wrote (before any quoted reply). */
  function injectStamp(el, text) {
    if (el.querySelector('[data-inkline-stamp]')) return false;
    const skip = (n) => n.closest && n.closest('.gmail_quote');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.textContent.trim() && !skip(n.parentElement)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    let last = null, n;
    while ((n = walker.nextNode())) last = n;
    // climb to the block that directly sits in the body so the stamp becomes the next line
    let block = last ? last.parentNode : null;
    while (block && block.parentNode !== el) block = block.parentNode;
    const stamp = stampNode(text);
    const spacer = document.createElement('div'); spacer.appendChild(document.createElement('br'));
    if (block && block.nextSibling) { el.insertBefore(spacer, block.nextSibling); el.insertBefore(stamp, spacer.nextSibling); }
    else { el.appendChild(spacer); el.appendChild(stamp); }
    return true;
  }

  function finalize(el) {
    if (!enabled) return;
    const s = sessions.get(el);
    if (!s) return;
    const r = receiptFor(s);
    if (!r) return;
    if (!injectStamp(el, r.text)) return;
    // fire a synthetic input so Gmail picks up the DOM change before it serializes the body
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (hasChrome && alive()) {
      try {
        chrome.storage.local.get({ receipts: [] }, (v) => {
          const receipts = [r, ...v.receipts].slice(0, 200);
          chrome.storage.local.set({ receipts });
        });
      } catch { /* context gone; stamp still injected */ }
    }
  }

  // ---------- send hooks (Touch ID first, then send) ----------
  const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;

  function composeRootOf(node) {
    return node.closest && (node.closest('[role="dialog"]') || node.closest('.nH.Hd') || node.closest('form') || node.closest('.AD'));
  }

  function isSendButton(node) {
    const b = node.closest && node.closest('[role="button"],button');
    if (!b) return null;
    const label = (b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || b.textContent || '').trim();
    return /^send\b/i.test(label) ? b : null;
  }

  const toB64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function challengeFor(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return toB64url(new Uint8Array(buf));
    } catch {
      return toB64url(crypto.getRandomValues(new Uint8Array(32))); // no subtle crypto: still get a fresh challenge
    }
  }
  const SIGN_TIMEOUT_MS = 90_000;

  let awaiting = null; // { el, resend }

  /** Returns true if the send should be intercepted (we'll re-trigger it after Touch ID). */
  let staleBannerShown = false;
  function showStaleBanner() {
    if (staleBannerShown) return;
    staleBannerShown = true;
    const d = document.createElement('div');
    d.textContent = 'Inkline was updated \u2014 reload this Gmail tab to enable Touch ID stamps.';
    d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;padding:10px 16px;border-radius:999px;font:13px -apple-system,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer;';
    d.title = 'Click to reload';
    d.addEventListener('click', () => location.reload());
    document.body.appendChild(d);
  }

  function note(reason) {
    if (hasChrome && alive()) { try { chrome.storage.local.set({ lastSign: { ok: false, error: reason, at: Date.now() } }); } catch {} }
  }

  function interceptSend(el, resend) {
    if (!enabled) return false;
    if (!hasRuntime || !alive()) { showStaleBanner(); return false; }
    const s = sessions.get(el);
    if (!s) { note('compose box was not tracked'); return false; }
    if (s.signed || awaiting) return false;
    if (textLen(el) === 0) { note('empty email — nothing to sign'); return false; }
    awaiting = { el, resend };
    challengeFor((el.innerText || el.textContent || '').trim()).then((challenge) => {
      try {
        chrome.runtime.sendMessage({ type: 'INKLINE_SIGN_REQUEST', challenge }, () => {
          const err = chrome.runtime.lastError;
          // a closed port just means the background didn't ack; the sign result arrives via onMessage later
          if (err && !/message port closed/i.test(err.message)) onSignDone({ ok: false, error: err.message });
        });
      } catch (err) { onSignDone({ ok: false, error: String(err) }); }
    });
    // never trap the user: if Touch ID doesn't answer, send unsigned
    awaiting.timer = setTimeout(() => onSignDone({ ok: false, error: 'timeout' }), SIGN_TIMEOUT_MS);
    return true;
  }

  function onSignDone(msg) {
    if (!awaiting) return;
    const { el, resend, timer } = awaiting;
    clearTimeout(timer);
    awaiting = null;
    const s = sessions.get(el);
    if (s) s.signed = msg.ok ? msg : { skipped: true, error: msg.error };
    if (hasChrome && alive()) { try { chrome.storage.local.set({ lastSign: { ok: !!msg.ok, error: msg.error || null, at: Date.now() } }); } catch {} }
    finalize(el);
    setTimeout(resend, 50);
  }

  if (hasRuntime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'INKLINE_SIGN_DONE') onSignDone(msg);
    });
  }

  document.addEventListener('click', (e) => {
    const btn = isSendButton(e.target);
    if (!btn) return;
    const root = composeRootOf(btn) || document;
    const bodies = findBodies(root);
    const el = bodies[0];
    if (el && interceptSend(el, () => btn.click())) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    bodies.forEach(finalize);
  }, true);

  function onKeydown(e) {
    if (!(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return;
    const el = e.currentTarget;
    if (interceptSend(el, () => {
      const root = composeRootOf(el) || document;
      const btn = [...root.querySelectorAll('[role="button"],button')].find((b) => isSendButton(b));
      if (btn) btn.click();
    })) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    finalize(el);
  }

  // ---------- discovery ----------
  findBodies().forEach(track);
  new MutationObserver((muts) => {
    for (const m of muts) for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches && node.matches('[contenteditable="true"]')) track(node);
      findBodies(node).forEach(track);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // exposed for tests / console debugging
  window.__inkline = { sessions, receiptFor, injectStamp, finalize, findBodies, interceptSend, CONFIG, version: '5.0.3' };
})();
