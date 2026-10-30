import FieldEvidenceInbox from './field-evidence-intake.js';

const BUTTON_ID = 'field-evidence-intake-open';
const MODAL_ID = 'field-evidence-intake-modal';

function isAdminLayout() {
  return Boolean(document.querySelector('.admin-page .admin-header'));
}

async function openFieldEvidenceInbox() {
  if (document.getElementById(MODAL_ID)) return;
  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10080;background:rgba(4,18,28,.72);display:flex;align-items:center;justify-content:center;padding:18px;';
  modal.innerHTML = `<div class="modal-content" style="width:min(1180px,96vw);max-height:92vh;overflow:auto;background:var(--surface,#fff);border-radius:16px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.28)"><div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button type="button" class="btn gray" data-field-intake-close><i class="fas fa-times"></i> Fermer</button></div><div data-field-intake-host><div class="loading-spinner"><div class="spinner"></div><p>Chargement des preuves terrain…</p></div></div></div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.querySelector('[data-field-intake-close]')?.addEventListener('click', close);
  const inbox = new FieldEvidenceInbox();
  const host = modal.querySelector('[data-field-intake-host]');
  try {
    host.innerHTML = await inbox.render();
    await inbox.afterRender();
  } catch (error) {
    host.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i><h3>Inbox terrain indisponible</h3><p>${String(error?.message || error)}</p></div>`;
  }
}

function installAdminButton() {
  if (!isAdminLayout() || document.getElementById(BUTTON_ID)) return false;
  const headerRight = document.querySelector('.admin-page .admin-header .header-right');
  if (!headerRight) return false;
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.className = 'btn';
  button.title = 'Inbox des preuves terrain';
  button.innerHTML = '<i class="fas fa-camera-retro"></i> Preuves terrain';
  button.addEventListener('click', openFieldEvidenceInbox);
  const mapButton = headerRight.querySelector('#open-map-btn');
  if (mapButton?.nextSibling) headerRight.insertBefore(button, mapButton.nextSibling);
  else headerRight.prepend(button);
  return true;
}

function scheduleInstall() {
  queueMicrotask(installAdminButton);
  setTimeout(installAdminButton, 250);
  setTimeout(installAdminButton, 900);
}

function installObserver() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const app = document.getElementById('app');
  if (!app || app.dataset.fieldEvidenceIntakeUiObserver === '1') return;
  app.dataset.fieldEvidenceIntakeUiObserver = '1';
  new MutationObserver(() => scheduleInstall()).observe(app, { childList:true, subtree:true });
  scheduleInstall();
}

if (typeof window !== 'undefined') {
  window.FieldEvidenceIntakeUI = Object.freeze({ open:openFieldEvidenceInbox, install:installAdminButton });
  installObserver();
  window.addEventListener('hashchange', scheduleInstall);
}
