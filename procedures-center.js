import { db } from './db.js';
import AdminUI from './admin-ui.js';
import ResponsibleUI from './responsible-ui.js';
import TechUISmart from './techui.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';
import {
  CONTINUITY_KINDS, PROCEDURE_STEP_TYPES,
  normalizeContinuityProcedure, validateContinuityRecord
} from './continuity-contract.js';
import {
  PROCEDURE_KIND, buildCatalogs, filterProcedures, uniqueRefs,
  procedureEntityRefs, describeRef, NAVIGABLE_ENTITY_STORES
} from './engineering-refs.js';

/**
 * @file procedures-center.js — les procédures deviennent consultables par elles-mêmes.
 *
 * CE QUI MANQUAIT
 * ---------------
 * Les procédures existent déjà : contrat `continuity_procedure`, validation serveur,
 * révisions, audit. Mais elles ne sont atteignables QUE depuis « Continuité », et là
 * seulement à travers leur groupe de protection — `proceduresFor(groupId)`. Conséquences
 * mesurées sur le dépôt :
 *
 *   · aucune vue d'ensemble : on ne peut pas savoir combien il en existe, ni lesquelles ;
 *   · aucune recherche : retrouver « la procédure qui parle de la Régie 2 » suppose
 *     d'ouvrir les groupes un par un ;
 *   · aucune entrée par l'objet : le technicien part de la salle ou de la baie qu'il a
 *     devant lui, jamais d'un intitulé qu'il ne connaît pas encore.
 *
 * `navigation-groups.js` réservait déjà la place — « `procedures` n'existe pas encore.
 * La déclarer ICI plutôt qu'attendre. » Ce module l'occupe.
 *
 * CE QUE CE LOT NE FAIT PAS, ET LE DIT
 * ------------------------------------
 * La validation, les révisions et les tests de continuité restent dans « Continuité » :
 * ils engagent un circuit d'approbation audité que ce lot ne redéveloppe pas. Les boutons
 * correspondants ne sont donc pas dessinés ici ; à leur place, un renvoi explicite vers la
 * section qui les porte. Aucun bouton mort, aucune capacité annoncée qui n'agirait pas.
 *
 * AUCUNE DONNÉE INVENTÉE
 * ----------------------
 * Tout ce qui s'affiche vient de `docs` et des magasins d'entités. Une référence dont la
 * cible n'existe plus est dite NON RÉSOLUE plutôt que masquée ou remplacée.
 */

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const formatDate = value => value ? new Date(value).toLocaleString('fr-FR') : '—';
const STATUS_LABELS = Object.freeze({ draft:'Brouillon', documented:'Documenté', validated:'Validé', suspended:'Suspendu', retired:'Retiré' });
const STEP_LABELS = Object.freeze({
  prepare:'Préparer', secure:'Sécuriser', switch:'Basculer', verify:'Vérifier',
  fallback:'Repli', rollback:'Retour', escalate:'Escalader', note:'Note'
});
const statusLabel = value => STATUS_LABELS[value] || value || '—';
const stepLabel = value => STEP_LABELS[value] || value || 'Étape';
const duration = seconds => {
  const nombre = Number(seconds);
  if (!Number.isFinite(nombre) || nombre <= 0) return null;
  if (nombre < 60) return `${nombre} s`;
  const minutes = Math.floor(nombre / 60);
  const reste = nombre % 60;
  return reste ? `${minutes} min ${reste} s` : `${minutes} min`;
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials:'include', cache:'no-store',
    headers:{ 'Content-Type':'application/json', ...(options.headers || {}) }, ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `Erreur serveur (${response.status})`), { status:response.status, code:payload.error });
  return payload;
}

function modalShell(id, title, body) {
  document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.id = id; modal.className = 'modal procedures-modal';
  modal.innerHTML = `<div class="modal-content procedures-modal-card"><button class="modal-x" type="button" aria-label="Fermer">×</button><h3>${esc(title)}</h3>${body}</div>`;
  document.body.appendChild(modal); modal.style.display = 'flex';
  modal.querySelector('.modal-x').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  return modal;
}

