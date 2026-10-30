/**
 * @file locations-section.js — gérer villes, régions et départements.
 *
 * La plateforme s'arrêtait à la salle. Au-dessus, il n'y avait qu'un champ `location`
 * libre : du texte, sans structure, sans parent, impossible à parcourir ni à totaliser.
 * Deux salles du même bâtiment n'avaient aucun lien, et rien ne permettait de demander
 * « tout ce qui est à Casablanca ».
 *
 * Cette section rend l'échelle visible et modifiable :
 *
 *     Ville → Région → Département → Salle → Baie → Équipement
 *
 * Elle s'insère comme les autres sections, par enveloppe de `AdminUI.prototype.initSections`
 * — le mécanisme déjà utilisé par une dizaine de modules — et n'exige donc aucune
 * modification d'admin-ui.js.
 */

import AdminUI from './admin-ui.js';
import { db } from './db.js';
import { PermissionManager } from './permissions.js';
import {
  LOCATION_KINDS, LOCATION_ORDER, LOCATION_LABELS, LOCATION_LABELS_PLURAL,
  normalizeLocation, normalizeLocationKind, locationLabel, locationTree,
  locationBreadcrumb, locationDeletionBlockers, eligibleParents, parentKind, childKind
} from './location-contract.js';

export const LOCATIONS_SECTION_VERSION = 1;

const PATCH_FLAG = Symbol.for('2m-tech.locations-section.patched');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

const ICONES = Object.freeze({
  [LOCATION_KINDS.CITY]: 'fas fa-city',
  [LOCATION_KINDS.REGION]: 'fas fa-map-marked-alt',
  [LOCATION_KINDS.DEPARTMENT]: 'fas fa-sitemap'
});

export default class LocationsSection {
  constructor(notifications) {
    this.notifications = notifications;
    this.user = (() => { try { return JSON.parse(localStorage.getItem('auth')) || {}; } catch { return {}; } })();
  }

