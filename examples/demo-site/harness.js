// Cases harness: renders one JSON case (cases/<name>.json) through the demo app's real formatter.
// Opened as harness.html?case=<name>. Sets body[data-ready="1"] once the case is rendered.
(async () => {
  const root = document.getElementById('case-root');
  const title = document.getElementById('case-title');
  const name = new URLSearchParams(location.search).get('case') || '';
  try {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad case name "${name}"`);
    const res = await fetch(`cases/${name}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`cases/${name}.json: HTTP ${res.status}`);
    const json = await res.json();
    title.textContent = json.title ?? name;
    root.innerHTML = window.formatText(json.input ?? '');
    document.title = `${json.title ?? name} · Formatter case`;
    document.body.dataset.ready = '1';
  } catch (err) {
    title.textContent = 'Formatter case error';
    root.innerHTML = `<p class="case-error">${String(err.message ?? err).replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c])}</p>`;
    document.body.dataset.error = String(err.message ?? err);
  }
})();