/**
 * Une référence s'affiche TOUJOURS ; elle ne devient cliquable que s'il existe réellement
 * quelque chose à ouvrir. Trois cas, trois rendus distincts — c'est la règle « aucun bouton
 * mort » appliquée à la lettre :
 *   · équipement résolu ET `TechOperations` chargé → bouton qui ouvre la fiche 360 ;
 *   · entité résolue sans ouvreur → puce informative, avec son type et son nom réels ;
 *   · cible introuvable → puce « non résolue », visuellement distincte.
 */
function refChip(decrit, { canOpenEquipment = false } = {}) {
  const nom = esc(decrit.label);
  const type = esc(decrit.typeLabel);
  if (!decrit.resolved) {
    return `<span class="procedure-ref procedure-ref-missing" title="La cible de cette référence n’existe plus dans l’inventaire.">
      <i class="fas fa-unlink"></i> ${type} · ${nom} <em>— non résolue</em></span>`;
  }
  if (decrit.type === 'equipment' && canOpenEquipment) {
    return `<button type="button" class="procedure-ref procedure-ref-open" data-open-equipment="${esc(decrit.id)}">
      <i class="${esc(decrit.icon)}"></i> ${type} · ${nom}</button>`;
  }
  return `<span class="procedure-ref"><i class="${esc(decrit.icon)}"></i> ${type} · ${nom}</span>`;
}

export class ProceduresCenter {
  constructor(user = getCurrentUser(), notifications = null, { readOnly = false } = {}) {
    this.user = user; this.notifications = notifications; this.readOnly = readOnly;
    this.procedures = []; this.groups = []; this.catalogs = {}; this.query = '';
    this.access = { zones:[] };
  }

  notify(message, type = 'success') {
    if (this.notifications?.showNotification) this.notifications.showNotification(message, type);
    else console[type === 'error' ? 'error' : 'log'](message);
  }

  /*
   * DEUX VERROUS, ET IL EN FAUT DEUX — le contrat de `diagram-studio.js`, à la lettre.
   *
   * Le plafond de rôle (`permissions.js`) dit ce qu'un rôle a le droit de faire EN GÉNÉRAL.
   * L'autorité effective (`/api/access/context`) dit où il peut réellement l'exercer. Les
   * confondre a un coût mesuré sur ce dépôt : le chef possède `continuity {view, create}`
   * au plafond, mais AUCUN grant `continuity.read` sur une zone. Le serveur ne lui servait
   * donc aucun document — et la section, qui ne regardait que le plafond, lui affichait une
   * liste vide accompagnée d'un bouton « Nouvelle procédure » dont la seule issue possible
   * était « créez d'abord un groupe dans Continuité », conseil qu'il ne pouvait pas suivre.
   *
   * Une liste vide qui veut dire « vous n'avez pas l'autorité » ment par omission : elle se
   * lit « il n'y a rien », ce qui est faux. Le voisin `diagram-studio.js` refuse proprement
   * dans ce cas ; mesuré côte à côte sur le même compte chef, il affichait « Accès aux
   * schémas non autorisé » là où cette section montrait un écran trompeur.
   *
   * AUCUNE ACL N'EST CRÉÉE ICI, et aucun grant n'est accordé : on LIT `continuity.read` et
   * `continuity.edit`, qui existent déjà dans le vocabulaire des habilitations de zone.
   */
  isGlobalAdmin() { return ['admin', 'manager'].includes(this.user?.role); }

