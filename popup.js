const $ = (id) => document.getElementById(id);
chrome.storage.local.get({ enabled: true, receipts: [], lastSign: null }, ({ enabled, receipts, lastSign }) => {
  if (lastSign) $('last').textContent = lastSign.ok ? '✓ Last send: Touch ID verified' : `⚠ Last send not signed: ${lastSign.error}`;
  $('enabled').checked = enabled !== false;
  $('count').textContent = receipts.length;
  $('minutes').textContent = receipts.reduce((a, r) => a + (r.minutes || 0), 0);
  const ul = $('recent');
  if (!receipts.length) { ul.innerHTML = '<li class="empty">No receipts yet — send an email and confirm with Touch ID.</li>'; return; }
  for (const r of receipts.slice(0, 6)) {
    const li = document.createElement('li');
    li.textContent = `✓ ${r.text}`;
    if (r.url) { const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.textContent = ' receipt ↗'; a.style.color = '#2563eb'; li.appendChild(a); }
    const s = document.createElement('small');
    s.textContent = `${new Date(r.at).toLocaleString()} · ${r.finalLen} chars · ${Math.round(r.pasteRatio * 100)}% pasted`;
    li.appendChild(s);
    ul.appendChild(li);
  }
});
$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
