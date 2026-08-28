// Runs on the Inkline /sign page: forwards the WebAuthn result from the page to the extension (once).
let forwarded = false;
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin || !e.data || e.data.type !== 'INKLINE_SIGN_RESULT') return;
  if (forwarded) return;
  forwarded = true;
  chrome.runtime.sendMessage({ ...e.data }, () => { void chrome.runtime.lastError; });
  window.postMessage({ type: 'INKLINE_SIGN_ACK' }, window.location.origin);
});
