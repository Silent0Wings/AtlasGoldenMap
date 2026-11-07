// Demo Shop: just enough behaviour to exercise Golden Map Atlas (theme key, signed-in fixture, list, dialog, tabs).
const $ = id => document.getElementById(id);
const theme = localStorage.getItem('demo-theme');
if (theme) document.documentElement.dataset.theme = theme;

const user = JSON.parse(localStorage.getItem('demo-user') || 'null');
if (user && $('user')) $('user').textContent = `Signed in as ${user.name} · cart ${user.cart}`;

const PRODUCTS = [
  { name: 'Desk', price: 320, tag: 'Furniture', stock: 'In stock' },
  { name: 'Chair', price: 180, tag: 'Furniture', stock: 'Low stock' },
  { name: 'Monitor', price: 240, tag: 'Electronics', stock: 'In stock' },
  { name: 'Keyboard', price: 90, tag: 'Electronics', stock: 'Sold out' },
  { name: 'Plant', price: 25, tag: 'Decor', stock: 'In stock' },
];
if ($('grid')) {
  const render = q => {
    $('grid').innerHTML = PRODUCTS.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).map(p => `
      <div class="product"><h3>${p.name}</h3><span class="badge">${p.tag}</span>
        <p class="price">$${p.price}</p><span class="badge stock">${p.stock}</span></div>`).join('');
  };
  render('');
  $('search').addEventListener('input', e => render(e.target.value));
  $('newBtn').addEventListener('click', () => $('newDialog').showModal());
  $('clock').textContent = new Date().toLocaleString('en-US', { timeZone: 'UTC' });   // masked in the atlas
}

for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('[role=tab]')) {
      t.setAttribute('aria-selected', t === tab);
      $(`tab-${t.dataset.tab}`).hidden = t !== tab;
    }
  });
}
if ($('saveBtn')) {
  $('themeSelect').value = theme || '';
  $('saveBtn').addEventListener('click', () => {
    const v = $('themeSelect').value;
    if (v) localStorage.setItem('demo-theme', v); else localStorage.removeItem('demo-theme');
    $('saved').hidden = false;
  });
}

// Tiny markdown-ish formatter (used by the cases harness). Escapes HTML first, then applies the markup:
// **bold**, *italic*, `code`, [text](url) (no javascript: or other schemes), "- " lists and "| a | b |" tables (second line is a |---|---| separator).
// Anything else (headings, quotes, strikethrough, images) is left as literal text.
window.formatText = function formatText(src) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Decide by the protocol the URL parser actually yields (it strips leading C0/space chars, so "\x01javascript:" is caught).
  // Relative URLs resolve against the dummy base and come out as http:.
  const isSafeLink = url => { try { const p = new URL(url, 'http://x').protocol; return p === 'http:' || p === 'https:'; } catch { return false; } };
  const inline = s => esc(s).split(/(`[^`]+`)/).map((part, i) => {
    if (i % 2) return `<code>${part.slice(1, -1)}</code>`;   // code spans keep their text untouched
    return part
      .replace(/(!?)\[([^\]]+)\]\(([^)\s]+)\)/g, (m, bang, text, url) => (!bang && isSafeLink(url))
        ? `<a href="${url}">${text}</a>` : m)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }).join('');
  const isList = l => /^\s*-\s+/.test(l);
  const isSep = l => l.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && isSep(lines[i + 1]);
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (isList(line)) {
      const items = [];
      while (i < lines.length && isList(lines[i])) items.push(lines[i++].replace(/^\s*-\s+/, ''));
      out.push(`<ul>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = cells(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isList(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
};
