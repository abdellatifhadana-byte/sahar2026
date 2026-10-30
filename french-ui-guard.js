import './db-migration-v15.js';

const exactTranslations = new Map([
  ['Dashboard', 'Tableau de bord'],
  ['Backup', 'Sauvegarde'],
  ['Backup créé avec succès', 'Sauvegarde créée avec succès'],
  ['Backup restored!', 'Sauvegarde restaurée.'],
  ['Tickets Support', 'Tickets support'],
  ['Charting library (Chart.js) not loaded. Please ensure it is included for data visualization.', 'Bibliothèque de graphiques indisponible.'],
  ['تعديل', 'Modifier'],
  ['حذف', 'Supprimer'],
  ['حفظ', 'Enregistrer'],
  ['إلغاء', 'Annuler'],
  ['رجوع', 'Retour'],
  ['إضافة', 'Ajouter'],
  ['غرفة', 'Salle'],
  ['خزانة', 'Baie'],
  ['معدات', 'Équipement'],
  ['الشاشات بالغرف', 'Écrans par salle'],
  ['ابدأ الآن', 'Ouvrir']
]);

function translateValue(value) {
  const source = String(value ?? '');
  const trimmed = source.trim();
  if (exactTranslations.has(trimmed)) return source.replace(trimmed, exactTranslations.get(trimmed));
  if (trimmed.startsWith('Backup failed:')) return source.replace(trimmed, `Échec de la sauvegarde :${trimmed.slice('Backup failed:'.length)}`);
  return value;
}

function translateNode(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const translated = translateValue(root.nodeValue);
    if (translated !== root.nodeValue) root.nodeValue = translated;
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    for (const attribute of ['title', 'placeholder', 'aria-label']) {
      if (!root.hasAttribute(attribute)) continue;
      const original = root.getAttribute(attribute);
      const translated = translateValue(original);
      if (translated !== original) root.setAttribute(attribute, translated);
    }
  }
  for (const child of root.childNodes) translateNode(child);
}

function syncAdminNavigation() {
  const section = decodeURIComponent((window.location.hash || '#/dashboard').replace(/^#\/?/, '').split(/[/?]/)[0] || 'dashboard');
  document.querySelectorAll('.admin-sidebar .sidebar-menu a[data-section]').forEach(link => {
    const active = link.dataset.section === section;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function applyUiGuards(root = document.body) {
  translateNode(root);
  syncAdminNavigation();
}

document.documentElement.lang = 'fr';
document.documentElement.dir = 'ltr';
applyUiGuards(document.body);

window.addEventListener('hashchange', syncAdminNavigation);
window.addEventListener('popstate', syncAdminNavigation);

let guardScheduled = false;
function scheduleUiGuards() {
  if (guardScheduled) return;
  guardScheduled = true;
  queueMicrotask(() => {
    guardScheduled = false;
    applyUiGuards(document.body);
  });
}

new MutationObserver(mutations => {
  for (const mutation of mutations) {
    if (mutation.type === 'characterData') translateNode(mutation.target);
    else if (mutation.type === 'attributes') translateNode(mutation.target);
    else for (const node of mutation.addedNodes) translateNode(node);
  }
  scheduleUiGuards();
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['title', 'placeholder', 'aria-label']
});
