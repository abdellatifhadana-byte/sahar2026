import { db } from './db.js';
import { chainSegmentOptions, roomChainSegment } from './signal-chain-contract.js';
import {
  locationBreadcrumb, LOCATION_ORDER, LOCATION_LABELS_PLURAL, normalizeLocationKind
} from './location-contract.js';
import { resolveMapImageUrl } from './map-image-store.js';
import { getCurrentUser } from './security.js';
import { PermissionManager } from './permissions.js';
import { roleSeesEveryZone } from './roles.js';
import { messageDePerimetre } from './zone-scope-notice.js';
import { readRoomTransfer } from './room-zone-transfer-contract.js';
import { toNaturalCoordinates, toDisplayCoordinates, normalizeMapCoordinates } from './map-coordinates-contract.js';
import { replierLaCreation, pucesActifs } from './pilot-technique-shell.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
})[character]);
const normalizeId = value => typeof db.normalizeKey === 'function'
  ? db.normalizeKey(value)
  : (/^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : value);

// ============ Salles (Rooms) =============

/**
 * Options « où se trouve cette unité ».
 *
 * Le champ `location` était du TEXTE LIBRE : deux salles du même bâtiment n'avaient aucun
 * lien, et rien ne permettait de demander « tout ce qui est à Casablanca ». On propose
 * donc les lieux réels, avec leur chemin complet — « Casablanca › Siège › Régie » — pour
 * que deux lieux homonymes restent distinguables.
 *
 * Le champ texte est CONSERVÉ à côté : les salles existantes le portent, et le supprimer
 * effacerait une information saisie à la main sans rien offrir à la place.
 *
 * LES TROIS NIVEAUX, PAS SEULEMENT LE DERNIER.
 * ---------------------------------------------
 * Ce sélecteur n'offrait QUE des départements. Or toutes les unités de 2M ne sont pas
 * dans un département : la Régie Car est une unité mobile GARÉE DANS UNE COUR — à
 * l'intérieur du site, mais dans aucune salle et sous aucun département. Elle était donc
 * la seule unité de la plateforme qu'il était impossible de situer, alors qu'elle porte
 * 51 équipements et 6 baies.
 *
 * Le modèle de données ne l'a jamais interdit : `rooms.locationId` est une référence
 * libre, et `locationPath`, `locationBreadcrumb`, `locationDeletionBlockers` comme l'arbre
 * des lieux traitent déjà les trois niveaux sans distinction. Seul ce formulaire
 * restreignait — et il le faisait DEUX fois :
 *
 *   1. impossible de rattacher une unité à une ville ou à une région ;
 *   2. une unité DÉJÀ rattachée à une ville ou à une région n'avait aucune option
 *      correspondante, donc le sélecteur retombait sur « non rattachée » et la
 *      modification de n'importe quel autre champ effaçait son rattachement en silence.
 *
 * Les options sont groupées par niveau : « Casablanca » la ville et un département du
 * même nom ne doivent pas se confondre dans une liste à plat.
 */
export function optionsDeLocalisation(locations, selectionne) {
  const groupes = LOCATION_ORDER.map(kind => ({
    label: LOCATION_LABELS_PLURAL[kind],
    items: (locations || [])
      .filter(item => item && normalizeLocationKind(item.kind) === kind)
      .map(item => ({ id: item.id, chemin: locationBreadcrumb(item.id, locations) || item.name }))
      .sort((a, b) => String(a.chemin).localeCompare(String(b.chemin), 'fr'))
  })).filter(groupe => groupe.items.length);
  if (!groupes.length) return '';
  return groupes.map(groupe => `<optgroup label="${escapeHTML(groupe.label)}">${
    groupe.items.map(item =>
      `<option value="${escapeHTML(item.id)}"${String(item.id) === String(selectionne ?? '') ? ' selected' : ''}>${escapeHTML(item.chemin)}</option>`
    ).join('')
  }</optgroup>`).join('');
}

/**
 * Ce que montre la colonne « Emplacement ».
 *
 * Elle n'affichait que le texte libre. Le rattachement structuré — le seul qui relie
 * l'unité à l'échelle des lieux — se saisissait puis disparaissait de la vue : rien, sur
 * cette page, ne disait où une salle était rattachée.
 *
 * Un `locationId` qui ne correspond à aucun lieu rend un chemin VIDE. Le taire afficherait
 * une case blanche indiscernable d'une salle non rattachée ; il est donc nommé.
 */
export function emplacementMarkup(salle, locations) {
  const rattachement = salle?.locationId ?? '';
  const chemin = rattachement ? locationBreadcrumb(rattachement, locations) : '';
  const libre = String(salle?.location || '').trim();
  const lignes = [];
  if (chemin) lignes.push(`<span class="salle-lieu-chemin">${escapeHTML(chemin)}</span>`);
  else if (rattachement) lignes.push('<span class="salle-lieu-orphelin">Rattachement introuvable</span>');
  if (libre) lignes.push(`<span class="salle-lieu-libre">${escapeHTML(libre)}</span>`);
  return lignes.join('');
}

