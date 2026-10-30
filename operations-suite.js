import { db } from './db.js';
import { panelMode, applyPanelMode, releasePanelMode } from './equipment-panel-mode.js';
import AdminUI from './admin-ui.js';
import ResponsibleUI from './responsible-ui.js';
import TechUISmart from './techui.js';
import Equipements from './equipements.js';
import { generateQR } from './qr.js';
import { getCurrentUser } from './security.js';
import openInteractiveMap, { ouvrirTraceSurCarte } from './interactive-map.js';
import { relationsAvecDetail, cablerRelationsDetaillees } from './pilot-technique-shell.js';
import { classeQueueSync, libelleQueueSync } from './sync-queue-truth.js';
import { resolveCableEndpoint, cablesForEquipment } from './cable-endpoint-contract.js';
import { routeBadge, routeSequenceSentence, endpointVisualPositionLabel } from './cable-route-presentation.js';
import { sequenceDe, showCableRoute, routeAffichee, entryScene, routeHasVisibleGeometry } from './cable-route-layer.js';
import { locationBreadcrumb } from './location-contract.js';
import {
  EXPLOITATION_SCOPE_ALL, allScopeLabel, defaultExploitationScope,
  scopeToValue, scopeFromValue, filterRoomsByScope, describeScope
} from './exploitation-scope-contract.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const nowIso = () => new Date().toISOString();
const formatDate = value => {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 'Date inconnue' : date.toLocaleString('fr-FR');
};
const normalizeCable = cable => ({
  ...cable,
  sourceType: cable.sourceType || (cable.sourceScreenId != null ? 'screen' : 'equipment'),
  destinationType: cable.destinationType || (cable.destinationScreenId != null ? 'screen' : 'equipment'),
  sourceId: cable.sourceId ?? cable.sourceEquipmentId ?? cable.sourceScreenId ?? null,
  destinationId: cable.destinationId ?? cable.destinationEquipmentId ?? cable.destinationScreenId ?? null
});
const entityName = entity => entity?.name || entity?.nom || entity?.title || entity?.reference || entity?.username || `#${entity?.id ?? '?'}`;

let syncState = { state: 'local', message: 'État de synchronisation inconnu' };

/*
 * DEUX FAITS DISTINCTS, DEUX PHRASES (#98/#164) — voir sync-queue-truth.js.
 *
 * Cette pastille se lisait sur le seul `state`. Or `state` mélange la LIAISON au central
 * et l'ÉTAT DE LA FILE : « Hors ligne / local » s'affichait alors que le serveur venait
 * de répondre, simplement parce qu'une modification restait à envoyer ; et
 * « Synchronisé » s'affichait par-dessus une modification refusée, parce qu'une entrée
 * terminale `conflict`/`failed` n'est comptée par aucun passage ultérieur.
 *
 * `central-sync.js` porte désormais le compte exact de la file dans `detail.queue`.
 * Quand il est là, c'est LUI qui nomme la pastille. Sans lui — les tout premiers
 * évènements, avant la première lecture de la file — on retombe sur l'ancien libellé.
 */
function syncLabel(state = syncState.state) {
  const queue = syncState.queue;
  if (queue) {
    return libelleQueueSync({
      connecte: syncState.connecte === true,
      resume: queue,
      etat: state
    });
  }
  if (state === 'synced') return 'Synchronisé';
  if (state === 'offline' || state === 'local') return 'Hors ligne / local';
  if (state === 'unauthenticated') return 'Session requise';
  // Un conflit de version n'est pas une panne : la pastille doit le nommer, sinon
  // « À vérifier » laisse croire à une liaison douteuse alors que tout fonctionne.
  if (state === 'conflict') return 'Version dépassée';
  return 'À vérifier';
}

function updateSyncBadges(detail = syncState) {
  syncState = { ...syncState, ...detail };
  const queue = syncState.queue;
  document.querySelectorAll('[data-ops-sync]').forEach(node => {
    node.classList.remove('synced', 'offline', 'error', 'pending');
    const cls = queue
      ? classeQueueSync({ connecte: syncState.connecte === true, resume: queue })
      : syncState.state === 'synced' ? 'synced' : ['offline','local'].includes(syncState.state) ? 'offline' : 'error';
    node.classList.add(cls);
    node.textContent = syncLabel(syncState.state);
    node.title = syncState.message || syncLabel(syncState.state);
  });
}

async function loadOperationsData() {
  const stores = ['equipments','rooms','baies','screens','walls','tickets','notes','cables','logs','screen_issues','locations'];
  const values = await Promise.all(stores.map(async store => {
    try { return await db.getAll(store); } catch { return []; }
  }));
  return Object.fromEntries(stores.map((store, index) => [store, values[index]]));
}

/**
 * La salle CANONIQUE d'un équipement — la même priorité que
 * `access-control.js#resolveResourceZones` : sa BAIE d'abord, son propre `roomId` ensuite.
 *
 * La chaîne physique est Équipement → Baie → Salle. Le `roomId` stocké sur l'équipement
 * n'est qu'un reflet, écrit une fois ; déplacer la baie ne le réécrit pas. Le lire en
 * premier attribuerait l'équipement à une salle qu'il a quittée. `null` quand elle est
 * indécidable : un narrowing de périmètre l'exclut alors plutôt que de deviner ; un
 * périmètre « tout » ne consulte jamais cette fonction.
 */
function equipmentRoomId(equipment, { baiesById }) {
  if (equipment.baieId != null) {
    const baie = baiesById.get(String(equipment.baieId));
    if (baie?.roomId != null) return String(baie.roomId);
  }
  if (equipment.roomId != null) return String(equipment.roomId);
  return null;
}

/**
 * La salle CANONIQUE d'un écran — l'ordre INVERSE de l'équipement, et pour la même raison
 * que côté serveur : un écran documente en général sa salle directement, et `wallId` n'est
 * qu'un repli quand ce champ manque (Écran → Mur → Salle).
 */
function screenRoomId(screen, { wallsById }) {
  if (screen.roomId != null) return String(screen.roomId);
  if (screen.wallId != null) {
    const wall = wallsById.get(String(screen.wallId));
    if (wall?.roomId != null) return String(wall.roomId);
  }
  return null;
}

