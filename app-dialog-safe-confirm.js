// Runtime guard: confirmation dialogs must never expose a text-input field.
// This module intentionally overrides only AppDialog.confirm. Prompts keep their
// existing input behaviour.

function ensureSafeConfirmStyles() {
  if (document.getElementById('app-dialog-safe-confirm-styles')) return;
  const style = document.createElement('style');
  style.id = 'app-dialog-safe-confirm-styles';
  style.textContent = `
    .app-dialog-safe-confirm .app-dialog-body { padding-bottom: 10px; }
    .app-dialog-safe-confirm .app-dialog-message { margin-bottom: 0; }
  `;
  document.head.appendChild(style);
}

function closeExistingDialog() {
  document.querySelectorAll('.app-dialog-backdrop').forEach(node => node.remove());
}

export function safeConfirm(message, { danger = true } = {}) {
  ensureSafeConfirmStyles();
  closeExistingDialog();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'app-dialog-backdrop app-dialog-safe-confirm';
    overlay.setAttribute('role', 'presentation');

    const card = document.createElement('section');
    card.className = 'app-dialog-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Confirmation');

    const header = document.createElement('header');
    header.className = 'app-dialog-header';
    const brand = document.createElement('div');
    brand.className = 'app-dialog-brand';
    const logo = document.createElement('img');
    logo.src = 'images/2m-logo.webp';
    logo.alt = '2M';
    brand.appendChild(logo);
    const heading = document.createElement('div');
    heading.className = 'app-dialog-heading';
    const h = document.createElement('h2');
    h.className = 'app-dialog-title';
    h.textContent = String(message || '').toLowerCase().includes('supprim') ? 'Confirmer la suppression' : 'Confirmation';
    const kicker = document.createElement('div');
    kicker.className = 'app-dialog-kicker';
    kicker.textContent = '2M TECH Platform';
    heading.append(h, kicker);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'app-dialog-close';
    close.setAttribute('aria-label', 'Fermer');
    close.textContent = '×';
    header.append(brand, heading, close);

    const body = document.createElement('div');
    body.className = 'app-dialog-body';
    const text = document.createElement('p');
    text.className = 'app-dialog-message';
    text.textContent = String(message || 'Confirmer cette action ?');
    body.appendChild(text);

    const actions = document.createElement('footer');
    actions.className = 'app-dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'app-dialog-btn';
    cancel.textContent = 'Annuler';
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = `app-dialog-btn ${danger ? 'danger' : 'primary'}`;
    submit.textContent = 'Confirmer';
    actions.append(cancel, submit);
    card.append(header, body, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const finish = value => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') finish(false);
      if (event.key === 'Enter') finish(true);
    };
    document.addEventListener('keydown', onKeyDown, true);
    close.onclick = cancel.onclick = () => finish(false);
    submit.onclick = () => finish(true);
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) finish(false); });
    requestAnimationFrame(() => submit.focus());
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const previous = window.AppDialog || {};
  window.AppDialog = Object.freeze({ ...previous, confirm: safeConfirm });
  window.__APP_DIALOG_CONFIRM_NO_VALUE__ = true;
}