/**
 * OÙ CET UTILISATEUR PEUT-IL CRÉER UNE SALLE ?
 *
 * Une salle qu'on crée n'a encore aucune zone : ni `resource_zones` ni aucune baie ne peut
 * la référencer. Le serveur refusait donc TOUTE création à un chef, avec pour seule
 * explication « Vous devez être autorisé dans toutes les zones » — un message qui ne
 * nomme rien. La zone devient donc un argument de création, choisi ici.
 *
 * Le choix n'est pas offert au hasard : seules les zones où l'utilisateur est membre ET
 * habilité à `room.edit` sont proposées, exactement la condition que le serveur revérifie.
 * L'administrateur global et le manager voient toutes les zones et peuvent n'en choisir
 * aucune — le serveur fabrique alors, dans la même réponse, une zone qui porte le nom de
 * la salle et son rattachement canonique.
 */
export function zonesDeCreationDeSalle(context) {
  const zones = (context?.zones || []).filter(zone => zone && zone.status !== 'inactive');
  if (context?.isGlobalAdmin) return zones;
  const membreDe = new Set((context?.memberships || [])
    .filter(item => item && item.status !== 'revoked').map(item => String(item.zoneId)));
  const habiliteSur = new Set((context?.grants || [])
    .filter(item => item && item.status !== 'revoked' && item.permission === 'room.edit')
    .map(item => String(item.zoneId)));
  return zones.filter(zone => membreDe.has(String(zone.id)) && habiliteSur.has(String(zone.id)));
}

/**
 * Le sélecteur de zone du formulaire d'ajout.
 *
 * Sans contexte, aucun champ : pour un rôle global c'est sans conséquence — il crée sans
 * zone — et pour un rôle à périmètre le formulaire entier a déjà été retiré, faute de
 * pouvoir lui présenter un choix qui aboutisse.
 */
export function selecteurDeZoneDeSalle(context) {
  if (!context) return '';
  const zones = zonesDeCreationDeSalle(context);
  const options = zones
    .map(zone => `<option value="${escapeHTML(zone.id)}">${escapeHTML(zone.name || zone.id)}</option>`)
    .join('');
  if (context.isGlobalAdmin) {
    return `<select name="zoneId" title="Zone d’exploitation de la salle">
            <option value="">Zone : créée automatiquement</option>${options}
          </select>`;
  }
  return `<select name="zoneId" required title="Zone d’exploitation de la salle">
            <option value="">Zone…</option>${options}
          </select>`;
}

/** Message affiché à la place du formulaire quand aucune zone n'est ouverte à la création. */
export const AUCUNE_ZONE_DE_CREATION =
  'Aucune zone ne vous autorise à créer une salle. Demandez l’habilitation « Modifier une salle » sur une zone, puis revenez ici.';

/**
 * Message affiché quand la liste des zones autorisées n'a pas pu être lue.
 *
 * Offrir quand même le formulaire semblait généreux ; ce ne l'était pas. Pour un rôle à
 * périmètre, la zone est obligatoire : sans la liste, la saisie ne peut aboutir, et hors
 * ligne elle devient une opération en attente que le serveur refusera plus tard — un
 * travail perdu, découvert longtemps après.
 */
export const ZONES_INDISPONIBLES =
  'Impossible de charger vos zones autorisées. Réessayez lorsque la connexion centrale est disponible.';

/** Message quand la connexion centrale manque : une salle sans zone est une salle perdue. */
export const EXPORT_SANS_AUTORITE =
  'L’export et l’import des salles exigent la connexion centrale : sans elle, leur zone d’autorisation ne peut être ni lue ni écrite.';

/**
 * Le seul chemin d'échange des salles — lecture comme écriture.
 *
 * Il n'y a pas de repli local : une salle écrite localement sans rattachement n'appartient
 * à personne, et l'échec ne se verrait qu'après coup.
 */
async function transfertDeSalles(options = {}) {
  if (typeof fetch !== 'function' || db.isCentralSyncReady?.() === false) {
    throw Object.assign(new Error(EXPORT_SANS_AUTORITE), { code: 'CENTRAL_AUTHORITY_REQUIRED' });
  }
  const response = await fetch('/api/rooms/transfer', {
    credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload.message || payload.error || `Erreur serveur (${response.status})`),
      { code: payload.error, status: response.status });
  }
  return payload;
}

