import './equipment-knowledge.js';
import './equipment-knowledge-extra.js';
import './routing-knowledge-seed.js';

// Correctif ciblé : la section Tickets historique était rendue sans mettre à jour
// le hash ni l'état visuel de la navigation. Aucun contrat métier n'est modifié.
document.addEventListener('click', event => {
  const link = event.target.closest('.sidebar-menu a[data-section="tickets"]');
  if (!link) return;

  queueMicrotask(() => {
    if (window.location.hash !== '#/tickets') window.location.hash = '#/tickets';
    document.querySelectorAll('.sidebar-menu a[data-section]').forEach(item => {
      item.classList.toggle('active', item.dataset.section === 'tickets');
    });
  });
}, true);