  /** Les zones où l'utilisateur exerce RÉELLEMENT `permission` : adhésion active ET grant actif. */
  zoneIdsWith(permission) {
    if (this.isGlobalAdmin()) return new Set((this.access?.zones || []).map(zone => String(zone.id)));
    const vivant = item => !['inactive', 'revoked'].includes(item.status)
      && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now());
    const adhesions = new Set((this.access?.memberships || []).filter(vivant).map(item => String(item.zoneId)));
    return new Set((this.access?.grants || [])
      .filter(item => item.permission === permission && vivant(item) && adhesions.has(String(item.zoneId)))
      .map(item => String(item.zoneId)));
  }

  /** Le plafond de rôle, seul. Sert à distinguer les DEUX refus, qui n'ont pas la même cause. */
  roleAllowsView() { return PermissionManager.check(this.user, 'continuity', 'view'); }
  canView() { return this.roleAllowsView() && (this.isGlobalAdmin() || this.zoneIdsWith('continuity.read').size > 0); }
  canCreate() {
    return !this.readOnly && PermissionManager.check(this.user, 'continuity', 'create')
      && (this.isGlobalAdmin() || this.zoneIdsWith('continuity.edit').size > 0);
  }

  /** L'autorité effective vient du serveur. Injoignable, on se ferme plutôt que de supposer. */
  async loadAccess() {
    this.access = await api('/api/access/context').catch(() => ({ zones:[] }));
    return this.access;
  }

  async load() {
    const [docs, rooms, baies, equipments, walls, screens, cables] = await Promise.all([
      db.getAll('docs'), db.getAll('rooms'), db.getAll('baies'),
      db.getAll('equipments'), db.getAll('walls'), db.getAll('screens'), db.getAll('cables')
    ]);
    // L'instantané central a DÉJÀ filtré par zone : ce qui arrive ici est ce que la session
    // a le droit de lire. On ne refiltre pas — on ne redécide pas d'une autorisation côté
    // navigateur, on affiche ce que le serveur a bien voulu servir.
    this.procedures = docs.filter(item => item?.kind === PROCEDURE_KIND);
    this.groups = docs.filter(item => item?.kind === CONTINUITY_KINDS.PROTECTION_GROUP);
    this.catalogs = buildCatalogs({ rooms, baies, equipments, walls, screens, cables });
  }

  groupName(id) {
    const groupe = this.groups.find(item => String(item.id) === String(id));
    return groupe?.name || groupe?.serviceName || null;
  }

  visibleProcedures() {
    const filtrees = filterProcedures(this.procedures, this.query, this.catalogs);
    // Le plus récemment touché d'abord : en régie on rouvre ce qu'on vient d'écrire.
    return filtrees.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }

  renderCard(procedure) {
    const refs = uniqueRefs(procedureEntityRefs(procedure)).slice(0, 6);
    const puces = refs.map(ref => refChip(describeRef(ref, this.catalogs))).join('');
    const total = uniqueRefs(procedureEntityRefs(procedure)).length;
    const reste = total > refs.length ? `<span class="procedure-ref procedure-ref-more">+${total - refs.length}</span>` : '';
    const groupe = this.groupName(procedure.protectionGroupId);
    const temps = duration(procedure.estimatedSeconds);
    const etapes = Array.isArray(procedure.steps) ? procedure.steps.length : 0;

    return `<article class="procedure-card" data-procedure-card="${esc(procedure.id)}">
      <header>
        <h3>${esc(procedure.title || 'Procédure sans titre')}</h3>
        <span class="procedure-status procedure-status-${esc(procedure.status || 'draft')}">${esc(statusLabel(procedure.status))}</span>
      </header>
      <p class="procedure-purpose">${esc(procedure.purpose || 'Objet non renseigné.')}</p>
      <ul class="procedure-meta">
        <li><i class="fas fa-code-branch"></i> Révision ${esc(procedure.revision || '1')}</li>
        <li><i class="fas fa-list-ol"></i> ${etapes} étape${etapes > 1 ? 's' : ''}</li>
        ${temps ? `<li><i class="fas fa-stopwatch"></i> ${esc(temps)}</li>` : ''}
        ${groupe ? `<li><i class="fas fa-shield-halved"></i> ${esc(groupe)}</li>` : '<li class="procedure-meta-missing"><i class="fas fa-shield-halved"></i> Groupe non résolu</li>'}
        <li><i class="fas fa-clock"></i> ${esc(formatDate(procedure.updatedAt || procedure.createdAt))}</li>
      </ul>
      ${puces || reste ? `<div class="procedure-refs">${puces}${reste}</div>` : '<div class="procedure-refs procedure-refs-empty">Aucune entité citée par cette procédure.</div>'}
      <footer><button type="button" class="btn" data-procedure-open="${esc(procedure.id)}"><i class="fas fa-book-open"></i> Ouvrir</button></footer>
    </article>`;
  }

  async render() {
    // Le plafond d'abord : inutile d'interroger l'autorité de zone d'un rôle qui n'a pas
    // le droit, et ce refus-là ne dépend d'aucune donnée.
    if (!this.roleAllowsView()) {
      return `<div class="card procedures-denied">
        <h2><i class="fas fa-lock"></i> Procédures</h2>
        <p>Votre rôle ne donne pas accès aux procédures d’exploitation.</p>
      </div>`;
    }
    try { await this.loadAccess(); }
    catch { this.access = { zones:[] }; }
    // L'autorité effective ensuite. Le message DIT la cause — « aucune zone » et non « aucune
    // procédure » — parce que les deux appellent des gestes différents : l'un se répare en
    // demandant une habilitation, l'autre en écrivant une procédure.
    if (!this.canView()) {
      return `<div class="card procedures-denied">
        <h2><i class="fas fa-lock"></i> Procédures</h2>
        <p>Aucune de vos zones ne vous accorde la lecture de la continuité
        (<code>continuity.read</code>). Les procédures existent peut-être, mais elles ne
        relèvent d’aucune zone où vous êtes habilité.</p>
        <p class="procedures-hint">Un administrateur de zone peut vous accorder cette
        habilitation depuis <strong>Accès par zone</strong>.</p>
      </div>`;
    }
    try { await this.load(); }
    catch (error) {
      return `<div class="card procedures-error"><h2><i class="fas fa-triangle-exclamation"></i> Procédures</h2>
        <p>Les procédures n’ont pas pu être chargées : ${esc(error.message)}</p></div>`;
    }

    const liste = this.visibleProcedures();
    const creation = this.canCreate()
      ? `<button type="button" class="btn" data-procedure-new><i class="fas fa-plus"></i> Nouvelle procédure</button>`
      : '';

    return `<div class="card procedures-center">
      <div class="card-header procedures-header">
        <div>
          <h2><i class="fas fa-list-check"></i> Procédures</h2>
          <p class="procedures-subtitle">${this.procedures.length} procédure${this.procedures.length > 1 ? 's' : ''} enregistrée${this.procedures.length > 1 ? 's' : ''} · lecture des données réelles de la plateforme</p>
        </div>
        <div class="procedures-actions">${creation}</div>
      </div>

      <label class="procedures-search">
        <i class="fas fa-magnifying-glass"></i>
        <input type="search" data-procedure-search placeholder="Rechercher par titre, étape, salle, baie, équipement…" value="${esc(this.query)}" aria-label="Rechercher une procédure">
      </label>

      <div class="procedures-list" data-procedures-list>
        ${liste.length
          ? liste.map(procedure => this.renderCard(procedure)).join('')
          : `<p class="procedures-empty">${this.procedures.length
              ? 'Aucune procédure ne correspond à cette recherche.'
              : 'Aucune procédure n’est enregistrée pour vos zones.'}</p>`}
      </div>

      <p class="procedures-note">
        <i class="fas fa-circle-info"></i>
        Validation, nouvelle révision et tests de bascule restent dans la section
        <strong>Continuité</strong>, qui porte leur circuit d’approbation audité.
      </p>
    </div>`;
  }

  async afterRender(root = document) {
    const hote = root.querySelector?.('.procedures-center') ? root : document;
    const champ = hote.querySelector('[data-procedure-search]');
    if (champ) {
      champ.oninput = () => {
        this.query = champ.value;
        const liste = hote.querySelector('[data-procedures-list]');
        if (!liste) return;
        const visibles = this.visibleProcedures();
        liste.innerHTML = visibles.length
          ? visibles.map(procedure => this.renderCard(procedure)).join('')
          : `<p class="procedures-empty">${this.procedures.length
              ? 'Aucune procédure ne correspond à cette recherche.'
              : 'Aucune procédure n’est enregistrée pour vos zones.'}</p>`;
        this.bindList(hote);
      };
    }
    this.bindList(hote);
    hote.querySelector('[data-procedure-new]')?.addEventListener('click', () => this.openCreateForm());
  }

  bindList(hote) {
    hote.querySelectorAll('[data-procedure-open]').forEach(bouton => {
      bouton.onclick = () => this.openDetail(bouton.dataset.procedureOpen);
    });
    hote.querySelectorAll('[data-open-equipment]').forEach(bouton => {
      bouton.onclick = () => this.openEquipment(bouton.dataset.openEquipment);
    });
  }

  /** L'ouvreur RÉEL de la fiche 360, celui d'`operations-suite.js`. Absent, on le dit. */
  openEquipment(id) {
    const ouvrir = typeof window !== 'undefined' ? window.TechOperations?.openEquipment360 : null;
    if (!ouvrir) return this.notify('La fiche 360 n’est pas disponible dans cette vue.', 'warning');
    const equipement = this.catalogs.equipments?.get(String(id));
    if (!equipement) return this.notify('Cet équipement n’existe plus dans l’inventaire.', 'warning');
    ouvrir(equipement);
  }

  renderStep(step, canOpenEquipment) {
    const refs = uniqueRefs(Array.isArray(step.entityRefs) ? step.entityRefs : []);
    const puces = refs.map(ref => refChip(describeRef(ref, this.catalogs), { canOpenEquipment })).join('');
    const temps = duration(step.estimatedSeconds);
    return `<li class="procedure-step procedure-step-${esc(step.type || 'note')}">
      <div class="procedure-step-head">
        <span class="procedure-step-type">${esc(stepLabel(step.type))}</span>
        <strong>${esc(step.title || 'Étape sans titre')}</strong>
        ${temps ? `<span class="procedure-step-time"><i class="fas fa-stopwatch"></i> ${esc(temps)}</span>` : ''}
      </div>
      <p class="procedure-step-instruction">${esc(step.instruction || 'Instruction non renseignée.')}</p>
      ${step.expectedResult ? `<p class="procedure-step-expected"><i class="fas fa-check"></i> Résultat attendu : ${esc(step.expectedResult)}</p>` : ''}
      ${step.warning ? `<p class="procedure-step-warning"><i class="fas fa-triangle-exclamation"></i> ${esc(step.warning)}</p>` : ''}
      ${puces ? `<div class="procedure-refs">${puces}</div>` : ''}
    </li>`;
  }

  openDetail(id) {
    const procedure = this.procedures.find(item => String(item.id) === String(id));
    if (!procedure) return this.notify('Procédure introuvable.', 'error');
    const canOpenEquipment = typeof window !== 'undefined' && Boolean(window.TechOperations?.openEquipment360);
    const groupe = this.groupName(procedure.protectionGroupId);
    const etapes = Array.isArray(procedure.steps) ? procedure.steps : [];
    const prerequis = Array.isArray(procedure.prerequisites) ? procedure.prerequisites.filter(Boolean) : [];
    const controles = Array.isArray(procedure.verificationChecks) ? procedure.verificationChecks.filter(Boolean) : [];

    const bloc = (titre, contenu) => contenu
      ? `<section class="procedure-block"><h4>${esc(titre)}</h4><p>${esc(contenu)}</p></section>` : '';

    const modal = modalShell('procedure-detail-modal', procedure.title || 'Procédure', `
      <div class="procedure-detail">
        <div class="procedure-detail-meta">
          <span class="procedure-status procedure-status-${esc(procedure.status || 'draft')}">${esc(statusLabel(procedure.status))}</span>
          <span>Révision ${esc(procedure.revision || '1')}</span>
          ${groupe ? `<span><i class="fas fa-shield-halved"></i> ${esc(groupe)}</span>` : '<span class="procedure-meta-missing">Groupe non résolu</span>'}
          <span><i class="fas fa-clock"></i> ${esc(formatDate(procedure.updatedAt || procedure.createdAt))}</span>
        </div>

        ${bloc('Objet', procedure.purpose)}

        ${prerequis.length ? `<section class="procedure-block"><h4>Prérequis</h4><ul class="procedure-plain-list">
          ${prerequis.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>` : ''}

        <section class="procedure-block">
          <h4>Étapes (${etapes.length})</h4>
          ${etapes.length
            ? `<ol class="procedure-steps">${etapes.map(step => this.renderStep(step, canOpenEquipment)).join('')}</ol>`
            : '<p class="procedures-empty">Cette procédure ne contient aucune étape.</p>'}
        </section>

        ${controles.length ? `<section class="procedure-block"><h4>Contrôles de vérification</h4><ul class="procedure-plain-list">
          ${controles.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>` : ''}

        ${bloc('Repli si le secours échoue', procedure.fallbackSummary)}
        ${bloc('Retour contrôlé', procedure.rollbackSummary)}
        ${bloc('Escalade', procedure.escalation)}
        ${bloc('Notes', procedure.notes)}

        <p class="procedures-note"><i class="fas fa-circle-info"></i>
          Pour valider cette procédure, en créer une révision ou consigner un test,
          ouvrez la section <strong>Continuité</strong>.</p>
      </div>`);

    modal.querySelectorAll('[data-open-equipment]').forEach(bouton => {
      bouton.onclick = () => this.openEquipment(bouton.dataset.openEquipment);
    });
    return modal;
  }

  /**
   * CRÉATION SIMPLE — et le contrat serveur reste maître.
   *
   * `validateContinuityRecord` exige un `protectionGroupId` : une procédure sans groupe est
   * refusée EN BASE, pas seulement à l'écran. On ne contourne pas cette règle et on ne la
   * réécrit pas depuis un lot d'interface — on la rend visible. Sans groupe existant, le
   * formulaire ne s'ouvre donc pas : il renvoie vers « Continuité », là où un groupe se crée.
   *
   * Ce que ce formulaire apporte, et que celui de « Continuité » ne fait pas : des étapes
   * LIBRES, et surtout des entités citées CHOISIES — une salle, une baie, un mur, un écran.
   * Le formulaire de continuité, lui, impose trois étapes fixes et hérite les références du
   * groupe. Les deux chemins écrivent le même contrat ; ils ne servent pas le même besoin.
   */
  openCreateForm() {
    if (!this.canCreate()) return this.notify('Votre rôle ne permet pas de créer une procédure.', 'warning');
    if (!this.groups.length) {
      return this.notify('Une procédure doit référencer un groupe de protection. Créez-le d’abord dans la section Continuité.', 'warning');
    }

    const optionsGroupes = this.groups
      .map(groupe => `<option value="${esc(groupe.id)}">${esc(groupe.name || groupe.serviceName || groupe.id)}</option>`).join('');
    const optionsEntites = Object.entries(NAVIGABLE_ENTITY_STORES).flatMap(([type, meta]) => {
      const catalogue = this.catalogs[meta.store];
      if (!catalogue) return [];
      return [...catalogue.values()].slice(0, 200).map(record =>
        `<option value="${esc(type)}::${esc(record.id)}">${esc(meta.label)} · ${esc(record.name || record.nom || record.id)}</option>`);
    }).join('');
    const optionsTypes = PROCEDURE_STEP_TYPES
      .map(type => `<option value="${esc(type)}">${esc(stepLabel(type))}</option>`).join('');

    const modal = modalShell('procedure-create-modal', 'Nouvelle procédure', `
      <form class="procedures-form">
        <label>Groupe de protection
          <select name="protectionGroupId" required>${optionsGroupes}</select>
        </label>
        <label>Titre
          <input name="title" required maxlength="240" placeholder="Bascule encodeur RF1">
        </label>
        <label>Objet
          <textarea name="purpose" rows="2" placeholder="Ce que cette procédure permet de rétablir."></textarea>
        </label>
        <label>Prérequis (un par ligne)
          <textarea name="prerequisites" rows="2"></textarea>
        </label>

        <fieldset class="procedures-steps-field">
          <legend>Étapes</legend>
          <p class="procedures-hint">Au moins une étape, avec un titre et une instruction — le serveur les exige.</p>
          <div data-step-rows></div>
          <button type="button" class="btn gray" data-step-add><i class="fas fa-plus"></i> Ajouter une étape</button>
        </fieldset>

        <label>Entités concernées
          <select name="entityRefs" multiple size="6">${optionsEntites}</select>
          <span class="procedures-hint">Salles, baies, équipements, murs, écrans et câbles réellement enregistrés.</span>
        </label>

        <div class="modal-actions">
          <button type="button" class="btn gray cancel">Annuler</button>
          <button type="submit" class="btn">Enregistrer le brouillon</button>
        </div>
      </form>`);

    const rangees = modal.querySelector('[data-step-rows]');
    const ajouterEtape = () => {
      const ligne = document.createElement('div');
      ligne.className = 'procedures-step-row';
      ligne.innerHTML = `<select name="stepType">${optionsTypes}</select>
        <input name="stepTitle" placeholder="Titre de l’étape" maxlength="240">
        <input name="stepInstruction" placeholder="Instruction">
        <button type="button" class="btn gray" data-step-remove aria-label="Retirer l’étape">×</button>`;
      ligne.querySelector('[data-step-remove]').onclick = () => {
        if (rangees.children.length > 1) ligne.remove();
      };
      rangees.appendChild(ligne);
    };
    ajouterEtape();
    modal.querySelector('[data-step-add]').onclick = ajouterEtape;
    modal.querySelector('.cancel').onclick = () => modal.remove();

    modal.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const formulaire = event.currentTarget;
      try {
        const groupeId = formulaire.protectionGroupId.value;
        const groupe = this.groups.find(item => String(item.id) === String(groupeId));
        // Les zones viennent du GROUPE, jamais d'une saisie : le serveur refuse une donnée de
        // continuité sans zone, et laisser l'auteur la déclarer serait lui laisser choisir sa
        // propre portée. `screen_groups` (#119) a montré ce que coûte une portée déclarée.
        const zoneIds = Array.isArray(groupe?.zoneIds) ? groupe.zoneIds : [];

        const entityRefs = [...formulaire.entityRefs.selectedOptions].map(option => {
          const [type, id] = String(option.value).split('::');
          return { type, id };
        });

        const types = [...formulaire.querySelectorAll('[name="stepType"]')];
        const titres = [...formulaire.querySelectorAll('[name="stepTitle"]')];
        const instructions = [...formulaire.querySelectorAll('[name="stepInstruction"]')];
        const steps = types.map((select, index) => ({
          type:select.value,
          title:titres[index]?.value || '',
          instruction:instructions[index]?.value || '',
          // Les entités choisies sont portées par la PREMIÈRE étape : les répartir au hasard
          // sur les autres inventerait une précision que l'auteur n'a pas donnée.
          entityRefs:index === 0 ? entityRefs : []
        })).filter(step => step.title || step.instruction);

        // Aucun identifiant frappé ici : `normalizeContinuityProcedure` en mint un quand il
        // manque, et en dupliquer la recette ferait diverger deux conventions d'identifiant
        // pour le même magasin.
        const record = normalizeContinuityProcedure({
          protectionGroupId:groupeId,
          title:formulaire.title.value,
          purpose:formulaire.purpose.value,
          revision:'1',
          status:'draft',
          verificationStatus:'draft',
          validation:null,
          zoneIds,
          authorId:this.user?.id ?? null,
          prerequisites:String(formulaire.prerequisites.value || '').split('\n').map(item => item.trim()).filter(Boolean),
          steps
        }, null);

        const erreurs = validateContinuityRecord(record);
        if (erreurs.length) throw new Error(erreurs.join(' '));

        const payload = await api(`/api/data/docs/${encodeURIComponent(record.id)}`, { method:'PUT', body:JSON.stringify(record) });
        const enregistre = payload.record || record;
        await (db.saveLocalOnly ? db.saveLocalOnly('docs', enregistre) : db.save('docs', enregistre));
        modal.remove();
        this.notify('Procédure enregistrée en brouillon.');
        await this.refreshInPlace();
      } catch (error) { this.notify(error.message, 'error'); }
    };
    return modal;
  }

  /** Recharger sans repasser par le routeur : la section reste où elle est. */
  async refreshInPlace() {
    const hote = document.querySelector('.procedures-center')?.parentElement;
    if (!hote) return;
    hote.innerHTML = await this.render();
    await this.afterRender(hote);
  }
}