  async render() {
    const [locations, rooms] = await Promise.all([db.getAll('locations'), db.getAll('rooms')]);
    this.locations = (locations || []).map(normalizeLocation).filter(Boolean);
    this.rooms = rooms || [];

    // Les localisations suivent les mêmes droits que les salles : ce sont des lieux, et
    // inventer une entité de permission séparée ferait diverger les deux échelles.
    const peutCreer = PermissionManager.check(this.user, 'rooms', 'create');
    const peutModifier = PermissionManager.check(this.user, 'rooms', 'edit');
    const peutSupprimer = PermissionManager.check(this.user, 'rooms', 'delete');
    this.droits = { peutCreer, peutModifier, peutSupprimer };

    const arbre = locationTree(this.locations);
    // Une localisation dont le parent a disparu n'apparaîtrait dans aucun arbre : elle
    // deviendrait introuvable tout en restant en base. On la montre à part.
    const dansArbre = new Set();
    const parcourir = noeuds => { for (const n of noeuds) { dansArbre.add(String(n.id)); parcourir(n.children); } };
    parcourir(arbre);
    const detachees = this.locations.filter(item => !dansArbre.has(String(item.id)));

    const compteurs = LOCATION_ORDER.map(kind => ({
      kind,
      label: LOCATION_LABELS_PLURAL[kind],
      total: this.locations.filter(item => item.kind === kind).length
    }));

    return `
      <div class="locations-section">
        <header class="locations-head">
          <div>
            <span class="locations-eyebrow">Échelle des lieux</span>
            <h2>Villes, régions et départements</h2>
            <p class="locations-lead">Ville › Région › Département › Salle › Baie › Équipement.</p>
          </div>
          ${peutCreer ? `<div class="locations-actions">
            ${LOCATION_ORDER.map(kind =>
              `<button type="button" class="btn" data-nouvelle="${kind}">
                 <i class="${ICONES[kind]}"></i> Nouvelle ${LOCATION_LABELS[kind].toLowerCase()}
               </button>`).join('')}
          </div>` : ''}
        </header>

        <div class="locations-counters">
          ${compteurs.map(c => `
            <div class="locations-counter" data-kind="${c.kind}">
              <span class="locations-counter-value">${c.total}</span>
              <span class="locations-counter-label">${esc(c.label)}</span>
            </div>`).join('')}
          <div class="locations-counter">
            <span class="locations-counter-value">${this.rooms.filter(r => r.locationId).length}/${this.rooms.length}</span>
            <span class="locations-counter-label">Salles situées</span>
          </div>
        </div>

        ${this.locations.length ? '' : `
          <p class="locations-empty">Aucune localisation enregistrée. Commencez par créer une ville :
          les régions s'y rattacheront, puis les départements, puis les salles.</p>`}

        <div class="locations-tree" role="tree">${this.arbreMarkup(arbre)}</div>

        ${detachees.length ? `
          <section class="locations-detached">
            <h3>Rattachement manquant</h3>
            <p>Ces localisations n'ont plus de parent : elles restent enregistrées mais n'apparaissent
               dans aucune branche tant qu'elles ne sont pas rattachées.</p>
            <ul>${detachees.map(item => this.ligneMarkup(item, 0)).join('')}</ul>
          </section>` : ''}
      </div>`;
  }

  arbreMarkup(noeuds, profondeur = 0) {
    if (!noeuds.length) return '';
    return `<ul class="locations-branch" style="--profondeur:${profondeur}">${noeuds.map(noeud => `
      <li class="locations-node" data-id="${esc(noeud.id)}" role="treeitem">
        ${this.ligneMarkup(noeud, profondeur)}
        ${this.arbreMarkup(noeud.children || [], profondeur + 1)}
      </li>`).join('')}</ul>`;
  }

  ligneMarkup(item, profondeur) {
    const salles = this.rooms.filter(r => String(r.locationId ?? '') === String(item.id));
    const suivant = childKind(item.kind);
    return `
      <div class="locations-row" data-id="${esc(item.id)}" data-kind="${esc(item.kind)}">
        <span class="locations-icon"><i class="${ICONES[item.kind] || 'fas fa-map-pin'}"></i></span>
        <span class="locations-name">${esc(item.name)}</span>
        <span class="locations-kind">${esc(locationLabel(item.kind))}</span>
        ${item.code ? `<span class="locations-code">${esc(item.code)}</span>` : ''}
        ${salles.length ? `<span class="locations-rooms">${salles.length} salle(s)</span>` : ''}
        <span class="locations-row-actions">
          ${this.droits.peutCreer && suivant
            ? `<button type="button" class="btn-icon" data-ajouter-enfant="${esc(item.id)}" data-kind="${suivant}"
                       title="Ajouter ${LOCATION_LABELS[suivant].toLowerCase()}"><i class="fas fa-plus"></i></button>` : ''}
          ${this.droits.peutModifier
            ? `<button type="button" class="btn-icon" data-modifier="${esc(item.id)}" title="Modifier"><i class="fas fa-pen"></i></button>` : ''}
          ${this.droits.peutSupprimer
            ? `<button type="button" class="btn-icon danger" data-supprimer="${esc(item.id)}" title="Supprimer"><i class="fas fa-trash"></i></button>` : ''}
        </span>
      </div>`;
  }

  afterRender(host) {
    const racine = host || document.getElementById('admin-content');
    if (!racine) return;
    // UN SEUL écouteur, quoi qu'il arrive.
    //
    // `rafraichir()` réécrit `innerHTML` mais ne remplace PAS `#admin-content` : l'élément
    // survit, et avec lui ses écouteurs. Sans ce garde-fou, chaque rafraîchissement en
    // ajoutait un — mesuré dans le navigateur : après une première création, un seul clic
    // ouvrait DEUX fenêtres superposées, dont la seconde interceptait les clics de la
    // première.
    if (this._lie === racine) return;
    this._lie = racine;
    racine.addEventListener('click', async event => {
      const bouton = event.target.closest('button');
      if (!bouton || !racine.contains(bouton)) return;
      if (bouton.dataset.nouvelle) {
        event.preventDefault();
        await this.ouvrirFormulaire({ kind: bouton.dataset.nouvelle });
      } else if (bouton.dataset.ajouterEnfant) {
        event.preventDefault();
        await this.ouvrirFormulaire({ kind: bouton.dataset.kind, parentId: bouton.dataset.ajouterEnfant });
      } else if (bouton.dataset.modifier) {
        event.preventDefault();
        const item = this.locations.find(l => String(l.id) === String(bouton.dataset.modifier));
        if (item) await this.ouvrirFormulaire(item);
      } else if (bouton.dataset.supprimer) {
        event.preventDefault();
        await this.supprimer(bouton.dataset.supprimer);
      }
    });
  }

