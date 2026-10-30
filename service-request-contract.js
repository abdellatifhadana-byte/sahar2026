export const REQUEST_KINDS = Object.freeze({
  incident: Object.freeze({
    label: 'Incident / Panne',
    shortLabel: 'Incident',
    icon: 'fa-triangle-exclamation',
    category: 'panne',
    defaultPriority: 'haute',
    descriptionHint: "Décrivez le symptôme, l'impact antenne et les premières vérifications.",
    fields: Object.freeze([
      Object.freeze({ key: 'impact', label: 'Impact observé', type: 'select', required: true, options: Object.freeze(['Aucun impact antenne', 'Service dégradé', 'Service interrompu', 'Impact inconnu']) }),
      Object.freeze({ key: 'startedAt', label: 'Début observé', type: 'datetime-local' }),
      Object.freeze({ key: 'firstChecks', label: 'Vérifications déjà effectuées', type: 'textarea', maxLength: 1200 })
    ])
  }),
  service: Object.freeze({
    label: 'Demande de service',
    shortLabel: 'Service',
    icon: 'fa-handshake-angle',
    category: 'service',
    defaultPriority: 'moyenne',
    descriptionHint: 'Précisez le service attendu et le résultat à livrer.',
    fields: Object.freeze([
      Object.freeze({ key: 'serviceName', label: 'Service demandé', type: 'text', required: true, maxLength: 180 }),
      Object.freeze({ key: 'neededAt', label: 'Date / heure souhaitée', type: 'datetime-local' }),
      Object.freeze({ key: 'constraints', label: 'Contraintes opérationnelles', type: 'textarea', maxLength: 1200 })
    ])
  }),
  information: Object.freeze({
    label: "Demande d'information",
    shortLabel: 'Information',
    icon: 'fa-circle-question',
    category: 'information',
    defaultPriority: 'basse',
    descriptionHint: 'Formulez la question et indiquez pourquoi cette information est nécessaire.',
    fields: Object.freeze([
      Object.freeze({ key: 'question', label: 'Information recherchée', type: 'textarea', required: true, maxLength: 1600 }),
      Object.freeze({ key: 'neededAt', label: 'Réponse souhaitée avant', type: 'datetime-local' }),
      Object.freeze({ key: 'usage', label: "Contexte d'utilisation", type: 'text', maxLength: 240 })
    ])
  }),
  'video-transfer': Object.freeze({
    label: 'Vidéo vers serveur',
    shortLabel: 'Vidéo serveur',
    icon: 'fa-file-video',
    category: 'video-transfer',
    defaultPriority: 'moyenne',
    descriptionHint: 'Indiquez clairement le contenu, la source, la destination et le délai.',
    fields: Object.freeze([
      Object.freeze({ key: 'mediaSource', label: 'Source / emplacement de la vidéo', type: 'text', required: true, maxLength: 300 }),
      Object.freeze({ key: 'destinationServer', label: 'Serveur / destination attendue', type: 'text', required: true, maxLength: 300 }),
      Object.freeze({ key: 'mediaReference', label: 'Nom, référence ou timecode', type: 'text', maxLength: 300 }),
      Object.freeze({ key: 'format', label: 'Format souhaité', type: 'select', options: Object.freeze(['Format source', 'MXF', 'MOV', 'MP4', 'Autre / à confirmer']) }),
      Object.freeze({ key: 'neededAt', label: 'Livraison souhaitée', type: 'datetime-local', required: true }),
      Object.freeze({ key: 'usage', label: 'Usage / émission / projet', type: 'text', maxLength: 300 })
    ])
  }),
  access: Object.freeze({
    label: "Demande d'accès",
    shortLabel: 'Accès',
    icon: 'fa-user-shield',
    category: 'access',
    defaultPriority: 'moyenne',
    usesAccessWorkflow: true,
    descriptionHint: "Les accès sont traités par le workflow sécurisé des zones."
  }),
  intervention: Object.freeze({
    label: 'Intervention / Maintenance',
    shortLabel: 'Intervention',
    icon: 'fa-screwdriver-wrench',
    category: 'maintenance',
    defaultPriority: 'moyenne',
    descriptionHint: "Précisez l'opération, la fenêtre disponible et les contraintes de service.",
    fields: Object.freeze([
      Object.freeze({ key: 'interventionType', label: "Type d'intervention", type: 'select', required: true, options: Object.freeze(['Préventive', 'Corrective', 'Installation', 'Configuration', 'Contrôle / mesure', 'Autre']) }),
      Object.freeze({ key: 'desiredWindow', label: "Fenêtre d'intervention", type: 'text', required: true, maxLength: 240 }),
      Object.freeze({ key: 'serviceState', label: 'État de service requis', type: 'select', options: Object.freeze(['Sans interruption', 'Coupure autorisée', 'Bascule secours disponible', 'À coordonner']) }),
      Object.freeze({ key: 'constraints', label: 'Consignes / contraintes', type: 'textarea', maxLength: 1200 })
    ])
  })
});

export const REQUEST_PRIORITIES = Object.freeze(['basse', 'moyenne', 'haute']);
export const REQUEST_STATUSES = Object.freeze(['en cours', 'attente', 'prêt-fermeture', 'fermé']);
export const RELATED_TYPES = Object.freeze(['equipment', 'room', 'baie', 'screen', 'continuity-test']);

const text = (value, maxLength = 2000) => String(value ?? '').trim().slice(0, maxLength);