/*
 * ENREGISTREMENT — la même mécanique en couches que `diagram-studio.js`.
 *
 * `navigation-groups.js` a déjà décidé que `procedures` appartient à « Ingénierie », aux
 * côtés de `diagrams` et `knowledge` : la section arrive donc à sa place sans qu'aucun
 * regroupement ne soit touché.
 *
 * Le technicien reçoit un BOUTON et non une section : `permissions.js` lui accorde
 * `continuity {view:true, create:false}` — il consulte, il n'écrit pas. Lui poser une
 * section d'écriture contredirait la matrice ; lui refuser la consultation aussi.
 */
const PATCH_FLAG = Symbol.for('2m-tech.procedures-center.patched');
const sectionEntry = (user, notifications) => ({
  title:'Procédures', icon:'fas fa-list-check',
  component:new ProceduresCenter(user, notifications)
});

if (!AdminUI.prototype[PATCH_FLAG]) {
  const previous = AdminUI.prototype.initSections;
  AdminUI.prototype.initSections = function initSectionsWithProcedures() {
    const sections = previous.call(this); const ordered = {};
    // Juste après « Schémas techniques » : « Ingénierie » les tient ensemble, et le menu
    // suit alors l'ordre du groupe plutôt que l'ordre d'enregistrement des modules.
    for (const [key, value] of Object.entries(sections)) {
      ordered[key] = value;
      if (key === 'diagrams') ordered.procedures = ordered.procedures || sectionEntry(this.user, this.notifications);
    }
    if (!ordered.procedures) ordered.procedures = sectionEntry(this.user, this.notifications);
    return ordered;
  };
  Object.defineProperty(AdminUI.prototype, PATCH_FLAG, { value:true });
}

