const STORAGE_KEY = '2mtech-equipment-visible-columns-v1';
const CORE_COLUMNS = new Set(['Nom','Statut','Salle','Actions']);

function parseVisibility(headers) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return new Set(saved);
  } catch {}
  if (window.matchMedia?.('(max-width: 760px)').matches) {
    return new Set(['Nom','Type','Marque','Modèle','Numéro de série','Statut','Salle','Rack','Actions']);
  }
  return new Set(headers);
}

function storeVisibility(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

function equipmentTableCandidate(table) {
  if (!table || table.dataset.equipmentRuntime === '1') return false;
  const headers = [...table.querySelectorAll('tr:first-child th')].map(th => th.textContent.trim());
  return headers.includes('Nom') && headers.includes('Numéro de série') && headers.includes('N° Grille IN/OUT') && table.querySelector('.eq-quickview');
}

function applyVisibility(table, headers, visible) {
  const rows = [...table.rows];
  headers.forEach((label, index) => {
    const show = visible.has(label) || CORE_COLUMNS.has(label);
    rows.forEach(row => {
      const cell = row.cells[index];
      if (cell) cell.style.display = show ? '' : 'none';
    });
  });
  table.dispatchEvent(new CustomEvent('equipment-columns-changed'));
}

function installColumnControl(table, headers, visible) {
  const card = table.closest('.card') || table.parentElement;
  const actions = card?.querySelector('.card-header .card-actions');
  if (!actions || actions.querySelector('[data-equipment-columns]')) return;

  const control = document.createElement('div');
  control.className = 'equipment-columns-control';
  control.dataset.equipmentColumns = '1';
  control.innerHTML = `
    <button type="button" class="btn gray equipment-columns-toggle" title="Choisir les colonnes visibles"><i class="fas fa-columns"></i> Colonnes</button>
    <div class="equipment-columns-panel" role="dialog" aria-label="Colonnes du tableau des équipements">
      <header><strong>Colonnes visibles</strong><small>${headers.length} colonnes disponibles</small></header>
      <div class="equipment-columns-grid"></div>
      <div class="equipment-columns-actions"><button type="button" class="btn gray" data-columns-all>Tout afficher</button><button type="button" class="btn gray" data-columns-reset>Réinitialiser</button></div>
    </div>`;
  actions.appendChild(control);

  const panel = control.querySelector('.equipment-columns-panel');
  const grid = control.querySelector('.equipment-columns-grid');
  const renderChecks = () => {
    grid.innerHTML = headers.map((label, index) => {
      const locked = CORE_COLUMNS.has(label);
      return `<label><input type="checkbox" data-column-index="${index}" ${visible.has(label) || locked ? 'checked' : ''} ${locked ? 'disabled' : ''}> <span>${label}</span></label>`;
    }).join('');
    grid.querySelectorAll('input:not(:disabled)').forEach(input => {
      input.onchange = () => {
        const label = headers[Number(input.dataset.columnIndex)];
        if (input.checked) visible.add(label); else visible.delete(label);
        storeVisibility(visible);
        applyVisibility(table, headers, visible);
      };
    });
  };
  renderChecks();

  control.querySelector('.equipment-columns-toggle').onclick = event => {
    event.stopPropagation();
    panel.classList.toggle('is-open');
  };
  control.querySelector('[data-columns-all]').onclick = () => {
    headers.forEach(label => visible.add(label));
    storeVisibility(visible); renderChecks(); applyVisibility(table, headers, visible);
  };
  control.querySelector('[data-columns-reset]').onclick = () => {
    localStorage.removeItem(STORAGE_KEY);
    visible.clear();
    parseVisibility(headers).forEach(label => visible.add(label));
    renderChecks(); applyVisibility(table, headers, visible);
  };
  document.addEventListener('click', event => {
    if (!control.contains(event.target)) panel.classList.remove('is-open');
  }, { passive:true });
}

function installScrollMirror(table) {
  const originalWrapper = table.parentElement;
  if (!originalWrapper || originalWrapper.dataset.equipmentScroll === '1') return;
  originalWrapper.dataset.equipmentScroll = '1';
  originalWrapper.classList.add('equipment-table-scroll');

  const shell = document.createElement('div');
  shell.className = 'equipment-table-shell';
  originalWrapper.parentNode.insertBefore(shell, originalWrapper);
  shell.appendChild(originalWrapper);

  const hint = document.createElement('div');
  hint.className = 'equipment-table-hint';
  hint.innerHTML = '<i class="fas fa-arrows-alt-h"></i> Toutes les colonnes restent accessibles : faites défiler horizontalement ou utilisez « Colonnes ».';
  shell.insertBefore(hint, originalWrapper);

  const top = document.createElement('div');
  top.className = 'equipment-table-top-scroll';
  top.setAttribute('aria-label', 'Défilement horizontal du tableau');
  top.innerHTML = '<div></div>';
  shell.insertBefore(top, originalWrapper);

  const spacer = top.firstElementChild;
  let syncing = false;
  const syncWidth = () => { spacer.style.width = `${table.scrollWidth}px`; };
  top.addEventListener('scroll', () => { if (syncing) return; syncing = true; originalWrapper.scrollLeft = top.scrollLeft; syncing = false; });
  originalWrapper.addEventListener('scroll', () => { if (syncing) return; syncing = true; top.scrollLeft = originalWrapper.scrollLeft; syncing = false; });
  table.addEventListener('equipment-columns-changed', () => requestAnimationFrame(syncWidth));
  new ResizeObserver(syncWidth).observe(table);
  requestAnimationFrame(syncWidth);
}

function enhance(table) {
  if (!equipmentTableCandidate(table)) return;
  table.dataset.equipmentRuntime = '1';
  table.classList.add('equipment-table-runtime');
  const headers = [...table.querySelectorAll('tr:first-child th')].map(th => th.textContent.trim());
  const visible = parseVisibility(headers);
  CORE_COLUMNS.forEach(label => visible.add(label));
  applyVisibility(table, headers, visible);
  installScrollMirror(table);
  installColumnControl(table, headers, visible);
}

function scan(root = document) {
  root.querySelectorAll?.('table.tableau').forEach(enhance);
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) if (node.nodeType === 1) scan(node.matches?.('table.tableau') ? node.parentElement : node);
  }
});

if (typeof document !== 'undefined') {
  scan();
  observer.observe(document.documentElement, { childList:true, subtree:true });
}

if (typeof window !== 'undefined') window.EquipmentTableRuntime = Object.freeze({ scan, storageKey:STORAGE_KEY });
