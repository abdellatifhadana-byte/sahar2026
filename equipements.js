// equipements.js — منصة 2M TECH، إدارة الأجهزة (إصدار كامل)
// يعتمد على: db.js, qr.js, security.js, notifications.js ... إلخ

import { db } from './db.js';
import { generateQR } from './qr.js';
import { getCurrentUser } from './security.js';
import { PermissionManager } from './permissions.js';
import { messageDePerimetre } from './zone-scope-notice.js';
import { NotificationSystem } from './notifications.js';
import { normalizeRelationId } from './equipment-write-contract.js';
import {
  equipmentStatus, equipmentStatusLabel, statusFilterOptions, statusInputOptions
} from './equipment-status-contract.js';

export default class Equipements {
  constructor(notifications) {
    this.notifications = notifications;
    this.filters = { type: '', statut: '', salle: '', search: '' };
    this.sortField = 'name';
    this.sortDirection = 'asc';
    this.editingEquip = null;
  }

  /** =========== العرض الرئيسي =========== */
  async render() {
    const [salles, baies, eqs] = await Promise.all([
      db.getAll('rooms'),
      db.getAll('baies'),
      this.getFilteredEquipements()
    ]);
    const currentUser = getCurrentUser();
    // Contrôle par le contrat de permissions, non par une liste de chaînes de rôles.
    // L'ancienne liste omettait la valeur canonique 'responsible' — celle que users.js
    // enregistre — si bien que tout responsable créé par l'interface perdait les boutons
    // Ajouter, Modifier et Supprimer, un droit que la matrice et le serveur lui accordent.
    const canEdit = PermissionManager.check(currentUser, 'equipments', 'edit');
    const canCreate = PermissionManager.check(currentUser, 'equipments', 'create');
    const canDelete = PermissionManager.check(currentUser, 'equipments', 'delete');

    return `
      <div class="card">
        <div class="card-header">
          <h2>Équipements</h2>
          <div class="card-actions">
            ${canCreate ? `
              <button id="open-add-eq" class="btn"><i class="fas fa-plus"></i> Ajouter</button>
              <button id="export-eq" class="btn gray">Exporter JSON</button>
              <button id="import-eq" class="btn gray">Importer JSON</button>
              <input type="file" id="import-file" style="display:none">
            ` : ''}
          </div>
        </div>
        ${messageDePerimetre(currentUser, {
          permission: 'equipment.read',
          vide: eqs.length === 0 && !this.filters.search && !this.filters.type && !this.filters.statut && !this.filters.salle,
          aucuneDonnee: 'Aucun équipement dans votre périmètre pour le moment.'
        })}
        <div class="filters-container">
          <input type="text" id="equip-search" class="form-control" style="width:140px;" placeholder="Recherche rapide..." value="${this.filters.search}">
          <select id="filter-type" class="form-control">
            <option value="">Type: Tous</option>
            ${[...new Set(eqs.map(eq => eq.type))].map(type => `
              <option value="${type}" ${this.filters.type === type ? 'selected' : ''}>${type}</option>
            `).join('')}
          </select>
          <select id="filter-statut" class="form-control">
            <option value="">Statut: Tous</option>
            ${statusFilterOptions().map(option => `
            <option value="${option.value}" ${this.filters.statut === option.value ? 'selected' : ''}>${option.label}</option>
            `).join('')}
          </select>
          <select id="filter-salle" class="form-control">
            <option value="">Salle: Toutes</option>
            ${salles.map(s => `
              <option value="${s.id}" ${this.filters.salle == s.id ? 'selected' : ''}>${s.name || s.nom}</option>
            `).join('')}
          </select>
          <button type="button" id="reset-filters" class="btn gray" title="Réinitialiser les filtres" aria-label="Réinitialiser les filtres"><i class="fas fa-times"></i></button>
        </div>
        <div style="overflow-x:auto;">
          <table class="tableau">
            <tr>
              <th>Nom</th>
              <th>Nom d’exploitation</th>
              <th>Type</th>
              <th>Catégorie</th>
              <th>Marque</th>
              <th>Modèle</th>
              <th>Numéro de série</th>
              <th>N° d’Immobilisation</th>
              <th>Statut</th>
              <th>Salle</th>
              <th>Rack</th>
              <th>Adresse IP</th>
              <th>N° Grille IN/OUT</th>
              <th>Date installation</th>
              <th>Fin garantie</th>
              <th>Notes</th>
              <th>QR</th>
              <th>Images</th>
              <th>Actions</th>
            </tr>
            ${eqs.map(eq => `
              <tr>
                <td><a href="#" class="eq-quickview" data-id="${eq.id}" style="font-weight:600;">${eq.name || ''}</a></td>
                <td>${eq.operationalLabel ? `<b>${eq.operationalLabel}</b>` : ''}</td>
                <td>${eq.type || ''}</td>
                <td>${eq.categorie || ''}</td>
                <td>${eq.marque || ''}</td>
                <td>${eq.modele || ''}</td>
                <td>${eq.numSerie || ''}</td>
                <td>${eq.immoNumber || ''}</td>
                <td>${equipmentStatusLabel(eq)}</td>
                <td>${(salles.find(s => s.id == eq.roomId) || {}).name || (salles.find(s => s.id == eq.roomId) || {}).nom || ''}</td>
                <td>${(baies.find(b => b.id == eq.baieId) || {}).name || (baies.find(b => b.id == eq.baieId) || {}).nom || ''}</td>
                <td>${eq.ipAddress || ''}</td>
                <td>${eq.grilleINOUT || ''}</td>
                <td>${eq.installDate || ''}</td>
                <td>${eq.garantieDate || ''}</td>
                <td>${eq.notes || ''}</td>
                <td>${eq.qr ? `<img src="${eq.qr}" width="32">` : ''}</td>
                <td>
                  ${(eq.images || []).map(img => `<img src="${img}" class="img-preview">`).join('')}
                </td>
                <td>
                  ${canEdit ? `<button class="btn" data-id="${eq.id}" data-action="edit"><i class="fas fa-edit"></i></button>` : ''}
                  ${canDelete ? `<button class="btn danger" data-id="${eq.id}" data-action="del"><i class="fas fa-trash"></i></button>` : ''}
                </td>
              </tr>
            `).join('')}
          </table>
        </div>
        ${this.renderModal()}
      </div>
    `;
  }

