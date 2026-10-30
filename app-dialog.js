const nativeDialogs = {
  prompt: typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt.bind(window) : null,
  confirm: typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm.bind(window) : null,
  alert: typeof window !== 'undefined' && typeof window.alert === 'function' ? window.alert.bind(window) : null
};

const dialogState = {
  activeClickTarget: null,
  currentDialog: null,
  promptSessions: new WeakMap(),
  confirmWaiting: new WeakSet(),
  confirmBypassTarget: null
};

function ensureStyles() {
  if (document.getElementById('app-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'app-dialog-styles';
  style.textContent = `
    .app-dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 70000;
      display: grid;
      place-items: center;
      padding: 22px;
      background: rgba(9, 25, 39, .55);
      backdrop-filter: blur(5px);
      animation: app-dialog-fade .16s ease-out;
    }
    .app-dialog-card {
      width: min(520px, calc(100vw - 32px));
      max-height: min(720px, calc(100dvh - 40px));
      overflow: auto;
      border: 1px solid rgba(15, 65, 101, .12);
      border-radius: 18px;
      background: #fff;
      color: #102c43;
      box-shadow: 0 28px 80px rgba(3, 25, 43, .30);
      transform-origin: center;
      animation: app-dialog-pop .18s ease-out;
    }
    .app-dialog-header {
      display: flex;
      align-items: center;
      gap: 13px;
      padding: 20px 22px 15px;
      border-bottom: 1px solid #e7eef4;
    }
    .app-dialog-brand {
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      background: #f2f7fb;
      border: 1px solid #dce9f3;
      overflow: hidden;
    }
    .app-dialog-brand img { width: 34px; height: 34px; object-fit: contain; }
    .app-dialog-heading { min-width: 0; flex: 1; }
    .app-dialog-title { margin: 0; font-size: 18px; line-height: 1.25; font-weight: 800; color: #0f3552; }
    .app-dialog-kicker { margin-top: 3px; font-size: 11px; font-weight: 700; letter-spacing: .04em; color: #6d879b; text-transform: uppercase; }
    .app-dialog-close {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: #6d879b;
      cursor: pointer;
      font-size: 20px;
    }
    .app-dialog-close:hover { background: #eef5fa; color: #123f60; }
    .app-dialog-body { padding: 20px 22px 8px; }
    .app-dialog-message {
      margin: 0 0 16px;
      color: #526d82;
      font-size: 14px;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .app-dialog-field { display: grid; gap: 7px; margin-bottom: 14px; }
    .app-dialog-field label { font-size: 13px; font-weight: 750; color: #173d59; }
    .app-dialog-field input,
    .app-dialog-field textarea,
    .app-dialog-field select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #cddde9;
      border-radius: 10px;
      background: #fbfdff;
      color: #102c43;
      padding: 11px 12px;
      font: inherit;
      outline: none;
      transition: border-color .15s, box-shadow .15s, background .15s;
    }
    .app-dialog-field textarea { min-height: 105px; resize: vertical; }
    .app-dialog-field input:focus,
    .app-dialog-field textarea:focus,
    .app-dialog-field select:focus {
      border-color: #1e82ca;
      background: #fff;
      box-shadow: 0 0 0 3px rgba(30, 130, 202, .13);
    }
    .app-dialog-error {
      display: none;
      margin: -2px 0 12px;
      padding: 9px 11px;
      border-radius: 9px;
      background: #fff1f2;
      color: #b42332;
      font-size: 12px;
      font-weight: 650;
    }
    .app-dialog-error.visible { display: block; }
    .app-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 22px 20px;
    }
    .app-dialog-btn {
      min-width: 105px;
      border: 1px solid #cbdbe7;
      border-radius: 10px;
      padding: 10px 16px;
      font: inherit;
      font-size: 13px;
      font-weight: 750;
      cursor: pointer;
      background: #fff;
      color: #173d59;
    }
    .app-dialog-btn:hover { background: #f2f7fb; }
    .app-dialog-btn.primary { border-color: #1477bd; background: linear-gradient(135deg, #126fbd, #2698d1); color: #fff; box-shadow: 0 8px 18px rgba(21, 119, 189, .18); }
    .app-dialog-btn.primary:hover { filter: brightness(1.04); }
    .app-dialog-btn.danger { border-color: #e54855; background: #e54855; color: #fff; }
    .app-dialog-toast-zone {
      position: fixed;
      right: 20px;
      top: 104px;
      z-index: 71000;
      display: grid;
      gap: 10px;
      width: min(390px, calc(100vw - 40px));
      pointer-events: none;
    }
    .app-dialog-toast {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid #cfe2ef;
      background: rgba(255,255,255,.97);
      color: #173d59;
      box-shadow: 0 12px 32px rgba(13, 52, 79, .18);
      font-size: 13px;
      line-height: 1.4;
      pointer-events: auto;
      animation: app-dialog-pop .18s ease-out;
    }
    .app-dialog-toast i { color: #1f8bc8; margin-top: 2px; }
    .app-dialog-toast.success i { color: #1f9d68; }
    .app-dialog-toast.error i { color: #d64552; }
    body.dark-mode .app-dialog-card,
    body.dark-theme .app-dialog-card {
      background: #152735;
      color: #eef7fd;
      border-color: #345064;
    }
    body.dark-mode .app-dialog-header,
    body.dark-theme .app-dialog-header { border-color: #2b4355; }
    body.dark-mode .app-dialog-title,
    body.dark-theme .app-dialog-title,
    body.dark-mode .app-dialog-field label,
    body.dark-theme .app-dialog-field label { color: #eef7fd; }
    body.dark-mode .app-dialog-message,
    body.dark-theme .app-dialog-message { color: #a9bfce; }
    body.dark-mode .app-dialog-field input,
    body.dark-mode .app-dialog-field textarea,
    body.dark-mode .app-dialog-field select,
    body.dark-theme .app-dialog-field input,
    body.dark-theme .app-dialog-field textarea,
    body.dark-theme .app-dialog-field select { background: #10202c; border-color: #39576b; color: #eef7fd; }
    @keyframes app-dialog-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes app-dialog-pop { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
    @media (max-width: 620px) {
      .app-dialog-backdrop { padding: 12px; align-items: end; }
      .app-dialog-card { width: 100%; max-height: calc(100dvh - 24px); border-radius: 17px 17px 12px 12px; }
      .app-dialog-actions { flex-direction: column-reverse; }
      .app-dialog-btn { width: 100%; }
    }
  `;
  document.head.appendChild(style);
}

function derivePromptTitle(message = '') {
  const text = String(message).toLowerCase();
  if (text.includes('nom du problème')) return 'Ajouter ou modifier un problème';
  if (text.includes('description')) return 'Description du problème';
  if (text.includes('qr')) return 'Identifier un écran';
  if (text.includes('nouvelle salle')) return 'Ajouter une salle';
  if (text.includes('nouvelle baie')) return 'Ajouter une baie';
  if (text.includes('salle associée')) return 'Associer la baie à une salle';
  if (text.includes('nom du mur')) return "Modifier le mur d'images";
  if (text.includes("écran à lier") || text.includes("l'écran à lier")) return 'Lier un écran existant';
  return 'Saisie requise';
}

function deriveConfirmTitle(message = '') {
  const text = String(message).toLowerCase();
  if (text.includes('supprim')) return 'Confirmer la suppression';
  return 'Confirmation';
}

function closeDialog(value) {
  const active = dialogState.currentDialog;
  if (!active) return;
  dialogState.currentDialog = null;
  active.cleanup?.();
  active.overlay.remove();
  active.resolve(value);
}

function openFormDialog({ title, message = '', value = '', confirmText = 'Valider', cancelText = 'Annuler', danger = false, multiline = false }) {
  ensureStyles();
  if (dialogState.currentDialog) closeDialog(null);

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'app-dialog-backdrop';
    overlay.setAttribute('role', 'presentation');

    const card = document.createElement('section');
    card.className = 'app-dialog-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', title || '2M TECH Platform');

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
    h.textContent = title || '2M TECH Platform';
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
    if (message) {
      const text = document.createElement('p');
      text.className = 'app-dialog-message';
      text.textContent = String(message);
      body.appendChild(text);
    }

    let input = null;
    if (value !== undefined) {
      const field = document.createElement('div');
      field.className = 'app-dialog-field';
      const label = document.createElement('label');
      label.textContent = 'Valeur';
      input = multiline ? document.createElement('textarea') : document.createElement('input');
      if (!multiline) input.type = 'text';
      input.value = value == null ? '' : String(value);
      input.autocomplete = 'off';
      field.append(label, input);
      body.appendChild(field);
    }

    const error = document.createElement('div');
    error.className = 'app-dialog-error';
    body.appendChild(error);

    const actions = document.createElement('footer');
    actions.className = 'app-dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'app-dialog-btn';
    cancel.textContent = cancelText;
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = `app-dialog-btn ${danger ? 'danger' : 'primary'}`;
    submit.textContent = confirmText;
    actions.append(cancel, submit);
    card.append(header, body, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const onKeyDown = event => {
      if (event.key === 'Escape') closeDialog(null);
      if (event.key === 'Enter' && !multiline && document.activeElement === input) submit.click();
    };
    const cleanup = () => document.removeEventListener('keydown', onKeyDown, true);
    dialogState.currentDialog = { overlay, resolve, cleanup };
    document.addEventListener('keydown', onKeyDown, true);

    close.onclick = cancel.onclick = () => closeDialog(null);
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) closeDialog(null); });
    submit.onclick = () => closeDialog(input ? input.value : true);
    requestAnimationFrame(() => input?.focus());
  });
}