  async ouvrirFormulaire(source) {
    const modification = Boolean(source?.id);
    const kind = normalizeLocationKind(source?.kind);
    const parents = eligibleParents(kind, this.locations);
    const attendu = parentKind(kind);

    const fenetre = document.createElement('div');
    fenetre.className = 'modal locations-modal';
    fenetre.innerHTML = `
      <div class="modal-content">
        <h3>${modification ? 'Modifier' : 'Nouvelle'} ${esc(locationLabel(kind).toLowerCase())}</h3>
        <form id="loc-form">
          <div class="form-group">
            <label for="loc-name">Nom</label>
            <input id="loc-name" name="name" required value="${esc(source?.name || '')}" autocomplete="off">
          </div>
          <div class="form-group">
            <label for="loc-code">Code (facultatif)</label>
            <input id="loc-code" name="code" value="${esc(source?.code || '')}" autocomplete="off"
                   placeholder="ex. CASA, STC">
          </div>
          ${attendu ? `
          <div class="form-group">
            <label for="loc-parent">${esc(LOCATION_LABELS[attendu])} de rattachement</label>
            <select id="loc-parent" name="parentId">
              <option value="">— non rattaché —</option>
              ${parents.map(p => `<option value="${esc(p.id)}"${String(p.id) === String(source?.parentId ?? '') ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
            ${parents.length ? '' : `<p class="form-hint">Aucune ${esc(LOCATION_LABELS[attendu].toLowerCase())} n'existe encore : créez-la d'abord, ou laissez non rattaché.</p>`}
          </div>` : ''}
          <div class="form-group">
            <label for="loc-description">Description</label>
            <textarea id="loc-description" name="description" rows="2">${esc(source?.description || '')}</textarea>
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn">Enregistrer</button>
            <button type="button" class="btn gray" data-fermer>Annuler</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(fenetre);
    fenetre.querySelector('#loc-name')?.focus();

    const fermer = () => fenetre.remove();
    fenetre.querySelector('[data-fermer]').onclick = fermer;
    fenetre.addEventListener('click', e => { if (e.target === fenetre) fermer(); });

    fenetre.querySelector('#loc-form').onsubmit = async event => {
      event.preventDefault();
      const donnees = new FormData(event.target);
      const enregistrement = normalizeLocation({
        ...(modification ? source : {}),
        kind,
        name: donnees.get('name'),
        code: donnees.get('code'),
        description: donnees.get('description'),
        parentId: attendu ? (donnees.get('parentId') || null) : null
      });
      if (!enregistrement) {
        this.notifications?.showNotification('Le nom est obligatoire.', 'warning');
        return;
      }
      // Un identifiant stable, lisible dans les journaux et dans l'URL.
      if (!modification) {
        enregistrement.id = `${kind}-${Date.now().toString(36)}`;
        enregistrement.createdAt = new Date().toISOString();
      }
      enregistrement.updatedAt = new Date().toISOString();
      try {
        await db.save('locations', enregistrement);
        this.notifications?.showNotification(
          `${locationLabel(kind)} « ${enregistrement.name} » enregistrée.`, 'success');
        fermer();
        await this.rafraichir();
      } catch (error) {
        this.notifications?.showNotification(error?.message || 'Enregistrement impossible.', 'error');
      }
    };
  }

  async supprimer(id) {
    const item = this.locations.find(l => String(l.id) === String(id));
    if (!item) return;
    // On refuse AVANT de demander confirmation : proposer une action impossible puis la
    // refuser après un « oui » est plus déroutant que de l'expliquer tout de suite.
    const empechements = locationDeletionBlockers(id, { locations: this.locations, rooms: this.rooms });
    if (empechements.length) {
      this.notifications?.showNotification(
        `Suppression impossible : ${empechements.join(', ')}. Détachez-les d'abord.`, 'warning');
      return;
    }
    const chemin = locationBreadcrumb(id, this.locations);
    if (!confirm(`Supprimer « ${chemin || item.name} » ?`)) return;
    try {
      await db.delete('locations', item.id);
      this.notifications?.showNotification('Localisation supprimée.', 'success');
      await this.rafraichir();
    } catch (error) {
      this.notifications?.showNotification(error?.message || 'Suppression impossible.', 'error');
    }
  }

  async rafraichir() {
    const hote = document.getElementById('admin-content');
    if (!hote) return;
    hote.innerHTML = await this.render();
    this.afterRender(hote);
  }
}

/** Enregistre la section, comme le font les autres modules de la plateforme. */
export function installLocationsSection() {
  if (AdminUI.prototype[PATCH_FLAG]) return;
  const original = AdminUI.prototype.initSections;
  AdminUI.prototype.initSections = function initSectionsWithLocations() {
    const sections = original.call(this);
    sections.locations = {
      title: 'Localisations',
      icon: 'fas fa-map-marked-alt',
      component: new LocationsSection(this.notifications)
    };
    return sections;
  };
  Object.defineProperty(AdminUI.prototype, PATCH_FLAG, { value: true });
}

installLocationsSection();