  /** =========== أحداث بعد العرض =========== */
  async afterRender() {
    document.getElementById('equip-search').oninput = e => { this.filters.search = e.target.value; this.refreshList(); };
    document.getElementById('filter-type').onchange = e => { this.filters.type = e.target.value; this.refreshList(); };
    document.getElementById('filter-statut').onchange = e => { this.filters.statut = e.target.value; this.refreshList(); };
    document.getElementById('filter-salle').onchange = e => { this.filters.salle = e.target.value; this.refreshList(); };
    document.getElementById('reset-filters').onclick = () => { this.filters = { type: '', statut: '', salle: '', search: '' }; this.refreshList(); };

    // إضافة
    if (document.getElementById('open-add-eq')) {
      document.getElementById('open-add-eq').onclick = () => this.showEquipementModal();
    }

    // تعديل
    document.querySelectorAll('button[data-action="edit"]').forEach(btn => {
      btn.onclick = async () => {
        const eq = await db.get('equipments', normalizeRelationId(btn.getAttribute('data-id')));
        this.showEquipementModal(eq);
      };
    });
    // حذف
    document.querySelectorAll('button[data-action="del"]').forEach(btn => {
      btn.onclick = async () => {
        if (confirm("Supprimer cet équipement ?")) {
          try {
            await db.deleteEquipmentSafely(normalizeRelationId(btn.getAttribute('data-id')));
            this.notifications.showNotification("Suppression réussie", "success");
            this.refreshList();
          } catch (error) {
            this.notifications.showNotification(error.message, 'error');
          }
        }
      };
    });

    // عرض سريع
    document.querySelectorAll('.eq-quickview').forEach(a => {
      a.onclick = async (e) => {
        e.preventDefault();
        const eq = await db.get('equipments', Number(a.dataset.id));
        this.showQuickView(eq);
      };
    });

    // تصدير/استيراد JSON
    if (document.getElementById('export-eq')) {
      document.getElementById('export-eq').onclick = async () => {
        const eqs = await db.getAll('equipments');
        const blob = new Blob([JSON.stringify(eqs, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "equipements.json";
        a.click();
      };
    }
    if (document.getElementById('import-eq')) {
      document.getElementById('import-eq').onclick = () => document.getElementById('import-file').click();
      document.getElementById('import-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
          const eqs = JSON.parse(text);
          for (const eq of eqs) await db.save('equipments', eq);
          this.notifications.showNotification("Importation réussie !", "success");
          this.refreshList();
        } catch (err) {
          this.notifications.showNotification("Erreur lors de l'importation !", "error");
        }
      };
    }
  }

  /** =========== نموذج الإضافة/التعديل =========== */
  renderModal() {
    return `
      <div class="modal" id="eq-modal" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="modal-title-eq">
        <div class="modal-content equipment-modal-content">
          <span class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</span>
          <h3 id="modal-title-eq">Ajouter équipement</h3>
          <form id="eq-form">
            <input type="hidden" id="eq-id">
            <input name="name"         type="text"  placeholder="Nom équipement (ex: Switch Core Principal)" required>
            <input name="type"         type="text"  placeholder="Type (ex: Switch, Serveur)" required>
            <!--
              CATÉGORIE — plus obligatoire, et adaptée à un parc de diffusion.

              Mesuré en base : 78 équipements, DONT AUCUN ne portait de catégorie, alors
              que le champ était obligatoire. Toute modification d'équipement était donc
              bloquée par un champ que rien n'avait jamais rempli — et pour cause : les
              trois seules valeurs proposées (Réseau, Informatique, Énergie) ne décrivent
              ni une caméra, ni un CCU, ni un magnétoscope, ni une grille de commutation.
              La liste suit désormais le parc réel : 22 routeurs, 4 magnétoscopes,
              intercom, monitoring audio et vidéo, mesure.
            -->
            <select name="categorie">
              <option value="">Catégorie (facultatif)</option>
              <option value="Vidéo">Vidéo</option>
              <option value="Audio">Audio</option>
              <option value="Commutation / routage">Commutation / routage</option>
              <option value="Contrôle / régie">Contrôle / régie</option>
              <option value="Monitoring">Monitoring</option>
              <option value="Mesure">Mesure</option>
              <option value="Intercom">Intercom</option>
              <option value="Enregistrement / lecture">Enregistrement / lecture</option>
              <option value="Diffusion / antenne">Diffusion / antenne</option>
              <option value="Réseau">Réseau</option>
              <option value="Informatique">Informatique</option>
              <option value="Énergie">Énergie</option>
            </select>
            <!-- LE NOM D'EXPLOITATION — le seul par lequel la régie désigne l'appareil.
                 Personne n'appelle un magnétoscope « XDCAM PDW-1200 » à l'antenne : on dit
                 VTR1. Le champ existait DÉJÀ dans les données — operationalLabel, porté
                 par les appareils de la Régie Car (« CCU 1 », « REMOTE LSM 2 ») — mais
                 aucun formulaire ne le saisissait et aucun écran ne l'affichait.
                 C'est aussi la CLÉ DE JONCTION avec la grille centrale, dont les entrées et
                 les sorties portent ces mêmes noms d'exploitation. Leur nombre et leurs
                 libellés réels sont opérationnels : ils arrivent par le jeu de données
                 autorisé, jamais depuis ce gabarit — un commentaire HTML dans un gabarit de
                 chaîne se télécharge exactement comme le reste du module (#142).
                 (Aucune apostrophe inversée ici : ce bloc vit DANS un gabarit de chaîne,
                 où elle refermerait le gabarit et casserait tout le module.) -->
            <input name="operationalLabel" type="text" placeholder="Nom d’exploitation / alias antenne (ex: VTR1, NACQ1)">
            <input name="marque"       type="text"  placeholder="Marque (ex: Cisco, Dell...)">
            <input name="modele"       type="text"  placeholder="Modèle (ex: Catalyst 9300)">
            <input name="numSerie"     type="text"  placeholder="Numéro de série" required>
            <input name="immoNumber"   type="text"  placeholder="N° d’Immobilisation (ex: 2M-IMMO-12345)">
            <select name="statut"      required>
              ${statusInputOptions().map(option => `<option value="${option.value}">${option.label}</option>`).join('')}
            </select>
            <select name="roomId" required id="eq-roomId"></select>
            <select name="baieId" required id="eq-baieId"></select>
            <input name="ipAddress"    type="text"  placeholder="Adresse IP (ex: 192.168.1.10)">
            <input name="grilleINOUT"  type="text"  placeholder="N° de la grille IN/OUT (ex: GR-IN-05 / GR-OUT-12)">
            <!-- L'attribut placeholder est ignoré par les navigateurs sur un champ de type
                 date : les deux champs s'affichaient côte à côte, identiques et sans aucune
                 indication de ce qu'ils attendent. Une fin de garantie saisie comme date
                 d'installation ne déclenche aucune erreur — elle produit simplement une
                 donnée fausse. Le motif label + input est celui qu'emploient déjà les trois
                 autres champs de date de la plateforme. -->
            <label class="eq-field"><span>Date d’installation</span>
              <input name="installDate"  type="date"></label>
            <label class="eq-field"><span>Date de fin de garantie</span>
              <input name="garantieDate" type="date"></label>
            <textarea name="notes"     placeholder="Notes ou commentaires (config, historique...)"></textarea>
            <label class="eq-field"><span>Photos de l'appareil (fichiers)</span>
              <input name="images" id="eq-images" type="file" accept="image/*" multiple></label>
            <label class="eq-field"><span>Adresse d'une image constructeur (URL)</span>
              <input name="imageUrl" id="eq-image-url" type="url" inputmode="url"
                     placeholder="https://… (site du constructeur ou source fiable)"></label>
            <div id="modal-images-list"></div>
            <div class="equipment-modal-actions">
              <button type="button" class="btn" id="cancel-eq-btn">Annuler</button>
              <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  async showEquipementModal(equipement = null) {
    document.body.insertAdjacentHTML('beforeend', this.renderModal());
    const modal = document.getElementById('eq-modal');
    const form = document.getElementById('eq-form');
    const salles = await db.getAll('rooms');
    const baies = await db.getAll('baies');
    form.roomId.innerHTML = `<option value="">Sélectionner une salle</option>${salles.map(s => `<option value="${s.id}">${s.name || s.nom}</option>`).join('')}`;
    form.baieId.innerHTML = `<option value="">Sélectionner un rack</option>${baies.map(b => `<option value="${b.id}">${b.name || b.nom}</option>`).join('')}`;

    if (equipement) {
      form['name'].value = equipement.name || '';
      // Sans cette ligne, rouvrir la fiche d'un appareil déjà nommé VTR1 afficherait un
      // champ vide, et le prochain enregistrement effacerait l'alias en silence.
      form['operationalLabel'].value = equipement.operationalLabel || '';
      form['type'].value = equipement.type || '';
      form['categorie'].value = equipement.categorie || '';
      form['marque'].value = equipement.marque || '';
      form['modele'].value = equipement.modele || '';
      form['numSerie'].value = equipement.numSerie || '';
      form['immoNumber'].value = equipement.immoNumber || '';
      form['statut'].value = equipmentStatusLabel(equipement);
      form['roomId'].value = equipement.roomId || '';
      form['baieId'].value = equipement.baieId || '';
      form['ipAddress'].value = equipement.ipAddress || '';
      form['grilleINOUT'].value = equipement.grilleINOUT || '';
      form['installDate'].value = equipement.installDate || '';
      form['garantieDate'].value = equipement.garantieDate || '';
      form['notes'].value = equipement.notes || '';
      document.getElementById('eq-id').value = equipement.id || '';
      // La fenêtre déclare la fiche qu'elle édite : `snapshot-divergence-ui.js` reconnaît
      // alors une saisie en cours et avertit si l'équipement change ailleurs. Une CRÉATION
      // ne déclare rien — il n'y a pas encore de fiche distante à voir diverger.
      modal.dataset.entityStore = 'equipments';
      modal.dataset.entityId = String(equipement.id);
    }

    form.images.onchange = async (e) => {
      const imgsList = document.getElementById('modal-images-list');
      imgsList.innerHTML = '';
      for (const f of e.target.files) {
        const imgData = await this.readFile(f);
        imgsList.innerHTML += `<img src="${imgData}" style="max-width:40px;max-height:40px;margin:2px;">`;
      }
    };

    document.getElementById('cancel-eq-btn').onclick = () => { modal.remove(); };
    modal.querySelector('.close-modal').onclick = () => { modal.remove(); };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());
      // Identifiants textuels en production : Number() produisait NaN (voir broadcast-ports-cables.js).
      data.roomId = normalizeRelationId(data.roomId);
      data.baieId = normalizeRelationId(data.baieId);
      data.images = [];
      if (form.images.files.length) {
        for (const f of form.images.files) {
          data.images.push(await this.readFile(f));
        }
      }
      data.installDate = form.installDate.value;
      data.garantieDate = form.garantieDate.value;
      data.notes = form.notes.value;
      data.qr = await generateQR(data.numSerie);
      data.createdAt = equipement?.createdAt || new Date();
      data.updatedAt = new Date();
      if (equipement && equipement.id) {
        data.id = equipement.id;
      }
      await db.save('equipments', data);
      this.notifications.showNotification("Enregistré avec succès", "success");
      modal.remove();
      this.refreshList();
    };

    modal.style.display = 'flex';
  }

  async showQuickView(eq) {
    document.getElementById('equip-quickview-modal')?.remove();
    const salles = await db.getAll('rooms');
    const baies = await db.getAll('baies');
    const modal = document.createElement('div');
    modal.id = 'equip-quickview-modal';
    modal.className = 'modal';
    const enPilote = document.body?.classList.contains('pilot-technique-ui');
    modal.innerHTML = enPilote
      ? this.renderQuickViewInspector(eq, salles, baies)
      : this.renderQuickViewClassique(eq, salles, baies);
    document.body.appendChild(modal);
    modal.querySelector('.close-modal').onclick = () => modal.remove();
  }

  /** Le contenu historique, inchangé : ce que voit quiconque n'a pas activé le Pilote Technique. */
  renderQuickViewClassique(eq, salles, baies) {
    return `
      <div class="modal-content" style="min-width:350px;max-width:540px;">
        <span class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</span>
        <h3 style="color:#2874a6;">Détails de l'équipement</h3>
        <table class="table details-table" style="margin-bottom:16px;">
          <tbody>
            <tr><td><b>Nom</b></td><td>${eq.name}</td></tr>
            <tr><td><b>Nom d’exploitation</b></td><td>${eq.operationalLabel || ''}</td></tr>
            <tr><td><b>Type</b></td><td>${eq.type}</td></tr>
            <tr><td><b>Catégorie</b></td><td>${eq.categorie || ''}</td></tr>
            <tr><td><b>Marque</b></td><td>${eq.marque}</td></tr>
            <tr><td><b>Modèle</b></td><td>${eq.modele}</td></tr>
            <tr><td><b>Numéro série</b></td><td>${eq.numSerie}</td></tr>
            <tr><td><b>N° d’Immobilisation</b></td><td>${eq.immoNumber || ''}</td></tr>
            <tr><td><b>Statut</b></td><td>${eq.statut}</td></tr>
            <tr><td><b>Salle</b></td><td>${(salles.find(s => s.id == eq.roomId) || {}).name || (salles.find(s => s.id == eq.roomId) || {}).nom || ''}</td></tr>
            <tr><td><b>Rack</b></td><td>${(baies.find(b => b.id == eq.baieId) || {}).name || (baies.find(b => b.id == eq.baieId) || {}).nom || ''}</td></tr>
            <tr><td><b>Adresse IP</b></td><td>${eq.ipAddress || ''}</td></tr>
            <tr><td><b>N° Grille IN/OUT</b></td><td>${eq.grilleINOUT || ''}</td></tr>
            <tr><td><b>Date installation</b></td><td>${eq.installDate || ''}</td></tr>
            <tr><td><b>Fin garantie</b></td><td>${eq.garantieDate || ''}</td></tr>
            <tr><td><b>Notes</b></td><td>${eq.notes || ''}</td></tr>
            <tr><td><b>QR</b></td><td>${eq.qr ? `<img src="${eq.qr}" width="70">` : ''}</td></tr>
          </tbody>
        </table>
        ${eq.images && eq.images.length ? eq.images.map(img => `<img src="${img}" style="max-width:60px;max-height:38px;margin:2px;">`).join('') : ''}
        <hr>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn gray" onclick="document.getElementById('equip-quickview-modal').remove()">Fermer</button>
        </div>
      </div>
    `;
  }

  /**
   * L'inspecteur Pilote Technique : LES MÊMES champs que la vue classique, réorganisés en
   * blocs nommés — aucune donnée nouvelle, aucun champ inventé. Un bloc entièrement vide
   * (hors Aperçu) ne s'affiche pas : mieux vaut son absence qu'une carte vide qui prétend
   * dire quelque chose. Dans un bloc affiché, une valeur manquante se lit « Non renseigné »,
   * jamais un blanc silencieux qu'on pourrait prendre pour un oubli d'affichage.
   */
  renderQuickViewInspector(eq, salles, baies) {
    const salle = (salles.find(s => s.id == eq.roomId) || {});
    const baie = (baies.find(b => b.id == eq.baieId) || {});
    const valeur = value => (value === undefined || value === null || value === '') ? null : value;
    const champ = (label, value) => ({ label, value: valeur(value) });
    const blocs = [
      {
        titre: 'Aperçu', icone: 'fa-info-circle', toujoursAffiche: true,
        champs: [
          champ('Nom', eq.name), champ('Nom d’exploitation', eq.operationalLabel),
          champ('Type', eq.type), champ('Catégorie', eq.categorie), champ('Statut', eq.statut)
        ]
      },
      {
        titre: 'Fabricant', icone: 'fa-industry',
        champs: [
          champ('Marque', eq.marque), champ('Modèle', eq.modele),
          champ('Numéro série', eq.numSerie), champ('N° d’Immobilisation', eq.immoNumber)
        ]
      },
      {
        titre: 'Localisation', icone: 'fa-map-marker-alt',
        champs: [champ('Salle', salle.name || salle.nom), champ('Rack', baie.name || baie.nom)]
      },
      {
        titre: 'Réseau', icone: 'fa-network-wired',
        champs: [champ('Adresse IP', eq.ipAddress), champ('N° Grille IN/OUT', eq.grilleINOUT)]
      },
      {
        titre: 'Suivi', icone: 'fa-calendar-alt',
        champs: [
          champ('Date installation', eq.installDate), champ('Fin garantie', eq.garantieDate),
          champ('Notes', eq.notes)
        ]
      }
    ];
    const rendreBloc = bloc => {
      const rempli = bloc.champs.some(c => c.value !== null);
      if (!bloc.toujoursAffiche && !rempli) return '';
      return `
        <section class="pilot-inspector-block">
          <h4><i class="fas ${bloc.icone}" aria-hidden="true"></i> ${bloc.titre}</h4>
          <table class="table details-table">
            <tbody>
              ${bloc.champs.map(c => `
                <tr>
                  <td><b>${c.label}</b></td>
                  <td${c.value === null ? ' class="pilot-empty-value"' : ''}>${c.value === null ? 'Non renseigné' : c.value}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </section>
      `;
    };
    return `
      <div class="modal-content" style="min-width:350px;max-width:540px;">
        <span class="close-modal" style="float:right;cursor:pointer;font-size:22px;">&times;</span>
        <h3 style="color:#2874a6;">Détails de l'équipement</h3>
        <div class="pilot-inspector-sections">${blocs.map(rendreBloc).join('')}</div>
        ${eq.qr ? `<div class="pilot-inspector-block"><h4><i class="fas fa-qrcode" aria-hidden="true"></i> QR</h4><img src="${eq.qr}" width="70"></div>` : ''}
        ${eq.images && eq.images.length ? `<div class="pilot-inspector-block"><h4><i class="fas fa-images" aria-hidden="true"></i> Images</h4>${eq.images.map(img => `<img src="${img}" style="max-width:60px;max-height:38px;margin:2px;">`).join('')}</div>` : ''}
        <hr>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn gray" onclick="document.getElementById('equip-quickview-modal').remove()">Fermer</button>
        </div>
      </div>
    `;
  }

  readFile(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  async getFilteredEquipements() {
    let eqs = await db.getAll('equipments');
    if (this.filters.type) eqs = eqs.filter(eq => eq.type === this.filters.type);
    // Le filtre porte sur l'état canonique, pas sur la chaîne stockée : un équipement semé
    // avec « Opérationnel — état actuel à confirmer » répond bien au filtre « Opérationnel ».
    if (this.filters.statut) eqs = eqs.filter(eq => equipmentStatus(eq) === this.filters.statut);
    if (this.filters.salle) eqs = eqs.filter(eq => eq.roomId == this.filters.salle);
    if (this.filters.search) {
      const q = this.filters.search.toLowerCase();
      eqs = eqs.filter(eq =>
        (eq.name || '').toLowerCase().includes(q) ||
        // C'est le nom que la régie tape en premier : chercher « VTR1 » sans le trouver
        // rendrait la colonne inutile le jour où elle sert le plus.
        (eq.operationalLabel || '').toLowerCase().includes(q) ||
        (eq.numSerie || '').toLowerCase().includes(q) ||
        (eq.marque || '').toLowerCase().includes(q) ||
        (eq.modele || '').toLowerCase().includes(q)
      );
    }
    eqs.sort((a, b) => {
      const valA = a[this.sortField] || '';
      const valB = b[this.sortField] || '';
      if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return eqs;
  }

  refreshList() {
    this.render().then(html => {
      document.getElementById('admin-content').innerHTML = html;
      this.afterRender();
    });
  }
}