/**
 * La salle CANONIQUE d'un ticket — jamais devinée en traitant tout ce qui n'est pas une
 * salle comme un équipement. Chaque `relatedType` du contrat (`tickets.js#relatedCollections`
 * : equipment / room / baie / screen / continuity-test) a sa PROPRE règle de résolution, la
 * même que le serveur (`access-control.js#resolveResourceZones`, bloc `['tickets',…]`).
 *
 * Un ticket `relatedType:'baie'` dont l'identifiant coïncide par hasard avec celui d'un
 * équipement ne doit JAMAIS se résoudre via cet équipement : le type fait autorité, pas la
 * simple présence d'un id dans telle ou telle table.
 *
 * `continuity-test` pointe vers un DOCUMENT de test (`docs`, `kind:'continuity_test'`), lié
 * à un groupe de protection — pas à un lieu. Le serveur lui-même ne lui résout aucune zone
 * (`pluralStore('continuity-test')` est absent de sa table) : il n'y a pas de rattachement
 * honnête à en tirer, donc `null`, jamais une salle inventée.
 *
 * `ticket.roomId` NE FAIT JAMAIS AUTORITÉ SUR UNE RELATION EXPLICITE. L'écriture actuelle des
 * demandes de service (`/api/service-requests`) n'émet plus ce champ — elle ne pose que
 * `relatedType`/`relatedId` — donc un ticket qui le porte encore est forcément une fiche
 * legacy/migrée, jamais réécrite depuis. Le consulter EN PREMIER referait la même erreur que
 * le `roomId` périmé d'un équipement déplacé : la fiche resterait attachée à la salle où elle
 * vivait à l'écriture, même quand sa relation dit désormais autre chose. La relation, si elle
 * existe, tranche donc toujours en premier ; `roomId` n'est qu'un repli pour la fiche qui n'en
 * porte AUCUNE. Une relation d'un type qui ne fait pas partie du contrat est un signal
 * d'anomalie, pas une invitation à retomber sur `roomId` : elle aussi rend `null`.
 */
function ticketRoomId(ticket, { equipmentsById, baiesById, screensById, wallsById }) {
  const relatedType = String(ticket.relatedType || ticket.targetType || ticket.type || '').toLowerCase();
  const relatedId = ticket.relatedId ?? ticket.targetId ?? ticket.entityId;
  if (relatedId != null) {
    const cle = String(relatedId);
    if (['room','salle'].includes(relatedType)) return cle;
    if (['baie','baies'].includes(relatedType)) {
      const baie = baiesById.get(cle);
      return baie?.roomId != null ? String(baie.roomId) : null;
    }
    if (['screen','screens','ecran'].includes(relatedType)) {
      const screen = screensById.get(cle);
      return screen ? screenRoomId(screen, { wallsById }) : null;
    }
    if (['equipment','equipments','equipement','equipements','device'].includes(relatedType)) {
      const equipment = equipmentsById.get(cle);
      return equipment ? equipmentRoomId(equipment, { baiesById }) : null;
    }
    return null;
  }
  return ticket.roomId != null ? String(ticket.roomId) : null;
}

function currentShift(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 14) return '06:00 – 14:00';
  if (hour >= 14 && hour < 22) return '14:00 – 22:00';
  return '22:00 – 06:00';
}

function getHandovers(notes) {
  return notes.filter(note => note.targetType === 'handover' || note.kind === 'handover')
    .sort((a,b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0));
}

function faultyEquipment(equipment) {
  const status = String(equipment.status || equipment.statut || '').toLowerCase();
  return ['faulty','error','hs','hors service','hors-service','critical','panne'].some(value => status.includes(value)) || Boolean(equipment.panne);
}

function openTicket(ticket) {
  showGenericRecord('Ticket', ticket, [
    ['Titre', ticket.title || ticket.subject || 'Ticket support'],
    ['Statut', ticket.status || 'ouvert'],
    // Le serveur enregistre la priorité sous `prio` : lire `priority` affichait
    // systématiquement « — » dans Exploitation, quelle que soit la demande.
    ['Priorité', ticket.prio || ticket.priority || '—'],
    ['Créé le', formatDate(ticket.createdAt || ticket.timestamp)],
    ['Description', ticket.description || ticket.notes || '—']
  ]);
}

function showGenericRecord(type, record, rows = []) {
  document.getElementById('ops-generic-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ops-generic-modal';
  modal.className = 'ops-modal';
  modal.innerHTML = `<div class="ops-modal-card" style="width:min(720px,calc(100vw - 30px))">
    <div class="ops-modal-head"><strong>${esc(type)} · ${esc(entityName(record))}</strong><button class="ops-close" aria-label="Fermer">×</button></div>
    <div class="ops-modal-body"><div class="ops-facts">${rows.map(([label,value]) => `<div class="ops-fact"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')}</div></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.ops-close').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
}