export function requestKindOf(record = {}) {
  if (REQUEST_KINDS[record.requestKind]) return record.requestKind;
  const category = String(record.category || '').toLowerCase();
  if (category === 'maintenance') return 'intervention';
  if (category === 'information') return 'information';
  if (category === 'service') return 'service';
  if (category === 'video-transfer') return 'video-transfer';
  return 'incident';
}

export function requestKindDefinition(value) {
  return REQUEST_KINDS[REQUEST_KINDS[value] ? value : 'incident'];
}

export function sanitizeRequestPayload(input = {}) {
  const requestKind = REQUEST_KINDS[input.requestKind] ? input.requestKind : '';
  const definition = REQUEST_KINDS[requestKind];
  const details = {};
  for (const field of definition?.fields || []) {
    const value = text(input.details?.[field.key], field.maxLength || 500);
    if (value) details[field.key] = value;
  }
  const relatedType = RELATED_TYPES.includes(input.relatedType) ? input.relatedType : '';
  const attachment = /^data:(image\/(png|jpeg|webp|gif)|application\/pdf);base64,[a-z0-9+/=\s]+$/i.test(String(input.attachment || ''))
    ? String(input.attachment)
    : '';
  return {
    requestKind,
    subject: text(input.subject, 240),
    description: text(input.description, 4000),
    priority: REQUEST_PRIORITIES.includes(input.priority) ? input.priority : (definition?.defaultPriority || 'moyenne'),
    destinationZoneId: text(input.destinationZoneId, 160),
    relatedType,
    relatedId: relatedType ? text(input.relatedId, 180) : '',
    details,
    attachment
  };
}

export function validateRequestPayload(input = {}) {
  const value = sanitizeRequestPayload(input);
  const definition = REQUEST_KINDS[value.requestKind];
  const errors = [];
  if (!definition) errors.push('Sélectionnez un type de demande valide.');
  if (definition?.usesAccessWorkflow) errors.push("Utilisez le workflow sécurisé « Accès zones » pour une demande d'accès.");
  if (!value.destinationZoneId && !definition?.usesAccessWorkflow) errors.push('Sélectionnez une équipe ou une zone destinataire.');
  if (!value.subject) errors.push("L'objet de la demande est obligatoire.");
  if (!value.description) errors.push('La description est obligatoire.');
  if (value.relatedType && !value.relatedId) errors.push("Sélectionnez l'élément concerné ou retirez son type.");
  for (const field of definition?.fields || []) {
    if (field.required && !value.details[field.key]) errors.push(`${field.label} est obligatoire.`);
    if (field.options && value.details[field.key] && !field.options.includes(value.details[field.key])) errors.push(`${field.label} contient une valeur inconnue.`);
  }
  if (value.attachment.length > 7_500_000) errors.push('La pièce jointe dépasse la limite de 5 Mo.');
  return { value, errors };
}

export function requestSlaMinutes(priority) {
  return ({ basse: 72 * 60, moyenne: 24 * 60, haute: 6 * 60 })[priority] || 24 * 60;
}

const TERMINAL_SLA_LABEL = Object.freeze({ 'fermé': 'Fermé', 'prêt-fermeture': 'Prêt à fermer' });

/** `3 h 24 min` / `45 min` — jamais `0 min` pour un ticket encore ouvert : `Math.ceil`. */
function formatSlaDuration(minutes) {
  const rounded = Math.max(0, minutes);
  return rounded > 60
    ? `${Math.floor(rounded / 60)} h ${Math.floor(rounded % 60)} min`
    : `${Math.ceil(rounded)} min`;
}

/**
 * L'état d'urgence SLA d'un ticket — sur la PROPORTION de délai restant, jamais sur un
 * chiffre brut de minutes : un ticket « haute » (6h) et un ticket « basse » (72h) à 30
 * minutes de leur échéance ne portent pas la même urgence en minutes absolues, mais la même
 * une fois rapportée à leur propre délai.
 *
 * `deadline` reste la seule source de vérité (`scripts/serve.js#createServiceRequest`, posée
 * une fois à la création, jamais recalculée) : cette fonction ne fait que la LIRE et la
 * présenter, elle n'invente ni ne corrige jamais rien. `now` est injectable — un test SLA ne
 * doit jamais dépendre de l'instant où il tourne.
 *
 * Les statuts terminaux (`fermé`, `prêt-fermeture`) arrêtent le décompte : le ticket n'est
 * plus regardé une fois qu'il n'a plus besoin d'attention.
 */
export function slaEscalationState(ticket, now = Date.now()) {
  const statusLabel = TERMINAL_SLA_LABEL[ticket?.status];
  if (statusLabel) return Object.freeze({ state: 'closed', label: statusLabel, remainingRatio: null });

  const deadline = new Date(ticket?.deadline ?? NaN).getTime();
  if (!Number.isFinite(deadline)) return Object.freeze({ state: 'normal', label: '—', remainingRatio: null });

  const totalMinutes = Number(ticket?.slaMinutes) > 0 ? Number(ticket.slaMinutes) : requestSlaMinutes(ticket?.prio ?? ticket?.priority);
  const remainingMinutes = (deadline - now) / 60_000;

  if (remainingMinutes <= 0) {
    return Object.freeze({ state: 'overdue', label: `SLA dépassé de ${formatSlaDuration(-remainingMinutes)}`, remainingRatio: 0 });
  }
  const remainingRatio = totalMinutes > 0 ? remainingMinutes / totalMinutes : 0;
  const state = remainingRatio > 0.5 ? 'normal' : remainingRatio > 0.25 ? 'warning' : remainingRatio > 0.10 ? 'urgent' : 'critical';
  return Object.freeze({ state, label: formatSlaDuration(remainingMinutes), remainingRatio });
}