export function appPrompt(message, defaultValue = '') {
  const text = String(message ?? '');
  return openFormDialog({
    title: derivePromptTitle(text),
    message: text,
    value: defaultValue ?? '',
    confirmText: 'Continuer',
    multiline: text.toLowerCase().includes('description')
  });
}

export function appConfirm(message, { danger = true } = {}) {
  const text = String(message ?? 'Confirmer cette action ?');
  return openFormDialog({
    title: deriveConfirmTitle(text),
    message: text,
    value: undefined,
    confirmText: danger ? 'Confirmer' : 'Continuer',
    danger
  }).then(value => value === true);
}

export function appNotice(message, type = 'info') {
  ensureStyles();
  let zone = document.querySelector('.app-dialog-toast-zone');
  if (!zone) {
    zone = document.createElement('div');
    zone.className = 'app-dialog-toast-zone';
    document.body.appendChild(zone);
  }
  const toast = document.createElement('div');
  toast.className = `app-dialog-toast ${type}`;
  const icon = document.createElement('i');
  icon.className = `fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}`;
  const text = document.createElement('span');
  text.textContent = String(message ?? '');
  toast.append(icon, text);
  zone.prepend(toast);
  while (zone.children.length > 4) zone.lastElementChild?.remove();
  setTimeout(() => toast.remove(), 4200);
}