async function openEquipment360(equipmentOrId) {
  const id = typeof equipmentOrId === 'object' ? equipmentOrId.id : equipmentOrId;
  const [equipment, rooms, baies, screens, walls, cables, tickets, notes, logs, allEquipments] = await Promise.all([
    db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id),
    db.getAll('rooms'), db.getAll('baies'), db.getAll('screens'), db.getAll('walls'), db.getAll('cables'), db.getAll('tickets'), db.getAll('notes'), db.getAll('logs'),
    // Les équipements PAIRS servent à nommer l'autre bout des câbles et à retrouver le
    // châssis d'une carte interne. Ils rejoignent le lot déjà parallèle : les charger
    // plus bas ajouterait une attente en série au milieu du calcul des relations.
    db.getAll('equipments')
  ]);
  if (!equipment) return window.AppDialog?.notice?.('Équipement introuvable.', 'error');

  const room = rooms.find(item => String(item.id) === String(equipment.roomId));
  const baie = baies.find(item => String(item.id) === String(equipment.baieId));
  const relatedScreens = screens.filter(screen => String(screen.equipmentId) === String(equipment.id));
  /*
   * LES CÂBLES DE CET APPAREIL — LES SIENS ET CEUX DE SES CARTES INTERNES.
   *
   * Le filtre était `sourceType === 'equipment'`. Un câble branché sur un composant du
   * châssis — une carte d'entrée, un slot — n'apparaissait donc pas dans la fiche de
   * l'appareil auquel il est physiquement raccordé : la Fiche360 affirmait « Aucun câble
   * relié » d'un équipement câblé. `cablesForEquipment` accepte les deux voies, des deux
   * côtés, et dédoublonne le câble dont LES DEUX bouts appartiennent à l'appareil.
   */
  const composantsGlobaux = allEquipments.flatMap(item =>
    (Array.isArray(item?.components) ? item.components : []).map(component => ({
      ...component,
      parentEquipmentId: item.id,
      parentEquipmentName: entityName(item)
    })));
  const normalizedCables = cables.map(normalizeCable);
  // `composantsGlobaux` — pas les seuls composants de cet appareil : un `componentId`
  // hérité sans parent n'est attribuable que s'il est unique SUR TOUTE la plateforme.
  const relatedCables = cablesForEquipment(normalizedCables, equipment.id, { components: composantsGlobaux });
  const relatedTickets = tickets.filter(ticket => String(ticket.relatedId ?? ticket.targetId ?? ticket.entityId ?? '') === String(equipment.id) && ['equipment','equipement','device'].includes(String(ticket.type || ticket.relatedType || ticket.targetType || 'equipment').toLowerCase()));
  const relatedNotes = notes.filter(note => ['equipment','equipement','device'].includes(String(note.targetType || '').toLowerCase()) && String(note.targetId) === String(equipment.id));
  const relatedLogs = logs.filter(log => JSON.stringify(log).includes(String(equipment.id))).sort((a,b) => new Date(b.timestamp || b.createdAt || 0)-new Date(a.timestamp || a.createdAt || 0)).slice(0,8);
  const wallIds = new Set(relatedScreens.map(screen => screen.wallId).filter(Boolean).map(String));
  const relatedWalls = walls.filter(wall => wallIds.has(String(wall.id)));

  /*
   * « 3 Écrans » ne dit pas LESQUELS. Les quatre listes ci-dessus existent déjà — rien
   * n'est recalculé, seule leur présentation change en Pilote. Voir
   * `pilot-technique-shell.js` (`relationsAvecDetail`) pour la justification complète.
   */
  const groupesRelations = [
    { cle: 'screens', titre: 'Écrans', items: relatedScreens.map(screen => ({ labelHTML: esc(entityName(screen)) })) },
    { cle: 'walls', titre: 'Murs', items: relatedWalls.map(wall => ({ labelHTML: esc(entityName(wall)) })) },
    {
      cle: 'tickets', titre: 'Tickets',
      items: relatedTickets.map(ticket => ({
        labelHTML: `<button type="button" class="ops-relation-ticket" data-ticket-id="${esc(ticket.id)}">${esc(ticket.title || ticket.subject || `Ticket #${ticket.id}`)}</button>`
      }))
    },
    {
      cle: 'notes', titre: 'Notes',
      items: relatedNotes.map(note => ({ labelHTML: `${esc((note.message || '').slice(0, 80) || 'Note')} <small>${esc(formatDate(note.createdAt))}</small>` }))
    }
  ];
  const deepLink = `${location.origin}${location.pathname}?entity=equipment&id=${encodeURIComponent(equipment.id)}#/devices`;
  const qrUrl = await generateQR(deepLink);

  /*
   * NOMMER UN BOUT DE CÂBLE EST UNE DÉCISION, PAS UNE RECHERCHE DANS UN TABLEAU.
   *
   * L'ancien libellé cherchait toujours dans la liste des équipements : un composant n'y
   * est jamais, et une extrémité que le serveur a retirée parce qu'elle est hors périmètre
   * n'a plus d'identifiant du tout. Les deux ressortaient en « Équipement · #? » — la
   * fiche prétendait nommer ce qu'elle ne connaissait pas. Le contrat distingue les trois
   * états et ne reconstruit jamais ce que la protection vient d'enlever.
   */
  const contexteBouts = { equipments: allEquipments, screens, components: composantsGlobaux };
  const boutDuCable = (cable, side) => resolveCableEndpoint(cable, side, contexteBouts);

  document.getElementById('ops-equipment-360')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ops-equipment-360';
  modal.className = 'ops-modal';
  // La fiche s'accoste à droite sur grand écran et monte du bas sur petit. Le CONTENU et
  // le contrat DOM restent identiques : quatorze modules accrochent leurs panneaux à
  // `#ops-equipment-360` et insèrent dans `.ops-modal-body`. Voir equipment-panel-mode.js.
  applyPanelMode(modal, panelMode(window.innerWidth));
  modal.innerHTML = `<div class="ops-modal-card">
    <div class="ops-modal-head"><div><strong>Fiche technique 360°</strong><div style="font-size:12px;color:#71899a">${esc(entityName(equipment))}</div></div><button class="ops-close" aria-label="Fermer">×</button></div>
    <div class="ops-modal-body ops-360-grid">
      <div class="ops-card">
        <h3><i class="fas fa-server"></i> Identité & emplacement</h3>
        <div class="ops-facts">
          ${[['Nom',entityName(equipment)],['Type',equipment.type || '—'],['Catégorie',equipment.categorie || equipment.category || '—'],['Marque',equipment.marque || '—'],['Modèle',equipment.modele || '—'],['N° série',equipment.numSerie || equipment.serialNumber || '—'],['Statut',equipment.statut || equipment.status || '—'],['Salle',entityName(room)],['Baie / Rack',entityName(baie)],['Adresse IP',equipment.ipAddress || '—'],['Grille IN/OUT',equipment.grilleINOUT || '—'],['Ports',(equipment.ports || []).length]].map(([label,value]) => `<div class="ops-fact"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')}
        </div>
        <h3 style="margin-top:18px"><i class="fas fa-qrcode"></i> Accès QR opérationnel</h3>
        <div class="ops-qr-wrap">${qrUrl ? `<img src="${esc(qrUrl)}" alt="QR équipement">` : ''}<div><small>Ce QR ouvre directement cette fiche 360°.</small><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn gray ops-copy-link">Copier le lien</button><button class="btn gray ops-print-qr">Imprimer le QR</button></div></div></div>
      </div>
      <div style="display:grid;gap:16px">
        <section class="ops-card"><h3><i class="fas fa-project-diagram"></i> Signal Flow</h3><p class="ops-card-sub">Flux physiques construits depuis les câbles et ports enregistrés.</p>
          <div class="ops-flow">${relatedCables.length ? relatedCables.map(cable => {
            const source = boutDuCable(cable, 'source');
            const destination = boutDuCable(cable, 'destination');
            // Le port se lit par son NUMÉRO et son type, pas par son identifiant interne :
            // un bout protégé n'en a aucun, et on ne le devine pas.
            const port = bout => bout.port ? `${bout.port.number} · ${bout.port.type}` : '—';
            // Un `portId` logique n'est jamais une preuve de position de pixel (voir
            // cable-route-presentation.js) : cette ligne dit ce que le contrat des formes
            // imbriquées documente réellement pour l'ENTITÉ porteuse, jamais pour le
            // connecteur lui-même.
            const position = bout => endpointVisualPositionLabel(bout);
            /*
             * L'ÉTAT DU TRACÉ SE DIT ICI, ET IL NE MENT PAS.
             *
             * Quatre faits distincts, quatre phrases : vérifié, proposé, absent — « Tracé
             * physique non renseigné », qui veut dire que personne ne l'a relevé — et
             * amputé, qui veut dire qu'il existe et ne nous regarde pas. Les confondre
             * enverrait un exploitant relever un cheminement déjà documenté.
             *
             * « Voir le tracé » n'est proposé que s'il y a quelque chose à voir : pas de
             * bouton décoratif pour une relation qui n'existe pas.
             */
            const pastille = routeBadge(cable.route);
            const parcours = routeSequenceSentence(sequenceDe(cable.route), { rooms, baies });
            return `<div class="ops-flow-row"><div class="ops-flow-node">${esc(source.label)}<br><small>${esc(port(source))}</small><br><small class="ops-flow-position">${esc(position(source))}</small></div><div class="ops-flow-arrow">→<br><small>${esc(cable.reference || cable.type || '')}</small></div><div class="ops-flow-node">${esc(destination.label)}<br><small>${esc(port(destination))}</small><br><small class="ops-flow-position">${esc(position(destination))}</small></div></div>
              <div class="ops-flow-route" data-route-tone="${esc(pastille.tone)}">
                <span class="ops-route-badge ops-route-${esc(pastille.tone)}">${esc(pastille.text)}</span>
                ${parcours ? `<span class="ops-route-path">${esc(parcours)}</span>` : ''}
                ${/*
                   * Un tracé AMPUTÉ n'est pas un tracé vide : le serveur conserve les
                   * segments autorisés et n'ajoute que `partial`. Refuser la vue parce
                   * qu'une partie est protégée priverait l'exploitant de ce qu'il a le
                   * droit de voir. Le bouton dépend donc de ce qu'il RESTE à montrer, pas
                   * de la pastille — laquelle continue de dire, elle, que le tracé est
                   * incomplet.
                   */''}${routeHasVisibleGeometry(cable.route)
                  ? `<button type="button" class="btn gray ops-voir-trace" data-cable-id="${esc(cable.id)}">Voir le tracé</button>`
                  : ''}
              </div>`;
          }).join('') : '<div class="ops-empty">Aucun câble relié à cet équipement.</div>'}</div>
        </section>
        <section class="ops-card" id="ops-relations-card"><h3><i class="fas fa-link"></i> Relations</h3>${relationsAvecDetail(groupesRelations)}</section>
        <section class="ops-card"><h3><i class="fas fa-history"></i> Historique récent</h3><div class="ops-list">${relatedLogs.length ? relatedLogs.map(log => `<div class="ops-row"><div class="ops-row-main"><strong>${esc(log.action || log.type || 'Activité')}</strong><small>${esc(formatDate(log.timestamp || log.createdAt))}</small></div></div>`).join('') : '<div class="ops-empty">Aucune activité récente liée.</div>'}</div></section>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  // Dépli/repli des compteurs de « Relations », et ouverture des tickets listés par le
  // même `openTicket` que le reste de la fiche — aucune navigation nouvelle n'est écrite.
  const carteRelations = modal.querySelector('#ops-relations-card');
  if (carteRelations) {
    cablerRelationsDetaillees(carteRelations);
    carteRelations.addEventListener('click', event => {
      const bouton = event.target.closest('.ops-relation-ticket');
      if (!bouton) return;
      const ticket = relatedTickets.find(item => String(item.id) === String(bouton.dataset.ticketId));
      if (ticket) openTicket(ticket);
    });
  }
  /*
   * « VOIR LE TRACÉ » — ET L'AUTORITÉ EST REDEMANDÉE AVANT D'OUVRIR QUOI QUE CE SOIT.
   *
   * La capacité déposée par la synchronisation vieillit : entre deux instantanés, une
   * habilitation peut être révoquée. `showCableRoute` interroge donc le serveur, et si la
   * réponse dit que le tracé n'est plus lisible, rien ne s'affiche — on ne retombe pas sur
   * la géométrie en cache.
   */
  modal.addEventListener('click', async event => {
    const bouton = event.target.closest('.ops-voir-trace');
    if (!bouton) return;
    const cable = relatedCables.find(item => String(item.id) === String(bouton.dataset.cableId));
    if (!cable) return;
    const acces = await showCableRoute(cable);
    if (!acces.readable) {
      window.AppDialog?.notice?.("Ce tracé n'est plus accessible dans votre périmètre.", 'error');
      return;
    }
    /*
     * ON ENTRE PAR LE TRACÉ FRAÎCHEMENT SERVI, JAMAIS PAR `cable.roomId`.
     *
     * Ce champ est un cache hérité — écrit une fois depuis la salle de la source, jamais
     * rafraîchi — et le contrat de connectivité dit expressément qu'il ne décide de rien.
     * S'en servir enverrait l'exploitant dans une salle que le cheminement ne traverse
     * peut-être pas. `routeAffichee()` rend la vue que le serveur vient d'autoriser, et
     * c'est elle qui désigne la scène d'entrée.
     */
    const vue = routeAffichee();
    const entree = entryScene(vue, { roomId: equipment.roomId, baieId: equipment.baieId });
    if (!entree) {
      window.AppDialog?.notice?.("Aucune partie de ce tracé n'est visible dans votre périmètre.", 'error');
      return;
    }
    fermerFiche();
    openInteractiveMap({ rooms, baies, equipments: allEquipments, walls, user: getCurrentUser() });
    /*
     * ON ENTRE DANS LA SCÈNE DU TRACÉ — `localiserSurCarte` ne convient pas ici.
     *
     * Elle se place chez le PARENT de la cible pour l'y désigner : pour une salle, ce
     * parent est le plan général. On atterrissait donc sur le plan, la salle entourée d'un
     * halo, et PAS UN SEGMENT du tracé n'était dessiné — la couche ne dessine que les
     * segments de la scène ouverte. Voir un tracé de salle exige d'entrer dans la salle.
     *
     * L'équipement d'origine part avec : c'est lui qui donne le chemin du retour
     * Câble → Équipement → Baie → Salle, que l'historique de la carte n'a aucun moyen de
     * deviner puisqu'on n'est pas arrivé là par une navigation.
     */
    const entre = await ouvrirTraceSurCarte(entree, { equipmentId: equipment.id });
    if (!entre) {
      window.AppDialog?.notice?.("Ce tracé désigne un lieu absent de ce plan.", 'error');
    }
  });

  const fermerFiche = () => { modal.remove(); releasePanelMode(); };
  modal.querySelector('.ops-close').onclick = fermerFiche;
  // Le clic « à côté » ne ferme QUE la feuille montante. En panneau accosté, le fond ne
  // reçoit plus les clics : ils vont au tableau, ce qui est tout l'intérêt — on passe d'un
  // appareil au suivant sans fermer ni rouvrir.
  modal.onclick = event => { if (event.target === modal) fermerFiche(); };
  // Échap ferme, quel que soit le mode : c'est le geste attendu et il manquait.
  const surEchap = event => {
    if (event.key !== 'Escape' || !document.body.contains(modal)) return;
    document.removeEventListener('keydown', surEchap, true);
    fermerFiche();
  };
  document.addEventListener('keydown', surEchap, true);
  modal.querySelector('.ops-copy-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(deepLink); window.AppDialog?.notice?.('Lien copié.', 'success'); }
    catch { window.AppDialog?.notice?.(deepLink, 'info'); }
  });
  modal.querySelector('.ops-print-qr')?.addEventListener('click', () => {
    if (!qrUrl) return;
    const popup = window.open('', '_blank', 'width=480,height=620');
    if (!popup) return window.AppDialog?.notice?.("Autorisez les fenêtres pour imprimer le QR.", 'warning');
    popup.document.write(`<html lang="fr"><head><title>QR ${esc(entityName(equipment))}</title></head><body style="font-family:Arial;text-align:center;padding:30px"><h2>${esc(entityName(equipment))}</h2><img src="${esc(qrUrl)}" style="width:280px;height:280px"><p>${esc(deepLink)}</p><script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
    popup.document.close();
  });
}

class OperationsCenter {
  constructor(user, notifications, navigate = null) {
    this.user = user || getCurrentUser() || {};
    this.notifications = notifications;
    this.navigate = navigate;
    this.scope = null;
  }

  async render() {
    const data = await loadOperationsData();
    const { rooms, locations, baies, equipments } = data;
    if (!this.scope) this.scope = defaultExploitationScope(this.user.role, rooms);
    const scopedRooms = filterRoomsByScope(rooms, this.scope, locations);
    const scopedRoomIds = new Set(scopedRooms.map(room => String(room.id)));
    const baiesById = new Map(baies.map(baie => [String(baie.id), baie]));
    const equipmentsById = new Map(equipments.map(equipment => [String(equipment.id), equipment]));
    const wallsById = new Map((data.walls || []).map(wall => [String(wall.id), wall]));
    const screensById = new Map((data.screens || []).map(screen => [String(screen.id), screen]));
    /*
     * LE FILTRE DE PÉRIMÈTRE EST UN AFFICHAGE, JAMAIS UNE AUTORISATION.
     *
     * `rooms`/`equipments`/`tickets`/`screens`/`notes` sont déjà exactement ce que le
     * serveur a jugé bon de servir à cet utilisateur (`/api/sync`). Choisir « Toute la
     * chaîne » n'élargit donc rien : c'est déjà tout ce qui est autorisé, y compris un
     * équipement sans salle connue, qu'un narrowing explicite exclurait au contraire faute
     * de pouvoir dire à quelle salle il appartient.
     */
    const inScope = (record, roomId) => this.scope.kind === EXPLOITATION_SCOPE_ALL || (roomId != null && scopedRoomIds.has(roomId));
    const scopedEquipments = equipments.filter(eq => inScope(eq, equipmentRoomId(eq, { baiesById })));
    const scopedScreens = data.screens.filter(screen => inScope(screen, screenRoomId(screen, { wallsById })));
    const scopedTickets = data.tickets.filter(ticket => inScope(ticket, ticketRoomId(ticket, { equipmentsById, baiesById, screensById, wallsById })));
    const scopedHandovers = getHandovers(data.notes).filter(item => inScope(item, item.targetType === 'room' ? String(item.targetId) : null));

    const handovers = scopedHandovers;
    const openTickets = scopedTickets.filter(ticket => !['closed','fermé','ferme','resolved','résolu','resolu'].includes(String(ticket.status || '').toLowerCase()));
    const faulty = scopedEquipments.filter(faultyEquipment);
    const screensError = scopedScreens.filter(screen => ['offline','error','faulty','hs'].includes(String(screen.status || '').toLowerCase()));
    const latest = handovers.slice(0,5);
    const canWrite = !['visitor','user'].includes(String(this.user.role || '').toLowerCase());
    const roomLabel = room => room.name || room.nom || `Salle #${room.id}`;
    const handoverRoomOptions = rooms.slice().sort((a,b) => roomLabel(a).localeCompare(roomLabel(b), 'fr'))
      .map(room => `<option value="${esc(room.id)}"${this.scope.kind === 'room' && String(this.scope.roomId) === String(room.id) ? ' selected' : ''}>${esc(roomLabel(room))}</option>`).join('');
    return `<div class="ops-shell">
      <section class="ops-hero"><div><h2>Centre d'exploitation</h2><p>État opérationnel, passation et accès rapide aux ressources techniques.</p></div><div class="ops-header-tools"><span class="ops-sync" data-ops-sync>${syncLabel()}</span><button class="btn gray ops-open-search"><i class="fas fa-search"></i> Recherche globale</button></div></section>
      ${this.renderScopePicker(rooms, locations)}
      <section class="ops-grid"><div class="ops-stat"><i class="fas fa-ticket-alt"></i><strong>${openTickets.length}</strong><span>Tickets ouverts</span></div><div class="ops-stat"><i class="fas fa-exclamation-triangle"></i><strong>${faulty.length}</strong><span>Équipements à surveiller</span></div><div class="ops-stat"><i class="fas fa-tv"></i><strong>${screensError.length}</strong><span>Écrans en erreur</span></div><div class="ops-stat"><i class="fas fa-exchange-alt"></i><strong>${handovers.length}</strong><span>Passations enregistrées</span></div></section>
      <section class="ops-layout">
        <div class="ops-card"><h3><i class="fas fa-book-open"></i> Cahier de passation</h3><p class="ops-card-sub">Ce journal est partagé via la base centrale et reste disponible pour le shift suivant.</p>
          ${canWrite ? (rooms.length ? `<form class="ops-form" id="ops-handover-form"><div class="ops-form-grid"><label>Salle<select name="roomId" required><option value="" disabled${this.scope.kind === 'room' ? '' : ' selected'}>Choisir une salle…</option>${handoverRoomOptions}</select></label><label>Shift<select name="shift"><option>${currentShift()}</option><option>06:00 – 14:00</option><option>14:00 – 22:00</option><option>22:00 – 06:00</option></select></label><label>Niveau<select name="level"><option value="normal">Normal</option><option value="watch">À surveiller</option><option value="critical">Critique</option></select></label></div><label>Résumé<textarea name="summary" required placeholder="Ce qui s'est passé pendant le shift…"></textarea></label><label>Actions restantes / points à surveiller<textarea name="watchItems" placeholder="Équipement, ticket, action à reprendre…"></textarea></label><div class="ops-actions"><button class="btn" type="submit"><i class="fas fa-save"></i> Enregistrer la passation</button></div></form>` : '<div class="ops-empty">Aucune salle autorisée : la passation a besoin d\'une salle réelle à laquelle s\'ancrer.</div>') : '<div class="ops-empty">Consultation uniquement pour ce rôle.</div>'}
        </div>
        <div class="ops-card"><h3><i class="fas fa-clock"></i> Dernières passations</h3><div class="ops-list">${latest.length ? latest.map(item => `<div class="ops-row"><div class="ops-row-main"><strong>${esc(item.shift || 'Shift')} · ${esc(rooms.find(room => String(room.id) === String(item.targetId))?.name || rooms.find(room => String(room.id) === String(item.targetId))?.nom || 'Salle')} · ${esc(item.createdByName || item.createdBy || 'Utilisateur')}</strong><small>${esc(item.summary || '—')}<br>${esc(formatDate(item.createdAt))}</small></div><span class="ops-badge ${esc(item.level || 'normal')}">${item.level === 'critical' ? 'Critique' : item.level === 'watch' ? 'À surveiller' : 'Normal'}</span></div>`).join('') : '<div class="ops-empty">Aucune passation enregistrée dans ce périmètre.</div>'}</div></div>
      </section>
      <section class="ops-layout"><div class="ops-card"><h3><i class="fas fa-exclamation-circle"></i> À surveiller maintenant</h3><div class="ops-list">${faulty.slice(0,6).map(eq => `<button class="ops-row ops-open-equipment" data-id="${esc(eq.id)}"><div class="ops-row-main"><strong>${esc(entityName(eq))}</strong><small>${esc(eq.statut || eq.status || 'Statut à vérifier')}</small></div><span class="ops-badge critical">Équipement</span></button>`).join('') || '<div class="ops-empty">Aucun équipement critique dans ce périmètre.</div>'}</div></div><div class="ops-card"><h3><i class="fas fa-life-ring"></i> Tickets ouverts</h3><div class="ops-list">${openTickets.slice(0,6).map(ticket => `<button class="ops-row ops-open-ticket" data-id="${esc(ticket.id)}"><div class="ops-row-main"><strong>${esc(ticket.title || ticket.subject || 'Ticket support')}</strong><small>${esc(ticket.status || 'ouvert')} · ${esc(formatDate(ticket.createdAt || ticket.timestamp))}</small></div><span class="ops-badge watch">Ticket</span></button>`).join('') || '<div class="ops-empty">Aucun ticket ouvert dans ce périmètre.</div>'}</div></div></section>
    </div>`;
  }

  /*
   * TOUJOURS AFFICHÉ, JAMAIS DEVINÉ : L'OPÉRATEUR SAIT TOUJOURS À QUOI LES CHIFFRES RENVOIENT.
   *
   * `simple` retire le groupe « Localisation » pour le technicien : il n'a pas à traverser
   * la hiérarchie Ville/Région/Département pour retrouver SES salles — voir le contrat.
   */
  renderScopePicker(rooms, locations) {
    const simple = ['technician','tech','technicien'].includes(String(this.user.role || '').toLowerCase());
    const currentValue = scopeToValue(this.scope);
    const option = (value, label) => `<option value="${esc(value)}"${currentValue === value ? ' selected' : ''}>${esc(label)}</option>`;
    let options = option(EXPLOITATION_SCOPE_ALL, allScopeLabel(this.user.role));
    if (!simple && locations.length > 1) {
      const locationOptions = locations.slice()
        .map(location => ({ location, label: locationBreadcrumb(location.id, locations) }))
        .sort((a,b) => a.label.localeCompare(b.label, 'fr'))
        .map(({ location, label }) => option(`location:${location.id}`, label)).join('');
      options += `<optgroup label="Localisation">${locationOptions}</optgroup>`;
    }
    /*
     * `> 0`, PAS `> 1` : le responsable d'UNE seule salle y atterrit par défaut
     * (`defaultExploitationScope`), et cette valeur `room:<id>` doit exister PARMI les
     * options du <select> pour pouvoir y être marquée `selected` — sinon le navigateur,
     * ne trouvant sa valeur nulle part, retombe sur la première option venue (« Toute la
     * chaîne »), qui n'est pourtant pas celle réellement affichée par le reste de l'écran.
     */
    if (rooms.length > 0) {
      const roomOptions = rooms.slice()
        .sort((a,b) => (a.name || a.nom || '').localeCompare(b.name || b.nom || '', 'fr'))
        .map(room => option(`room:${room.id}`, room.name || room.nom || `Salle #${room.id}`)).join('');
      options += `<optgroup label="Salle">${roomOptions}</optgroup>`;
    }
    return `<section class="ops-scope-bar"><label class="ops-scope-picker"><span>Périmètre affiché</span><select id="ops-scope-select">${options}</select></label><span class="ops-scope-current">${esc(describeScope(this.scope, { role: this.user.role, rooms, locations }))}</span></section>`;
  }

  async afterRender() {
    updateSyncBadges();
    document.querySelectorAll('.ops-open-search').forEach(button => button.onclick = () => openGlobalSearch());
    document.querySelectorAll('.ops-open-equipment').forEach(button => button.onclick = () => openEquipment360(button.dataset.id));
    const tickets = await db.getAll('tickets');
    document.querySelectorAll('.ops-open-ticket').forEach(button => button.onclick = () => openTicket(tickets.find(item => String(item.id) === String(button.dataset.id)) || { id: button.dataset.id }));
    const refresh = async () => {
      const target = document.getElementById('admin-content') || document.getElementById('responsible-content') || document.getElementById('ops-center-modal-body');
      if (target) { target.innerHTML = await this.render(); await this.afterRender(); }
    };
    const scopeSelect = document.getElementById('ops-scope-select');
    if (scopeSelect) scopeSelect.onchange = async () => { this.scope = scopeFromValue(scopeSelect.value); await refresh(); };
    const form = document.getElementById('ops-handover-form');
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.roomId) return this.notifications?.showNotification?.('Choisissez la salle concernée par la passation.', 'error');
      const user = getCurrentUser() || this.user || {};
      try {
        await db.save('notes', {
          targetType: 'room', targetId: values.roomId, kind: 'handover', shift: values.shift,
          level: values.level || 'normal', summary: String(values.summary || '').trim(),
          watchItems: String(values.watchItems || '').trim(), createdBy: user.id ?? null,
          createdByName: user.fullName || user.username || 'Utilisateur', createdAt: nowIso(), updatedAt: nowIso()
        });
      } catch (error) {
        this.notifications?.showNotification?.("La passation n'a pas pu être enregistrée : vérifiez que vous êtes autorisé sur cette salle.", 'error');
        return;
      }
      this.notifications?.showNotification?.('Passation enregistrée et synchronisée.', 'success');
      await refresh();
    };
  }
}

