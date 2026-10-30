const fold = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

function inferSearchKind(select) {
  if (!(select instanceof HTMLSelectElement)) return '';
  if (select.dataset.entitySearch) return select.dataset.entitySearch;
  if (select.id === 'eq-roomId' || select.id === 'filter-room' || select.id === 'filter-salle' || select.name === 'roomId') return 'room';
  if (select.id === 'eq-baieId' || select.name === 'baieId') return 'baie';
  if (select.name === 'relatedId') {
    const relatedType = select.closest('form')?.elements?.relatedType?.value || document.getElementById('related-type')?.value || '';
    if (['equipment','room','baie','screen'].includes(relatedType)) return relatedType;
  }
  return '';
}

function labelFor(select) {
  const kind = select.dataset.entitySearch || inferSearchKind(select) || 'élément';
  return ({ room:'salle', baie:'baie', equipment:'équipement', screen:'écran' })[kind] || kind;
}

function ensureStyles() {
  if (document.getElementById('entity-select-search-style')) return;
  const style = document.createElement('style');
  style.id = 'entity-select-search-style';
  style.textContent = `
    .entity-search-select{display:grid;gap:6px;min-width:180px;align-items:start}
    .entity-search-select>input[type="search"]{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cfd7df;border-radius:8px;background:var(--surface,#fff);color:inherit}
    .entity-search-select>select{width:100%;box-sizing:border-box}
    .entity-search-select.is-filtering>select{min-height:42px}
    .entity-search-select-status{font-size:12px;color:#667085;min-height:1em}
  `;
  document.head.appendChild(style);
}

export function enhanceEntitySelect(select) {
  if (!(select instanceof HTMLSelectElement)) return select;
  if (select.dataset.entitySearchEnhanced === '1') return select;
  const kind = inferSearchKind(select);
  if (!kind) return select;
  if (!select.dataset.entitySearch) select.dataset.entitySearch = kind;
  select.dataset.entitySearchEnhanced = '1';
  ensureStyles();

  const wrapper = document.createElement('div');
  wrapper.className = 'entity-search-select';
  select.parentNode?.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const search = document.createElement('input');
  search.type = 'search';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.className = 'entity-search-input';
  search.placeholder = select.dataset.entitySearchPlaceholder || `Rechercher ${labelFor(select)}…`;
  search.setAttribute('aria-label', search.placeholder);
  wrapper.insertBefore(search, select);

  const status = document.createElement('small');
  status.className = 'entity-search-select-status';
  status.setAttribute('aria-live', 'polite');
  wrapper.appendChild(status);

  const allOptions = () => Array.from(select.options);
  const apply = () => {
    const query = fold(search.value);
    let matches = 0;
    const tokens = query.split(' ').filter(Boolean);
    for (const option of allOptions()) {
      if (!option.value) {
        option.hidden = false;
        continue;
      }
      const haystack = fold(`${option.textContent || ''} ${option.value}`);
      const visible = !query || tokens.every(token => haystack.includes(token)) || option.selected;
      option.hidden = !visible;
      if (visible) matches += 1;
    }
    wrapper.classList.toggle('is-filtering', Boolean(query));
    if (query) {
      select.size = Math.min(8, Math.max(2, matches + 1));
      status.textContent = matches ? `${matches} résultat${matches > 1 ? 's' : ''}` : 'Aucun résultat';
    } else {
      select.size = 1;
      status.textContent = '';
    }
  };

  search.addEventListener('input', apply);
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      select.focus();
    }
    if (event.key === 'Escape') {
      search.value = '';
      apply();
      search.blur();
    }
  });
  select.addEventListener('change', () => {
    search.value = '';
    apply();
  });
  select.addEventListener('blur', () => {
    if (!search.value) select.size = 1;
  });

  select.__entitySearchApply = apply;
  apply();
  return select;
}

function refreshRelatedEntitySelect(typeSelect) {
  const form = typeSelect.closest('form');
  const target = form?.elements?.relatedId || document.querySelector('select[name="relatedId"]');
  if (!(target instanceof HTMLSelectElement)) return;
  const kind = typeSelect.value;
  if (!['equipment','room','baie','screen'].includes(kind)) return;
  target.dataset.entitySearch = kind;
  if (target.dataset.entitySearchEnhanced !== '1') enhanceEntitySelect(target);
  const wrapper = target.closest('.entity-search-select');
  const input = wrapper?.querySelector('.entity-search-input');
  if (input) {
    input.value = '';
    input.placeholder = `Rechercher ${labelFor(target)}…`;
    input.setAttribute('aria-label', input.placeholder);
  }
  target.__entitySearchApply?.();
}

export function enhanceEntitySelects(root = document) {
  if (root instanceof HTMLSelectElement) enhanceEntitySelect(root);
  root.querySelectorAll?.('select').forEach(enhanceEntitySelect);
}

function boot() {
  enhanceEntitySelects(document);
  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.name === 'relatedType' || target.id === 'related-type') {
      setTimeout(() => refreshRelatedEntitySelect(target), 0);
    }
  });
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        enhanceEntitySelects(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  globalThis.__entitySelectSearchObserver = observer;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
}
