/**
 * tooltip.js — instant tooltips for the panel, review and graph pages: put data-tip="text" on any element.
 * Shows on hover, keyboard focus and touch; Esc hides it. The text is read live, so pages can change it at any time.
 * Served by control-server and review-server, and inlined into dashboard.html by build-dashboard.
 */
(() => {
  const DELAY = 120, GAP = 8, EDGE = 8, TOUCH_MS = 4000;

  const css = document.createElement('style');
  css.textContent = `
    #atlas-tip { position: fixed; inset: auto; margin: 0; display: none; max-width: min(300px, calc(100vw - 16px)); padding: 8px 11px;
      background: var(--panel); color: var(--text); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px;
      box-shadow: var(--shadow, 0 4px 16px rgb(0 0 0 / .18));
      font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; text-align: left; white-space: normal; overflow-wrap: anywhere;
      pointer-events: none; z-index: 2147483647; }
    [data-tip]:not(button, a, input, select, summary, label) { cursor: help; }`;
  document.head.append(css);

  const box = document.createElement('div');
  box.id = 'atlas-tip';
  box.setAttribute('role', 'tooltip');
  if ('popover' in box) box.popover = 'manual';   // the top layer: otherwise a modal <dialog> would cover it
  document.documentElement.append(box);

  let target = null, showT = 0, hideT = 0;

  function place() {
    const r = target.getBoundingClientRect(), b = box.getBoundingClientRect();
    const above = r.top - b.height - GAP;
    const top = above >= EDGE ? above : Math.min(r.bottom + GAP, innerHeight - b.height - EDGE);
    const left = Math.max(EDGE, Math.min(r.left + r.width / 2 - b.width / 2, innerWidth - b.width - EDGE));
    box.style.top = `${Math.round(top)}px`;
    box.style.left = `${Math.round(left)}px`;
  }

  function hide() {
    clearTimeout(showT); clearTimeout(hideT);
    if (!target) return;
    target.removeAttribute('aria-describedby');
    target = null;
    try { box.hidePopover?.(); } catch {}
    box.style.display = 'none';
  }

  function show(el) {
    clearTimeout(showT); clearTimeout(hideT);
    if (!el.isConnected || !el.dataset.tip) return hide();
    hide();
    target = el;
    box.textContent = el.dataset.tip;
    box.style.display = 'block';
    try { box.showPopover?.(); } catch {}
    el.setAttribute('aria-describedby', box.id);
    place();
  }

  const tipOf = e => e.target instanceof Element ? e.target.closest('[data-tip]') : null;

  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const el = tipOf(e);
    if (el === target) return;
    clearTimeout(showT);
    if (!el) return hide();
    showT = setTimeout(() => show(el), DELAY);
  });
  document.documentElement.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') hide(); });   // a lifted finger "leaves" too
  document.addEventListener('pointerdown', e => {
    hide();
    if (e.pointerType !== 'touch') return;
    const el = tipOf(e);
    if (el) { show(el); hideT = setTimeout(hide, TOUCH_MS); }
  });
  document.addEventListener('focusin', e => { const el = tipOf(e); if (el && e.target.matches(':focus-visible')) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('input', hide);   // never in the way of what is being typed
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  addEventListener('scroll', hide, true);
  addEventListener('resize', hide);

  // pages re-render while a tip is open: follow the text, drop the tip if its element went away
  setInterval(() => {
    if (!target) return;
    if (!target.isConnected || !target.dataset.tip) return hide();
    if (box.textContent !== target.dataset.tip) { box.textContent = target.dataset.tip; place(); }
  }, 250);
})();