if (!ResponsibleUI.prototype[PATCH_FLAG]) {
  const previous = ResponsibleUI.prototype.renderBaseLayout;
  ResponsibleUI.prototype.renderBaseLayout = function renderResponsibleWithProcedures() {
    if (!this.sections.procedures) this.sections = { procedures:{ title:'Procédures', icon:'fas fa-list-check', component:new ProceduresCenter(this.user, this.notifications) }, ...this.sections };
    return previous.call(this);
  };
  Object.defineProperty(ResponsibleUI.prototype, PATCH_FLAG, { value:true });
}

/**
 * Ouvrir UNE procédure par son identifiant, depuis n'importe où — la fiche 360 s'en sert.
 *
 * On recharge plutôt que de partager une instance : la fiche 360 s'ouvre longtemps après le
 * rendu de la section, et servir un instantané périmé afficherait une procédure telle
 * qu'elle était, pas telle qu'elle est.
 */
export async function openProcedureById(id, user = getCurrentUser(), notifications = null) {
  const centre = new ProceduresCenter(user, notifications, { readOnly:true });
  if (!centre.roleAllowsView()) return null;
  // L'autorité de zone se lit AVANT d'ouvrir : `canView()` en dépend, et l'interroger sans
  // l'avoir chargée refuserait tout le monde sauf l'administrateur global.
  await centre.loadAccess().catch(() => {});
  if (!centre.canView()) return null;
  await centre.load();
  return centre.openDetail(id);
}

