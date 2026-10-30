import { db } from './db.js';
import { PermissionManager } from './permissions.js';
import { normalizeRole, roleLabel as libelleRole, assignableRoles, ROLE_LABELS } from './roles.js';
import { evaluatePassword, passwordRejectionMessage } from './password-policy.js';
import { sanitizeLocalUserCredentialFields } from './local-credential-contract.js';

function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

// Les libellés viennent du contrat des rôles : une seconde liste locale finissait par
// diverger, et un rôle absent s'affichait « Visiteur » — ce qui était faux et trompeur.
const roleLabel = role => libelleRole(role);

/**
 * Options de rôle réellement attribuables par l'acteur.
 *
 * La liste était FIGÉE et commençait par « Administrateur » : n'importe qui pouvant
 * atteindre ce formulaire pouvait donc fabriquer un second administrateur. Elle ne
 * propose plus que les rôles strictement inférieurs à celui de l'acteur, et jamais
 * `admin` — qui vient des variables d'environnement Railway.
 *
 * Ce n'est PAS la garde : le serveur revérifie la hiérarchie à chaque écriture
 * (`assertUserHierarchy`). Une liste déroulante ne protège rien ; elle évite seulement de
 * proposer ce qui sera refusé.
 */
function optionsDeRole(acteur) {
  const disponibles = assignableRoles(acteur?.role);
  if (!disponibles.length) {
    return '<option value="" disabled selected>Aucun rôle attribuable</option>';
  }
  return disponibles.map(role =>
    `<option value="${role}">${ROLE_LABELS[role]}</option>`).join('');
}

const normalizeUsername = value => String(value || '').trim().toLocaleLowerCase('fr-FR');

export default class Users {
  constructor(notifications) {
    this.notifications = notifications;
    this.currentPage = 1;
    this.itemsPerPage = 10;
    this.searchQuery = '';
    this.user = JSON.parse(localStorage.getItem('auth')) || {};
  }

