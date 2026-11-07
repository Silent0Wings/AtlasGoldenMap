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