async function openOperationsModal(user = getCurrentUser()) {
  document.getElementById('ops-center-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ops-center-modal';
  modal.className = 'ops-modal';
  modal.innerHTML = `<div class="ops-modal-card"><div class="ops-modal-head"><strong>Centre d'exploitation</strong><button class="ops-close" aria-label="Fermer">×</button></div><div class="ops-modal-body" id="ops-center-modal-body"><div class="loading-spinner"><div class="spinner"></div><p>Chargement…</p></div></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('.ops-close').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  const component = new OperationsCenter(user, null);
  const body = modal.querySelector('#ops-center-modal-body');
  body.innerHTML = await component.render();
  await component.afterRender();
}

async function collectSearchResults(query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const stores = ['equipments','rooms','baies','screens','tickets','cables','notes'];
  const labels = { equipments:'Équipement', rooms:'Salle', baies:'Baie', screens:'Écran', tickets:'Ticket', cables:'Câble', notes:'Note' };
  const all = await Promise.all(stores.map(store => db.getAll(store).catch(() => [])));
  const results = [];
  stores.forEach((store, index) => {
    all[index].forEach(item => {
      const haystack = Object.values(item).map(value => typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).join(' ').toLowerCase();
      if (!haystack.includes(q)) return;
      results.push({ store, type: labels[store], item, score: entityName(item).toLowerCase().startsWith(q) ? 2 : 1 });
    });
  });
  return results.sort((a,b) => b.score - a.score).slice(0,30);
}

async function handleSearchSelection(result) {
  if (!result) return;
  if (result.store === 'equipments') return openEquipment360(result.item.id);
  if (result.store === 'tickets') return openTicket(result.item);
  const details = Object.entries(result.item).filter(([key,value]) => !['images','image','qr','password'].includes(key) && typeof value !== 'object').slice(0,12).map(([key,value]) => [key, value]);
  showGenericRecord(result.type, result.item, details);
}

function openGlobalSearch(initial = '') {
  document.getElementById('ops-global-search')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ops-global-search';
  modal.className = 'ops-search-modal';
  modal.innerHTML = `<div class="ops-search-card"><div class="ops-search-box"><input type="search" autocomplete="off" placeholder="Équipement, IP, série, salle, baie, écran, câble, ticket…" value="${esc(initial)}"></div><div class="ops-search-results"><div class="ops-empty">Saisissez au moins 2 caractères.</div></div></div>`;
  document.body.appendChild(modal);
  const input = modal.querySelector('input');
  const resultsNode = modal.querySelector('.ops-search-results');
  let token = 0;
  const run = async () => {
    const id = ++token;
    const results = await collectSearchResults(input.value);
    if (id !== token) return;
    resultsNode.innerHTML = results.length ? results.map((result,index) => `<button class="ops-search-result" data-index="${index}"><div><strong>${esc(entityName(result.item))}</strong><small>${esc(result.type)} · ${esc(result.item.numSerie || result.item.ipAddress || result.item.reference || result.item.status || result.item.statut || '')}</small></div><span class="ops-badge">${esc(result.type)}</span></button>`).join('') : '<div class="ops-empty">Aucun résultat.</div>';
    resultsNode.querySelectorAll('.ops-search-result').forEach(button => button.onclick = () => { const result = results[Number(button.dataset.index)]; modal.remove(); handleSearchSelection(result); });
  };
  input.oninput = run;
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') modal.remove(); });
  requestAnimationFrame(() => { input.focus(); if (initial) run(); });
}

function patchAdmin() {
  if (AdminUI.prototype.__opsPatched) return;
  AdminUI.prototype.__opsPatched = true;
  const originalInitSections = AdminUI.prototype.initSections;
  AdminUI.prototype.initSections = function() {
    const sections = originalInitSections.call(this);
    const entries = Object.entries(sections);
    const rebuilt = {};
    for (const [key,value] of entries) {
      rebuilt[key] = value;
      if (key === 'dashboard') rebuilt.exploitation = { title: 'Exploitation', icon: 'fas fa-broadcast-tower', component: new OperationsCenter(this.user, this.notifications, destination => this.openTab(destination)) };
    }
    return rebuilt;
  };
}

function patchResponsible() {
  if (ResponsibleUI.prototype.__opsPatched) return;
  ResponsibleUI.prototype.__opsPatched = true;
  const originalRender = ResponsibleUI.prototype.renderBaseLayout;
  ResponsibleUI.prototype.renderBaseLayout = function() {
    if (!this.sections.exploitation) this.sections = { exploitation: { title:'Exploitation', icon:'fas fa-broadcast-tower', component:new OperationsCenter(this.user, this.notifications, destination => this.navigateToSection(destination)) }, ...this.sections };
    return originalRender.call(this);
  };
}

function patchTechnician() {
  if (TechUISmart.prototype.__opsPatched) return;
  TechUISmart.prototype.__opsPatched = true;
  const originalBind = TechUISmart.prototype.bindGlobalActions;
  TechUISmart.prototype.bindGlobalActions = function(...args) {
    const result = originalBind ? originalBind.apply(this, args) : undefined;
    const header = document.querySelector('.smart-tech-header .header-actions');
    if (header && !header.querySelector('#tech-operations-btn')) {
      const button = document.createElement('button');
      button.id = 'tech-operations-btn'; button.className = 'btn gray ops-entry-btn';
      button.innerHTML = '<i class="fas fa-broadcast-tower"></i> Exploitation';
      button.onclick = () => openOperationsModal(this.user);
      header.prepend(button);
    }
    injectSyncIndicator();
    return result;
  };
}

function patchEquipmentQuickView() {
  if (Equipements.prototype.__ops360Patched) return;
  Equipements.prototype.__ops360Patched = true;
  const original = Equipements.prototype.showQuickView;
  Equipements.prototype.showQuickView = async function(eq) {
    try { return await openEquipment360(eq); }
    catch (error) {
      console.error('Vue 360 indisponible, retour à la vue historique', error);
      return original.call(this, eq);
    }
  };
}

function injectSyncIndicator() {
  // Le témoin se pose DANS la rangée de commandes de chaque coque, jamais sur l'en-tête
  // elle-même : `prepend()` sur `.visitor-header` le déposait tout à gauche, avant le logo,
  // au lieu de rejoindre le compte et la déconnexion comme dans les trois autres rôles.
  const host = document.querySelector('.admin-header .header-right, .smart-tech-header .header-actions, .responsible-header > div:last-child, .visitor-header .visitor-header-actions');
  if (!host || host.querySelector('[data-ops-sync]')) return;
  const badge = document.createElement('span');
  badge.className = 'ops-header-sync'; badge.dataset.opsSync = '1'; badge.textContent = syncLabel();
  host.prepend(badge); updateSyncBadges();
}

function installHeaderObserver() {
  const observer = new MutationObserver(() => injectSyncIndicator());
  observer.observe(document.getElementById('app') || document.body, { childList:true, subtree:true });
  injectSyncIndicator();
}

function cleanDeepLinkUrl() {
  history.replaceState({}, '', `${location.pathname}${location.hash || ''}`);
}

/*
 * UN QR SCANNÉ POINTE VERS CE LIEN — ET LE LIEN NE DOIT JAMAIS RESTER MUET.
 *
 * L'équipement peut être introuvable pour deux raisons qui se ressemblent depuis cet écran
 * mais ne le sont pas : il n'existe pas, ou il existe hors du périmètre autorisé de
 * l'utilisateur — auquel cas `/api/sync` ne l'a jamais déposé localement, et `db.get` rend
 * `undefined` exactement comme pour un identifiant inventé. Les deux cas reçoivent donc le
 * même message honnête, plutôt que de laisser le QR n'ouvrir RIEN sans un mot d'explication
 * — ce qui ressemblerait à une plateforme qui ne répond plus, pas à un accès refusé.
 */
async function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  if (params.get('entity') !== 'equipment' || !params.get('id')) return;
  const id = params.get('id');
  const start = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - start > 30000) {
      clearInterval(timer);
      cleanDeepLinkUrl();
      window.AppDialog?.notice?.("Équipement introuvable : il n'existe pas, ou n'est pas dans votre périmètre autorisé.", 'error');
      return;
    }
    if (!localStorage.getItem('auth')) return;
    try {
      const equipment = await db.get('equipments', db.normalizeKey ? db.normalizeKey(id) : id);
      if (!equipment) return;
      clearInterval(timer);
      cleanDeepLinkUrl();
      await openEquipment360(equipment);
    } catch {}
  }, 700);
}

function installKeyboardShortcut() {
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openGlobalSearch();
    }
  }, true);
}

patchAdmin();
patchResponsible();
patchTechnician();
patchEquipmentQuickView();
installKeyboardShortcut();
installHeaderObserver();
window.addEventListener('central-sync-status', event => updateSyncBadges(event.detail || {}));
window.addEventListener('online', () => updateSyncBadges({ state: db.isCentralSyncReady?.() ? 'synced' : 'local', message: navigator.onLine ? 'Connexion disponible.' : 'Hors ligne.' }));
window.addEventListener('offline', () => updateSyncBadges({ state: 'offline', message: 'Connexion réseau indisponible.' }));
setTimeout(() => updateSyncBadges({ state: db.isCentralSyncReady?.() ? 'synced' : (navigator.onLine ? 'local' : 'offline') }), 1000);
handleDeepLink();

if (typeof window !== 'undefined') {
  window.TechOperations = Object.freeze({ openCenter: openOperationsModal, openSearch: openGlobalSearch, openEquipment360 });
}

export { OperationsCenter, openOperationsModal, openGlobalSearch, openEquipment360 };