function replayClick(target, session = null) {
  if (!(target instanceof HTMLElement) || !target.isConnected) return;
  if (session) {
    session.cursor = 0;
    session.replaying = true;
  }
  try {
    target.click();
  } finally {
    if (session) {
      session.replaying = false;
      queueMicrotask(() => {
        if (!session.waiting && session.cursor === session.answers.length) dialogState.promptSessions.delete(target);
      });
    }
  }
}

function installNativeDialogBridge() {
  if (typeof window === 'undefined' || window.__appDialogBridgeInstalled) return;
  window.__appDialogBridgeInstalled = true;

  document.addEventListener('click', event => {
    const raw = event.target;
    const target = raw instanceof Element
      ? (raw.closest('button, a, [role="button"], input[type="button"], input[type="submit"]') || raw)
      : null;
    if (!(target instanceof HTMLElement) || target.closest('.app-dialog-card')) return;
    dialogState.activeClickTarget = target;
    queueMicrotask(() => {
      if (dialogState.activeClickTarget === target) dialogState.activeClickTarget = null;
    });
  }, true);

  window.prompt = function(message, defaultValue = '') {
    const target = dialogState.activeClickTarget;
    if (!(target instanceof HTMLElement) || !target.isConnected) {
      console.warn('[2M TECH] prompt natif appelé hors interaction cliquable; conservation du comportement natif.');
      return nativeDialogs.prompt ? nativeDialogs.prompt(message, defaultValue) : null;
    }

    let session = dialogState.promptSessions.get(target);
    if (!session) {
      session = { answers: [], cursor: 0, replaying: false, waiting: false };
      dialogState.promptSessions.set(target, session);
    }

    const index = session.cursor++;
    if (session.replaying && index < session.answers.length) return session.answers[index];
    if (session.waiting) return null;

    session.waiting = true;
    const initialValue = index < session.answers.length ? session.answers[index] : defaultValue;
    appPrompt(message, initialValue).then(value => {
      session.waiting = false;
      if (value === null) {
        dialogState.promptSessions.delete(target);
        return;
      }
      session.answers[index] = value;
      replayClick(target, session);
    });
    return null;
  };

  window.confirm = function(message) {
    const target = dialogState.activeClickTarget;
    if (dialogState.confirmBypassTarget && dialogState.confirmBypassTarget === target) return true;
    if (!(target instanceof HTMLElement) || !target.isConnected) {
      console.warn('[2M TECH] confirm natif appelé hors interaction cliquable; conservation du comportement natif.');
      return nativeDialogs.confirm ? nativeDialogs.confirm(message) : false;
    }
    if (dialogState.confirmWaiting.has(target)) return false;

    dialogState.confirmWaiting.add(target);
    appConfirm(message).then(accepted => {
      dialogState.confirmWaiting.delete(target);
      if (!accepted || !target.isConnected) return;
      dialogState.confirmBypassTarget = target;
      try { target.click(); }
      finally { dialogState.confirmBypassTarget = null; }
    });
    return false;
  };

  window.alert = function(message) {
    appNotice(message, /erreur|échec|impossible/i.test(String(message)) ? 'error' : /réussi|succès/i.test(String(message)) ? 'success' : 'info');
  };
}

if (typeof document !== 'undefined') {
  ensureStyles();
  installNativeDialogBridge();
}

if (typeof window !== 'undefined') {
  window.AppDialog = Object.freeze({ prompt: appPrompt, confirm: appConfirm, notice: appNotice });
}