/** Le contexte d'accès de la session, ou `null` s'il n'a pas pu être lu. */
async function chargerContexteAcces() {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  try {
    const response = await fetch('/api/access/context', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

export default class Salles {
  constructor(notifications) {
    this.notifications = notifications;
    this.filters = { responsible: '', search: '' };
    // `undefined` = jamais demandé ; `null` = demandé sans réponse exploitable.
    this.accessContext = undefined;
  }

  async render() {
    const [rooms, users, locations, baies, equipments, walls] = await Promise.all([
      db.getAll('rooms'),
      db.getAll('users'),
      db.getAll('locations'),
      // Trois magasins de plus, chargés UNE fois pour la liste entière — pas par ligne —
      // pour que « Gestion des Salles » puisse dire, sous Pilote, combien de baies et
      // d'équipements chaque salle porte réellement. `interactive-map.js` charge déjà les
      // trois mêmes magasins d'un coup pour tout le plan : même principe, ici pour la liste.
      db.getAll('baies'),
      db.getAll('equipments'),
      db.getAll('walls')
    ]);
    this.locations = locations || [];
    // Le filtre listait `manager` parmi les responsables de salle, à l'époque où manager
    // était un alias d'administrateur. `chef` encadre désormais aussi des salles.
    const responsibles = users.filter(u => ['responsible', 'responsable', 'chef', 'manager'].includes(u.role));
    let filteredRooms = rooms;
    if (this.filters.responsible) filteredRooms = filteredRooms.filter(r => r.responsibleId == this.filters.responsible);
    if (this.filters.search) {
      const query = this.filters.search.toLowerCase();
      // Le chemin structuré est affiché dans la colonne « Emplacement » : ne pas le
      // chercher rendrait « Casablanca » introuvable alors qu'il est écrit à l'écran.
      filteredRooms = filteredRooms.filter(r =>
        (r.name || '').toLowerCase().includes(query) ||
        (r.location || '').toLowerCase().includes(query) ||
        (r.locationId ? locationBreadcrumb(r.locationId, this.locations) : '').toLowerCase().includes(query)
      );
    }

    const currentUser = getCurrentUser();
    // Le contrat de permissions décide, action par action.
    //
    // Cette page comparait la chaîne brute du rôle à une liste écrite à la main —
    // `admin || manager || responsible || responsable` — et se trompait dans les DEUX sens.
    // Le CHEF n'y figurait pas : la matrice lui accorde `rooms.create`, `edit`, `assign` et
    // `export`, et le serveur lui accorde `room.edit` dans ses zones, mais l'écran lui
    // arrivait en lecture seule. Le RESPONSABLE y figurait : la matrice lui refuse les sept
    // actions et son plafond serveur exclut `room.edit`, si bien que chacun de ses boutons
    // menait à un 403 découvert APRÈS la saisie.
    //
    // Une seule autorisation « modifier » ne suffit pas non plus : le chef modifie mais ne
    // supprime pas, exporte mais n'importe pas. Chaque élément d'écran suit donc l'action
    // qu'il déclenche.
    const canCreate = PermissionManager.check(currentUser, 'rooms', 'create');
    const canEdit = PermissionManager.check(currentUser, 'rooms', 'edit');
    const canDelete = PermissionManager.check(currentUser, 'rooms', 'delete');
    const canAssign = PermissionManager.check(currentUser, 'rooms', 'assign');
    const canExport = PermissionManager.check(currentUser, 'rooms', 'export');
    const canImport = PermissionManager.check(currentUser, 'rooms', 'import');
    const canAct = canEdit || canDelete;

    // Admin et manager court-circuitent les zones côté serveur : la même règle qu'eux, lue
    // dans `roles.js`, et non une seconde formulation qui finirait par en diverger.
    const portéeGlobale = roleSeesEveryZone(currentUser?.role);
    if (canCreate && this.accessContext === undefined) this.accessContext = await chargerContexteAcces();
    const contexte = canCreate ? this.accessContext : null;
    // Trois états pour un rôle à périmètre, et non deux :
    //   • contexte lu et une zone ouverte      → le formulaire, avec son sélecteur ;
    //   • contexte lu et aucune zone ouverte   → la phrase qui dit quelle habilitation demander ;
    //   • contexte INDISPONIBLE                → la phrase qui dit quoi attendre.
    // Offrir le formulaire dans le troisième cas produisait une saisie que le serveur
    // refusera, et hors ligne une opération en attente rejetée bien plus tard.
    const contexteIndisponible = canCreate && !portéeGlobale && !contexte;
    const zoneOuverte = portéeGlobale || (Boolean(contexte) && zonesDeCreationDeSalle(contexte).length > 0);

    return `
      <div class="card">
        <div class="card-header">
          <h2>Gestion des Salles</h2>
          <div class="card-actions">
            ${canExport ? `<button id="export-salles" class="btn gray">Exporter JSON</button>` : ''}
            ${canImport ? `
              <button id="import-salles" class="btn gray">Importer JSON</button>
              <input type="file" id="import-salles-file" style="display:none">
            ` : ''}
          </div>
        </div>
        <div class="filters-container">
          <input type="text" id="salle-search" class="form-control" style="width:190px;" placeholder="Recherche salle..." value="${escapeHTML(this.filters.search)}">
          <select id="filter-responsible" class="form-control">
            <option value="">Responsable: Tous</option>
            ${responsibles.map(u => `<option value="${escapeHTML(u.id)}" ${this.filters.responsible == u.id ? 'selected' : ''}>${escapeHTML(u.fullName || u.username)}</option>`).join('')}
          </select>
          <button type="button" id="reset-salle-filters" class="btn gray" title="Réinitialiser les filtres" aria-label="Réinitialiser les filtres"><i class="fas fa-times"></i></button>
        </div>
        ${messageDePerimetre(currentUser, {
          permission: 'zone.summary.read',
          vide: filteredRooms.length === 0 && !this.filters.search && !this.filters.responsible,
          aucuneDonnee: 'Aucune salle dans votre périmètre pour le moment.'
        })}
        ${canCreate && contexteIndisponible ? `<p class="salle-zone-indisponible">${escapeHTML(ZONES_INDISPONIBLES)}</p>` : ''}
        ${canCreate && !contexteIndisponible && !zoneOuverte ? `<p class="salle-zone-absente">${escapeHTML(AUCUNE_ZONE_DE_CREATION)}</p>` : ''}
        ${replierLaCreation(canCreate && zoneOuverte ? `
        <form id="add-salle-form" class="flex" enctype="multipart/form-data" style="margin-bottom:20px;gap:10px;">
          <input name="name" type="text" placeholder="Nom salle" required>
          <input name="location" type="text" placeholder="Emplacement (texte libre)">
          <select name="locationId" title="Rattachement : ville, région ou département">
            <option value="">Rattachement…</option>
            ${optionsDeLocalisation(this.locations, '')}
          </select>
          ${selecteurDeZoneDeSalle(contexte)}
          ${canAssign ? `
          <select name="responsibleId">
            <option value="">Responsable</option>
            ${responsibles.map(u => `<option value="${escapeHTML(u.id)}">${escapeHTML(u.fullName || u.username)}</option>`).join('')}
          </select>
          ` : ''}
          <input name="image" type="file" accept="image/*">
          <div id="custom-fields-list"></div>
          <button type="button" class="btn" id="add-custom-field-btn"><i class="fas fa-plus"></i> Ajouter champ</button>
          <button class="btn">Ajouter</button>
        </form>
        ` : '', 'Ajouter une salle')}
        <div style="overflow-x:auto;">
        <table class="tableau">
          <tr>
            <th>Nom</th>
            <th>Image</th>
            <th>Emplacement</th>
            <th>Responsable</th>
            <th>Position</th>
            <th>Champs personnalisés</th>
            ${canAct ? `<th>Actions</th>` : ''}
          </tr>
          ${filteredRooms.map(salle => {
            // Mêmes trois faits que le panneau de la salle sur la carte
            // (`interactive-map.js`, `openPanel('room', …)`) — pas recalculés autrement,
            // pour que « 4 baies » signifie la même chose partout dans le produit.
            const baiesSalle = baies.filter(b => String(b.roomId) === String(salle.id)).length;
            const equipementsSalle = equipments.filter(eq => String(eq.roomId) === String(salle.id)).length;
            const murRelie = walls.some(w => String(w.roomId) === String(salle.id));
            return `
            <tr>
              <td>${escapeHTML(salle.name)}${pucesActifs([
                { icone: 'fa-cube', valeur: baiesSalle, libelleUn: 'baie', libelleN: 'baies' },
                { icone: 'fa-server', valeur: equipementsSalle, libelleUn: 'équipement', libelleN: 'équipements' },
                { icone: 'fa-border-all', libelleUn: murRelie ? 'Mur d’images relié' : 'Aucun mur relié' }
              ])}</td>
              <td>${salle.image ? `<img src="${escapeHTML(salle.image)}" class="img-preview" alt="${escapeHTML(salle.name || 'Salle')}">` : ''}</td>
              <td class="salle-lieu">${emplacementMarkup(salle, this.locations)}</td>
              <td>${escapeHTML((users.find(u => u.id == salle.responsibleId) || {}).fullName || '')}</td>
              <td>
                ${salle.coordinates ? `X:${escapeHTML(salle.coordinates.x)}, Y:${escapeHTML(salle.coordinates.y)}` : ''}
                ${canEdit ? `<button class="btn gray" data-id="${escapeHTML(salle.id)}" data-action="coord">Coord.</button>` : ''}
              </td>
              <td>
                ${salle.customFields && salle.customFields.length ? `
                  <ul>${salle.customFields.map(f => `<li><b>${escapeHTML(f.key)}</b>: ${escapeHTML(f.value)}</li>`).join('')}</ul>
                ` : ''}
              </td>
              ${canAct ? `<td style="white-space:nowrap;">
                ${canEdit ? `<button class="btn" data-id="${escapeHTML(salle.id)}" data-action="edit"><i class="fas fa-edit"></i> Modifier</button>` : ''}
                ${canDelete ? `<button class="btn danger" data-id="${escapeHTML(salle.id)}" data-action="del">Supprimer</button>` : ''}
              </td>` : ''}
            </tr>
          `;
          }).join('')}
        </table>
        </div>
      </div>
    `;
  }

  async afterRender() {
    const search = document.getElementById('salle-search');
    const responsibleFilter = document.getElementById('filter-responsible');
    const reset = document.getElementById('reset-salle-filters');
    if (search) search.oninput = e => { this.filters.search = e.target.value; this.refreshList(); };
    if (responsibleFilter) responsibleFilter.onchange = e => { this.filters.responsible = e.target.value; this.refreshList(); };
    if (reset) reset.onclick = () => { this.filters = { responsible: '', search: '' }; this.refreshList(); };

    const currentUser = getCurrentUser();
    // Les mêmes autorisations qu'au rendu, et pour la même raison : un gestionnaire posé
    // sur un bouton que le rôle ne devrait pas avoir le rend cliquable à nouveau dès qu'un
    // rendu partiel le réintroduit.
    const canCreate = PermissionManager.check(currentUser, 'rooms', 'create');
    const canEdit = PermissionManager.check(currentUser, 'rooms', 'edit');
    const canDelete = PermissionManager.check(currentUser, 'rooms', 'delete');

    if (canCreate && document.getElementById('add-salle-form')) {
      let customFields = [];
      const customFieldsList = document.getElementById('custom-fields-list');
      const updateFieldsList = () => {
        customFieldsList.innerHTML = customFields.map((f, i) => `
          <div class="cf-row" data-index="${i}" style="display:flex;gap:4px;">
            <input type="text" class="cf-key" placeholder="Clé" value="${escapeHTML(f.key || '')}" style="width:80px;">
            <input type="text" class="cf-value" placeholder="Valeur" value="${escapeHTML(f.value || '')}" style="width:130px;">
            <button type="button" class="btn-icon remove-cf" title="Supprimer"><i class="fas fa-times"></i></button>
          </div>
        `).join('');
        customFieldsList.querySelectorAll('.remove-cf').forEach(btn => {
          btn.onclick = () => {
            const idx = +btn.parentElement.dataset.index;
            customFields.splice(idx, 1);
            updateFieldsList();
          };
        });
        customFieldsList.querySelectorAll('.cf-key').forEach((inp, idx) => {
          inp.oninput = e => { customFields[idx].key = e.target.value; };
        });
        customFieldsList.querySelectorAll('.cf-value').forEach((inp, idx) => {
          inp.oninput = e => { customFields[idx].value = e.target.value; };
        });
      };

      document.getElementById('add-custom-field-btn').onclick = () => {
        customFields.push({ key: '', value: '' });
        updateFieldsList();
      };

      document.getElementById('add-salle-form').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        let imgData = '';
        if (form.image.files.length) imgData = await this.readFile(form.image.files[0]);
        // La zone est un ARGUMENT de création : le serveur la revérifie, l'inscrit dans
        // `resource_zones` puis la retire de l'enregistrement, pour qu'il n'existe jamais
        // deux endroits où lire la zone d'une salle.
        const zoneId = form.zoneId?.value || '';
        try {
          await db.save('rooms', {
            name: form.name.value.trim(),
            image: imgData,
            location: form.location.value.trim(),
            locationId: form.locationId?.value || null,
            responsibleId: form.responsibleId?.value || '',
            coordinates: null,
            customFields: customFields.filter(f => f.key && f.value),
            ...(zoneId ? { zoneId } : {}),
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } catch (error) {
          this.notifications?.showNotification(error.message || 'Impossible de créer cette salle.', 'error');
          return;
        }
        form.reset();
        customFields = [];
        updateFieldsList();
        this.notifications?.showNotification('Salle ajoutée avec succès.', 'success');
        this.refreshList();
      };
      updateFieldsList();
    }

    if (canEdit) {
      document.querySelectorAll('button[data-action="edit"]').forEach(btn => {
        btn.onclick = () => this.showEditModal(normalizeId(btn.getAttribute('data-id')));
      });
      document.querySelectorAll('button[data-action="coord"]').forEach(btn => {
        btn.onclick = () => this.showCoordModal(normalizeId(btn.getAttribute('data-id')));
      });
    }

    if (canDelete) {
      document.querySelectorAll('button[data-action="del"]').forEach(btn => {
        btn.onclick = async () => {
          const roomId = normalizeId(btn.getAttribute('data-id'));
          try {
            const room = await db.get('rooms', roomId);
            if (!room) throw new Error('La salle sélectionnée est introuvable.');
            const deps = await db.getRoomDependencies(roomId);
            const totalDependencies = deps.baies.length + deps.equipments.length + deps.walls.length + deps.screens.length;
            const details = totalDependencies
              ? `\n\nContenu lié :\n• ${deps.baies.length} baie(s)\n• ${deps.equipments.length} équipement(s)\n• ${deps.walls.length} mur(s)\n• ${deps.screens.length} écran(s)\n\nLe contenu opérationnel sera supprimé avec la salle. Les écrans possédant un historique technique protégé bloqueront automatiquement l’opération.`
              : '';
            const accepted = window.AppDialog
              ? await window.AppDialog.confirm(`Supprimer la salle « ${room.name || room.id} » ?${details}`)
              : confirm(`Supprimer la salle « ${room.name || room.id} » ?`);
            if (!accepted) return;

            let result;
            if (totalDependencies && typeof db.deleteRoomWithContentsSafely === 'function') {
              result = await db.deleteRoomWithContentsSafely(roomId);
            } else {
              await db.deleteRoomSafely(roomId);
              result = { removed: { baies: 0, equipments: 0, walls: 0, screens: 0 } };
            }

            const removed = result?.removed || {};
            const count = (removed.baies || 0) + (removed.equipments || 0) + (removed.walls || 0) + (removed.screens || 0);
            this.notifications?.showNotification(
              count ? `Salle supprimée avec ${count} élément(s) lié(s).` : 'Salle supprimée.',
              'success'
            );
            this.refreshList();
          } catch (error) {
            this.notifications?.showNotification(error.message || 'Impossible de supprimer cette salle.', 'error');
          }
        };
      });
    }

    /*
     * L'EXPORT ET L'IMPORT PASSENT PAR LE SERVEUR, avec la zone.
     *
     * L'export sortait `rooms[]` lu dans IndexedDB, présenté comme un format complet.
     * Il ne l'était pas : `resource_zones` — la seule vérité de la zone d'une salle —
     * n'existe pas côté navigateur. Réimporté, ce fichier déposait des salles rattachées
     * à rien, que plus aucun rôle à périmètre ne pouvait voir.
     *
     * L'import, lui, rejouait `db.save('rooms', …)` salle par salle : aucune vérification
     * de zone, aucune transaction, et un `room.zoneId` hérité réécrit tel quel.
     */
    if (document.getElementById('export-salles')) {
      document.getElementById('export-salles').onclick = async () => {
        try {
          const paquet = await transfertDeSalles();
          const blob = new Blob([JSON.stringify(paquet, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'salles.json';
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (error) {
          this.notifications?.showNotification(error.message || EXPORT_SANS_AUTORITE, 'error');
        }
      };
    }
    if (document.getElementById('import-salles')) {
      document.getElementById('import-salles').onclick = () => {
        document.getElementById('import-salles-file').click();
      };
      document.getElementById('import-salles-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          // Le contrat relit aussi bien nos fichiers que les anciens, dont le `zoneId`
          // n'est qu'une entrée de migration. C'est le SERVEUR qui vérifie et écrit.
          const paquet = readRoomTransfer(JSON.parse(await file.text()));
          const rapport = await transfertDeSalles({ method: 'POST', body: JSON.stringify(paquet) });
          const migrees = paquet.migratedFromLegacy.length
            ? ` ${paquet.migratedFromLegacy.length} zone(s) reprise(s) d’un fichier hérité.`
            : '';
          this.notifications?.showNotification(
            `${rapport.rooms} salle(s) importée(s) avec leur zone.${migrees}`, 'success');
          this.refreshList();
        } catch (error) {
          this.notifications?.showNotification(error.message || "Erreur lors de l'importation.", 'error');
        } finally {
          e.target.value = '';
        }
      };
    }
  }

  refreshList() {
    this.render().then(html => {
      const target = document.getElementById('admin-content') || document.getElementById('responsible-content');
      if (!target) return;
      target.innerHTML = html;
      this.afterRender();
    });
  }

  readFile(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  async showEditModal(idSalle) {
    const [salle, users] = await Promise.all([
      db.get('rooms', idSalle),
      db.getAll('users')
    ]);
    if (!salle) {
      this.notifications?.showNotification('Salle introuvable.', 'error');
      return;
    }
    const responsibles = users.filter(u => ['responsible', 'responsable', 'manager'].includes(u.role));
    document.getElementById('edit-room-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'edit-room-modal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    // La fenêtre dit CE QU'ELLE ÉDITE. C'est ce qui permet à `snapshot-divergence-ui.js`
    // de reconnaître une saisie en cours et d'avertir si la fiche bouge ailleurs, plutôt
    // que de la voir remplacée en silence par le prochain instantané.
    modal.dataset.entityStore = 'rooms';
    modal.dataset.entityId = String(salle.id);
    modal.innerHTML = `
      <div class="modal-content" style="max-width:620px;">
        <button type="button" class="close-modal" aria-label="Fermer">&times;</button>
        <h3>Modifier la salle</h3>
        <form id="edit-room-form">
          <div class="form-group"><label>Nom</label><input name="name" type="text" value="${escapeHTML(salle.name || '')}" required></div>
          <div class="form-group"><label>Emplacement (texte libre)</label><input name="location" type="text" value="${escapeHTML(salle.location || '')}"></div>
          <div class="form-group">
            <label>Rattachement</label>
            <select name="locationId">
              <option value="">— non rattachée —</option>
              ${optionsDeLocalisation(this.locations, salle.locationId)}
            </select>
            <small>Ville, région ou département. Une unité mobile garée dans une cour se rattache à sa ville ou à sa région : elle n’est dans aucun département, et sa place se pose ensuite sur le plan avec le bouton « Coord. ».</small>
          </div>
          <div class="form-group"><label>Responsable</label>${
            // Désigner le responsable d'une salle est `rooms.assign`, pas `rooms.edit` :
            // qui modifie une fiche ne décide pas forcément qui en répond. Sans
            // l'autorisation, le responsable actuel est montré mais pas modifiable — et
            // c'est `salle.responsibleId` qui est réenregistré tel quel.
            PermissionManager.check(getCurrentUser(), 'rooms', 'assign')
              ? `<select name="responsibleId"><option value="">Aucun responsable</option>${responsibles.map(u => `<option value="${escapeHTML(u.id)}" ${salle.responsibleId == u.id ? 'selected' : ''}>${escapeHTML(u.fullName || u.username)}</option>`).join('')}</select>`
              : `<p class="salle-responsable-fige">${escapeHTML((responsibles.find(u => u.id == salle.responsibleId) || {}).fullName || 'Aucun responsable')}</p>`
          }</div>
          <div class="form-group">
            <label>Place dans la chaîne du signal</label>
            <select name="chainSegment">
              <option value="">Non rattachée</option>
              ${chainSegmentOptions().map(option => `<option value="${escapeHTML(option.value)}" ${roomChainSegment(salle) === option.value ? 'selected' : ''}>${escapeHTML(option.label)}</option>`).join('')}
            </select>
            <small>Le bandeau de chaîne, présent sur toutes les pages, s’appuie sur ce rattachement. Une salle non rattachée y apparaît explicitement, plutôt que d’être devinée d’après son nom.</small>
          </div>
          <div class="form-group"><label>Image</label><input name="image" type="file" accept="image/*"><small>Laissez vide pour conserver l’image actuelle.</small></div>
          ${salle.image ? `<img src="${escapeHTML(salle.image)}" class="img-preview" alt="Aperçu salle" style="max-width:120px;max-height:90px;">` : ''}
          <div class="form-group"><label>Champs personnalisés</label><div id="edit-room-custom-fields"></div><button type="button" class="btn gray" id="edit-room-add-field"><i class="fas fa-plus"></i> Ajouter champ</button></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;"><button type="button" class="btn gray" id="cancel-edit-room">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    const fields = Array.isArray(salle.customFields) ? salle.customFields.map(field => ({ ...field })) : [];
    const fieldsHost = modal.querySelector('#edit-room-custom-fields');
    const renderFields = () => {
      fieldsHost.innerHTML = fields.map((field, index) => `
        <div class="cf-row" data-index="${index}" style="display:flex;gap:6px;margin-bottom:6px;">
          <input type="text" class="cf-key" placeholder="Clé" value="${escapeHTML(field.key || '')}">
          <input type="text" class="cf-value" placeholder="Valeur" value="${escapeHTML(field.value || '')}">
          <button type="button" class="btn-icon remove-cf" aria-label="Supprimer"><i class="fas fa-times"></i></button>
        </div>`).join('');
      fieldsHost.querySelectorAll('.cf-key').forEach((input, index) => input.oninput = event => { fields[index].key = event.target.value; });
      fieldsHost.querySelectorAll('.cf-value').forEach((input, index) => input.oninput = event => { fields[index].value = event.target.value; });
      fieldsHost.querySelectorAll('.remove-cf').forEach(button => button.onclick = () => {
        fields.splice(Number(button.parentElement.dataset.index), 1);
        renderFields();
      });
    };
    renderFields();
    modal.querySelector('#edit-room-add-field').onclick = () => { fields.push({ key:'', value:'' }); renderFields(); };

    const close = () => modal.remove();
    modal.querySelector('.close-modal').onclick = close;
    modal.querySelector('#cancel-edit-room').onclick = close;
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('#edit-room-form').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      let image = salle.image || '';
      if (form.image.files.length) image = await this.readFile(form.image.files[0]);
      try {
        await db.save('rooms', {
          ...salle,
          name: form.name.value.trim(),
          location: form.location.value.trim(),
          locationId: form.locationId?.value || null,
          responsibleId: form.responsibleId ? form.responsibleId.value : (salle.responsibleId ?? ''),
          // Chaîne vide = non rattachée. On écrit la valeur telle quelle : le contrat
          // se charge de traiter toute valeur inconnue comme une absence.
          chainSegment: form.chainSegment.value || '',
          image,
          customFields: fields.filter(field => field.key && field.value),
          updatedAt: new Date()
        });
        close();
        this.notifications?.showNotification('Salle modifiée avec succès.', 'success');
        this.refreshList();
      } catch (error) {
        this.notifications?.showNotification(error.message || 'Impossible de modifier cette salle.', 'error');
      }
    };
  }

  async showCoordModal(idSalle) {
    const salle = await db.get('rooms', idSalle);
    if (!salle) {
      this.notifications?.showNotification('Salle introuvable.', 'error');
      return;
    }
    /*
     * SANS PLAN AUTORISÉ, ON N'OUVRE PAS CETTE FENÊTRE.
     *
     * Elle partait du plan opérationnel comme valeur de repli, puis tentait de le
     * remplacer. Le repli s'appliquait donc exactement quand le serveur venait de refuser
     * les octets. On demande, et un refus ferme la fenêtre au lieu de la remplir.
     *
     * Le contrat de coordonnées est INCHANGÉ : les positions restent en `natural-px`, et
     * ne sont ni relues ni réécrites ici.
     */
    let mapImg = '';
    try {
      const settings = await db.get('settings', 'global') || await db.get('settings', 1);
      if (settings) mapImg = await resolveMapImageUrl(settings) || '';
    } catch {}
    if (!mapImg) {
      this.notifications?.showNotification(
        "Accès restreint : ce plan contient des informations hors de votre périmètre autorisé.", 'error');
      return;
    }
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff;padding:25px;border-radius:12px;max-width:540px;margin:10vh auto;position:relative;">
        <h3>Définir la position de la salle <span style="color:#2874a6">${escapeHTML(salle.name)}</span></h3>
        <div style="position:relative;">
          <img src="${escapeHTML(mapImg)}" id="plan-img" style="max-width:430px;border:1px solid #888;border-radius:8px;">
          <div id="marker" style="position:absolute;left:0;top:0;width:22px;height:22px;background:#2980b9b0;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;border-radius:50%;">S</div>
        </div>
        <br>
        <button class="btn gray" id="close-coord-modal">Annuler</button>
        <button class="btn" id="save-coord-modal">Enregistrer</button>
      </div>
    `;
    document.body.appendChild(modal);

    const planImg = modal.querySelector('#plan-img');
    const marker = modal.querySelector('#marker');
    // Les coordonnées sont posées en pixels de l'image NATURELLE, avec ses dimensions.
    // Elles étaient auparavant enregistrées en pixels de l'image telle qu'affichée — dans
    // une fenêtre plafonnée à 430 px — sans noter à quelle taille : le repère se déplaçait
    // dès que le plan s'affichait autrement. Le marqueur est donc placé, et relu, à travers
    // le contrat commun aux équipements.
    let coords = normalizeMapCoordinates(salle.coordinates) || { x: 20, y: 20, imgNaturalWidth: null, imgNaturalHeight: null, unit: 'natural-px' };
    const placeMarker = () => {
      const position = toDisplayCoordinates(coords, {
        displayWidth: planImg.clientWidth, displayHeight: planImg.clientHeight,
        naturalWidth: planImg.naturalWidth, naturalHeight: planImg.naturalHeight
      });
      marker.style.left = `${position.x}px`;
      marker.style.top = `${position.y}px`;
    };
    if (planImg.complete) queueMicrotask(placeMarker); else planImg.addEventListener('load', placeMarker);
    // Le plan peut être redimensionné par la fenêtre : le repère suit son point du plan.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(placeMarker) : null;
    observer?.observe(planImg);
    planImg.onclick = (e) => {
      coords = toNaturalCoordinates({
        clientX: e.clientX, clientY: e.clientY, rect: planImg.getBoundingClientRect(),
        naturalWidth: planImg.naturalWidth, naturalHeight: planImg.naturalHeight
      });
      placeMarker();
    };
    modal.querySelector('#close-coord-modal').onclick = () => { observer?.disconnect(); modal.remove(); };
    modal.querySelector('#save-coord-modal').onclick = async () => {
      await db.save('rooms', { ...salle, coordinates: normalizeMapCoordinates(coords), updatedAt: new Date() });
      observer?.disconnect();
      modal.remove();
      this.notifications?.showNotification('Position de la salle enregistrée.', 'success');
      this.refreshList();
    };
  }
}