  async render() {
    await db.open();
    const users = await this.getFilteredUsers();
    const totalPages = Math.ceil(users.length / this.itemsPerPage);
    const paginatedUsers = this.paginateUsers(users);

    return `
      <div class="users-management">
        <div class="section-header">
          <h2>Gestion des utilisateurs</h2>
          ${PermissionManager.check(this.user, 'users', 'create') ? `
            <button class="btn btn-primary" id="add-user-btn">
              <i class="fas fa-user-plus"></i> Ajouter un utilisateur
            </button>
          ` : ''}
        </div>
        <div class="user-controls">
          <div class="search-box">
            <input type="text" id="user-search" placeholder="Rechercher un utilisateur..." 
                   value="${this.searchQuery}">
            <i class="fas fa-search"></i>
          </div>
          <div class="pagination-info">
            Affichage ${paginatedUsers.length} sur ${users.length} utilisateurs
          </div>
        </div>
        <table class="user-table">
          <thead>
            <tr>
              <th>Nom d'utilisateur</th>
              <th>Nom complet</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th>Dernière connexion</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${paginatedUsers.map(user => this.renderUserRow(user)).join('')}
          </tbody>
        </table>
        ${this.renderPagination(totalPages)}
        <div id="user-modal" class="modal" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-content user-modal-content">
            <span class="close-modal">&times;</span>
            <h3 id="modal-title">Ajouter un utilisateur</h3>
            <form id="user-form">
              <input type="hidden" id="user-id">
              <div class="form-row">
                <div class="form-group">
                  <label for="username">Nom d'utilisateur</label>
                  <input type="text" id="username" autocomplete="off" required>
                  <small>Ce nom est unique et sert à la connexion personnelle.</small>
                </div>
                <div class="form-group">
                  <label for="full-name">Nom complet</label>
                  <input type="text" id="full-name" required>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="role">Rôle</label>
                  <select id="role" required>${optionsDeRole(this.user)}</select>
                </div>
                <div class="form-group">
                  <label for="status">Statut</label>
                  <select id="status">
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="password">Mot de passe</label>
                  <div class="password-field">
                    <input type="password" id="password" autocomplete="new-password">
                    <button type="button" id="generate-password" class="btn-icon" tabindex="-1" title="Générer un mot de passe">
                      <i class="fas fa-random"></i>
                    </button>
                    <button type="button" id="show-password" class="btn-icon" tabindex="-1" title="Afficher/masquer">
                      <i class="fas fa-eye"></i>
                    </button>
                  </div>
                  <small id="password-hint" style="color:#888"></small>
                </div>
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-user">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  async afterRender() {
    this.bindTableEvents();
    this.bindSearch();
    this.bindModalEvents();
    this.bindPagination();
  }

  async getFilteredUsers() {
    await db.open();
    const allUsers = await db.getAll('users');
    if (!this.searchQuery) return allUsers;
    const query = this.searchQuery.toLowerCase();
    return allUsers.filter(user =>
      (user.username || '').toLowerCase().includes(query) ||
      (user.fullName || '').toLowerCase().includes(query) ||
      roleLabel(user.role).toLowerCase().includes(query)
    );
  }

  paginateUsers(users) {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return users.slice(start, start + this.itemsPerPage);
  }

  renderUserRow(user) {
    const canonicalRole = normalizeRole(user.role);
    return `
      <tr data-user-id="${user.id}">
        <td>${user.username}</td>
        <td>${user.fullName || ''}</td>
        <td><span class="role-badge ${canonicalRole}">${roleLabel(user.role)}</span></td>
        <td>
          <span class="status-badge ${user.status === 'active' ? 'active' : 'inactive'}">
            ${user.status === 'active' ? 'Actif' : 'Inactif'}
          </span>
        </td>
        <td>
          ${user.lastLogin ? new Date(user.lastLogin).toLocaleString('fr-FR') : 'Jamais'}
        </td>
        <td class="actions">
          ${PermissionManager.check(this.user, 'users', 'edit') ? `
            <button class="btn-icon edit-user" title="Modifier"><i class="fas fa-edit"></i></button>
          ` : ''}
          ${PermissionManager.check(this.user, 'users', 'delete') ? `
            <button class="btn-icon delete-user" title="Supprimer"><i class="fas fa-trash"></i></button>
          ` : ''}
          ${PermissionManager.check(this.user, 'users', 'resetPassword') ? `
            <button class="btn-icon reset-password" title="Réinitialiser le mot de passe"><i class="fas fa-key"></i></button>
          ` : ''}
        </td>
      </tr>
    `;
  }

  renderPagination(totalPages) {
    if (totalPages <= 1) return '';
    return `
      <div class="pagination">
        ${Array.from({ length: totalPages }, (_, i) => i + 1).map(page => `
          <button class="page-btn ${page === this.currentPage ? 'active' : ''}" 
                  data-page="${page}">
            ${page}
          </button>
        `).join('')}
      </div>
    `;
  }

  bindTableEvents() {
    document.querySelectorAll('.edit-user').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const userId = e.currentTarget.closest('tr').getAttribute('data-user-id');
        this.showEditModal(userId);
      });
    });

    document.querySelectorAll('.delete-user').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.closest('tr').getAttribute('data-user-id');
        if (String(userId) === String(this.user.id)) {
          this.notifications.showNotification('Vous ne pouvez pas supprimer votre propre compte pendant votre session.', 'error');
          return;
        }
        if (confirm('Supprimer cet utilisateur ?')) {
          try {
            await db.delete('users', Number(userId));
            this.notifications.showNotification('Utilisateur supprimé avec succès', 'success');
            await this.refreshView();
          } catch (error) {
            this.notifications.showNotification('Erreur lors de la suppression : ' + error.message, 'error');
          }
        }
      });
    });

    document.querySelectorAll('.reset-password').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.closest('tr').getAttribute('data-user-id');
        const newPassword = generatePassword(12);
        try {
          const oldUser = await db.get('users', Number(userId));
          if (!oldUser) throw new Error('Utilisateur introuvable');
          // Le centre injoignable, `db.save` refuse et RIEN n'est écrit : le message de
          // réussite ci-dessous — qui annonce un mot de passe utilisable — ne doit être
          // rendu que lorsque le serveur a réellement pris le nouveau.
          await db.save('users', {
            ...sanitizeLocalUserCredentialFields(oldUser),
            password: db.hashPassword(newPassword),
            updatedAt: new Date().toISOString()
          });
          this.notifications.showNotification(`Mot de passe réinitialisé : ${newPassword}`, 'success');
          await this.refreshView();
        } catch (error) {
          this.notifications.showNotification('Erreur : ' + error.message, 'error');
        }
      });
    });
  }

  bindSearch() {
    const searchInput = document.getElementById('user-search');
    if (!searchInput) return;
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      this.searchQuery = e.target.value;
      searchTimeout = setTimeout(() => {
        this.currentPage = 1;
        this.refreshView();
      }, 350);
    });
  }

  bindModalEvents() {
    const modal = document.getElementById('user-modal');
    const form = document.getElementById('user-form');
    if (!modal || !form) return;

    document.getElementById('add-user-btn')?.addEventListener('click', () => this.showAddModal());
    document.querySelector('.close-modal')?.addEventListener('click', () => { modal.style.display = 'none'; });
    document.getElementById('cancel-user')?.addEventListener('click', () => { modal.style.display = 'none'; });
    // La règle doit se VOIR pendant la saisie : un refus qui n'apparaît qu'à
    // l'enregistrement fait recommencer l'utilisateur sans qu'il sache pourquoi.
    const champMotDePasse = document.getElementById('password');
    const indice = document.getElementById('password-hint');
    const evaluerAffichage = () => {
      if (!champMotDePasse || !indice) return;
      const valeur = champMotDePasse.value;
      if (!valeur) { indice.textContent = ''; indice.removeAttribute('data-force'); return; }
      const evaluation = evaluatePassword(valeur, {
        username: document.getElementById('username')?.value,
        fullName: document.getElementById('full-name')?.value
      });
      indice.dataset.force = evaluation.valide ? evaluation.niveau : 'faible';
      indice.textContent = evaluation.valide
        ? `Mot de passe ${evaluation.niveau} (${evaluation.score}/100).`
        : `Il manque : ${evaluation.problemes.join(', ')}.`;
    };
    champMotDePasse?.addEventListener('input', evaluerAffichage);

    document.getElementById('generate-password')?.addEventListener('click', () => {
      // Le générateur doit produire un mot de passe que la politique accepte, sinon il
      // proposerait ce que l'enregistrement refuse ensuite.
      let password = generatePassword(14);
      for (let essai = 0; essai < 12 && !evaluatePassword(password).valide; essai += 1) password = generatePassword(14);
      champMotDePasse.value = password;
      evaluerAffichage();
    });
    document.getElementById('show-password')?.addEventListener('click', (e) => {
      const passwordField = document.getElementById('password');
      const icon = e.currentTarget.querySelector('i');
      if (passwordField.type === 'password') {
        passwordField.type = 'text';
        icon?.classList.replace('fa-eye', 'fa-eye-slash');
      } else {
        passwordField.type = 'password';
        icon?.classList.replace('fa-eye-slash', 'fa-eye');
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleFormSubmit();
    });
  }

  async showAddModal() {
    const modal = document.getElementById('user-modal');
    const form = document.getElementById('user-form');
    document.getElementById('modal-title').textContent = 'Ajouter un utilisateur';
    form.reset();
    document.getElementById('user-id').value = '';
    document.getElementById('password').required = true;
    document.getElementById('role').value = 'visitor';
    document.getElementById('status').value = 'active';
    document.getElementById('password-hint').textContent = '';
    modal.style.display = 'flex';
    document.getElementById('username').focus();
  }

  async showEditModal(userId) {
    const modal = document.getElementById('user-modal');
    const user = await db.get('users', Number(userId));
    if (!user) {
      this.notifications.showNotification('Utilisateur non trouvé', 'error');
      return;
    }
    document.getElementById('modal-title').textContent = 'Modifier un utilisateur';
    document.getElementById('user-id').value = user.id;
    document.getElementById('username').value = user.username;
    document.getElementById('full-name').value = user.fullName || '';
    document.getElementById('role').value = normalizeRole(user.role);
    document.getElementById('status').value = user.status || 'active';
    document.getElementById('password').required = false;
    document.getElementById('password').value = '';
    document.getElementById('password-hint').textContent = 'Laissez vide pour conserver le mot de passe actuel.';
    modal.style.display = 'flex';
  }

  async handleFormSubmit() {
    const form = document.getElementById('user-form');
    const userId = form.querySelector('#user-id').value;
    const isEdit = Boolean(userId);
    const username = form.querySelector('#username').value.trim();
    const fullName = form.querySelector('#full-name').value.trim();
    const role = normalizeRole(form.querySelector('#role').value);
    const status = form.querySelector('#status').value;
    const pwdField = form.querySelector('#password').value;

    if (!username || !fullName || !role || !status || (!isEdit && !pwdField)) {
      this.notifications.showNotification('Tous les champs obligatoires doivent être renseignés.', 'error');
      return;
    }

    // Aucune exigence n'existait : un mot de passe d'un seul caractère était accepté.
    // La même règle est appliquée par le serveur — un contrôle qui ne vivrait que dans
    // ce formulaire serait contourné par n'importe quel appel direct à l'API.
    if (pwdField) {
      const evaluation = evaluatePassword(pwdField, { username, fullName });
      if (!evaluation.valide) {
        this.notifications.showNotification(passwordRejectionMessage(evaluation), 'error');
        return;
      }
    }

    const allUsers = await db.getAll('users');
    const duplicate = allUsers.find(user =>
      normalizeUsername(user.username) === normalizeUsername(username) &&
      String(user.id) !== String(userId || '')
    );
    if (duplicate) {
      this.notifications.showNotification(`Le nom d'utilisateur « ${username} » est déjà utilisé.`, 'error');
      return;
    }

