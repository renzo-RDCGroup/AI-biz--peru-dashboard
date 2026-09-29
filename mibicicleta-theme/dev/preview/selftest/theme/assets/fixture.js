// Minimal stand-in for theme JS so shoot.mjs interaction states can be verified end to end.
(() => {
  const openDrawer = (id) => { const d = document.getElementById(id); if (d) d.setAttribute('open', ''); };
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-drawer-open]');
    if (opener) { e.preventDefault(); openDrawer(opener.getAttribute('data-drawer-open')); }
  });
  document.addEventListener('cart:open', () => openDrawer('CartDrawer'));
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.matches('form[action="/cart/add"]')) return;
    e.preventDefault();
    const fd = new FormData(form);
    fd.append('sections', 'cart-drawer');
    fd.append('sections_url', location.pathname);
    const res = await fetch('/cart/add', { method: 'POST', body: fd, headers: { Accept: 'application/javascript', 'X-Requested-With': 'XMLHttpRequest' } });
    const data = await res.json();
    if (!res.ok) { console.error(data.description); return; }
    const doc = new DOMParser().parseFromString(data.sections['cart-drawer'], 'text/html');
    document.getElementById('shopify-section-cart-drawer').innerHTML = doc.getElementById('shopify-section-cart-drawer').innerHTML;
    openDrawer('CartDrawer');
  });
  const input = document.querySelector('predictive-search input[name="q"]');
  if (input) {
    input.addEventListener('input', async () => {
      const q = input.value.trim();
      if (!q) return;
      const res = await fetch(`/search/suggest?q=${encodeURIComponent(q)}&resources[type]=product,collection,query&resources[limit]=4&section_id=predictive-search`);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const box = document.querySelector('predictive-search [data-results]');
      box.innerHTML = doc.getElementById('shopify-section-predictive-search').innerHTML;
      box.setAttribute('role', 'listbox');
    });
  }
  document.addEventListener('change', (e) => {
    const r = e.target.closest('variant-picker input[type="radio"]');
    if (!r) return;
    const url = new URL(location.href);
    url.searchParams.set('variant', r.dataset.variantId);
    history.replaceState({}, '', url);
  });
})();