export async function openProceduresLibrary(user = getCurrentUser(), notifications = null) {
  const modal = modalShell('procedures-library-modal', 'Procédures', '<div class="procedures-library-host"><div class="loading-spinner"><p>Chargement…</p></div></div>');
  const hote = modal.querySelector('.procedures-library-host');
  const centre = new ProceduresCenter(user, notifications, { readOnly:true });
  hote.innerHTML = await centre.render();
  await centre.afterRender(hote);
  return centre;
}

if (!TechUISmart.prototype[PATCH_FLAG]) {
  const previous = TechUISmart.prototype.bindGlobalActions;
  TechUISmart.prototype.bindGlobalActions = function bindTechnicalProcedures(...args) {
    const result = previous ? previous.apply(this, args) : undefined;
    const host = document.querySelector('.smart-tech-header .header-actions');
    if (host && !host.querySelector('#tech-procedures-btn') && PermissionManager.check(this.user, 'continuity', 'view')) {
      const button = document.createElement('button');
      button.id = 'tech-procedures-btn'; button.className = 'btn gray';
      button.innerHTML = '<i class="fas fa-list-check"></i> Procédures';
      button.onclick = () => openProceduresLibrary(this.user, this.notifications);
      host.prepend(button);
    }
    return result;
  };
  Object.defineProperty(TechUISmart.prototype, PATCH_FLAG, { value:true });
}

export default ProceduresCenter;