    try {
      if (isEdit) {
        const oldUser = await db.get('users', Number(userId));
        if (!oldUser) throw new Error('Utilisateur introuvable');
        /*
         * LE CHAMP N'EXISTE QUE SI LE MOT DE PASSE CHANGE (B-4).
         *
         * L'ancienne écriture reconduisait le mot de passe de la fiche existante à chaque
         * modification de profil. Ce champ ne devant plus jamais séjourner dans le cache
         * local, il y valait désormais `undefined` — une clé vide traînée jusqu'au serveur.
         * Et sur un poste pas encore purgé, où la fiche le porte encore, un simple
         * renommage devenait indiscernable d'un vrai changement d'identifiant : hors
         * ligne, il aurait été refusé.
         *
         * Une modification de profil ne mentionne donc plus le mot de passe du tout : elle
         * reste hors ligne capable, et le serveur conserve l'identifiant qu'il détient.
         */
        const modification = {
          ...sanitizeLocalUserCredentialFields(oldUser),
          id: Number(userId),
          username,
          fullName,
          role,
          status,
          updatedAt: new Date().toISOString()
        };
        if (pwdField) modification.password = db.hashPassword(pwdField);
        await db.save('users', modification);
        this.notifications.showNotification('Utilisateur modifié avec succès', 'success');
      } else {
        await db.save('users', {
          username,
          fullName,
          role,
          status,
          password: db.hashPassword(pwdField),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        this.notifications.showNotification('Utilisateur ajouté avec succès', 'success');
      }
      document.getElementById('user-modal').style.display = 'none';
      await this.refreshView();
    } catch (error) {
      this.notifications.showNotification(`Erreur lors de l'enregistrement : ${error.message}`, 'error');
    }
  }

  async refreshView() {
    const container = document.getElementById('admin-content') || document.querySelector('.users-management')?.parentElement;
    if (!container) return;
    container.innerHTML = await this.render();
    await this.afterRender();
  }

  bindPagination() {
    document.querySelectorAll('.page-btn:not(.active)').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        this.currentPage = Number(e.currentTarget.getAttribute('data-page'));
        await this.refreshView();
      });
    });
  }
}
