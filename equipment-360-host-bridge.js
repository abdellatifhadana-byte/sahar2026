import './phase11-field-pack-migration.js';
import './field-evidence-integration.js';
import './equipment-field-evidence-phase12.js';
import './grille-centrale-physical-architecture.js';
import './grille-centrale-documented-map.js';
import './grille-centrale-field-verification.js';
import './field-evidence-intake.js';
import './field-evidence-intake-ui.js';
import './regie-car-inventory-phase16.js';
import './regie-car-prephoto-readiness.js';

// operations-suite crée la fiche 360 directement sous document.body tandis que
// les enrichisseurs historiques observent #app. Ce pont garantit qu'une fiche
// ouverte depuis le nom d'un équipement traverse toujours les observateurs
// Catalogue/Ports, Photos & média, preuves terrain 2M, architecture physique,
// plan documenté des ports/câbles et checklist as-built. Les modules d'intake
// générique sont également chargés ici afin que les futurs lots terrain soient
// revus avant toute promotion vers l'inventaire ou la topologie. Phase 16 ajoute
// uniquement les faits Régie Car déjà soutenus par les photos, sans reset ni
// remplacement de l'inventaire opérationnel existant. Phase 17 prépare les
// prochaines captures, les lacunes à lever et les sources constructeur sans
// transformer une attente de photo en port, câble, topologie ou crosspoint.

function moveIntoObservedApp(modal) {
  if (!modal || modal.id !== 'ops-equipment-360') return false;
  const app = document.getElementById('app');
  if (!app || modal.parentElement === app) return false;
  app.appendChild(modal);
  modal.dataset.observerBridge = 'app';
  return true;
}

function installEquipment360HostBridge() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body) return;
  if (document.body.dataset.equipment360HostBridge === '1') return;
  document.body.dataset.equipment360HostBridge = '1';

  const existing = document.getElementById('ops-equipment-360');
  if (existing) moveIntoObservedApp(existing);

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        const modal = node.id === 'ops-equipment-360' ? node : node.querySelector?.('#ops-equipment-360');
        if (modal) queueMicrotask(() => moveIntoObservedApp(modal));
      }
    }
  });
  observer.observe(document.body, { childList:true, subtree:false });
}

if (typeof window !== 'undefined') {
  installEquipment360HostBridge();
  window.Equipment360HostBridge = Object.freeze({ install:installEquipment360HostBridge, move:moveIntoObservedApp });
}