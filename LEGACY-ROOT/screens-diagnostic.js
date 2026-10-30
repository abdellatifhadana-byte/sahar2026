import { db } from './db.js';
import { getCurrentUser } from './security.js';
import { addLog } from './logs.js';
import { eventSystem } from './events.js';
import { generateQR } from './qr.js';
import { openTicketModal } from './tickets.js';

export default class ScreensDiagnostic {
  constructor(notifications) {
    this.notifications = notifications;
    this.currentDiagnosis = null;
    this.currentStep = 0;
    this.selectedScreens = [];
    this.diagnosisHistory = [];
    this.screenGroups = {};
    this.cableTypes = ['HDMI', 'VGA', 'DVI', 'DisplayPort', 'USB-C', 'RCA', 'Autre'];
    this.init();
  }

  async init() {
    await this.loadDiagnosisData();
    await this.initializeScreenGroups();
  }

  async loadDiagnosisData() {
    const [issues, screens, screenGroups, rooms] = await Promise.all([
      db.getAll('screen_issues'),
      db.getAll('screens'),
      db.getAll('screen_groups'),
      db.getAll('rooms')
    ]);
    
    this.issues = issues;
    this.screens = screens;
    this.rooms = rooms;
    this.screenGroups = screenGroups.reduce((acc, group) => {
      acc[group.id] = group;
      return acc;
    }, {});
  }

  async initializeScreenGroups() {
    const groupsExist = await db.count('screen_groups');
    if (groupsExist === 0) {
      for (const room of this.rooms) {
        const roomScreens = this.screens.filter(s => s.roomId === room.id);
        if (roomScreens.length > 0) {
          await db.save('screen_groups', {
            id: `room_${room.id}`,
            name: `Écrans ${room.name}`,
            screenIds: roomScreens.map(s => s.id),
            roomId: room.id,
            createdAt: new Date()
          });
        }
      }
      await this.loadDiagnosisData();
    }
  }

  async render() {
    const user = getCurrentUser();
    const isAdmin = user?.role === 'admin';
    const isTechnician = user?.role === 'technicien';
    
    return `
      <div class="card">
        <div class="card-header">
          <h2>Système de diagnostic des écrans</h2>
          ${isAdmin ? `
            <div class="card-actions">
              <button id="add-issue-btn" class="btn">Ajouter un problème</button>
              <button id="manage-groups-btn" class="btn gray">Gérer les groupes</button>
              <button id="view-stats-btn" class="btn gray">Statistiques</button>
              <button id="manage-cables-btn" class="btn gray">Gérer les câbles</button>
            </div>
          ` : ''}
          ${isTechnician ? `
            <div class="card-actions">
              <button id="tech-view-btn" class="btn">Vue Technicien</button>
              <button id="quick-fix-btn" class="btn gray">Réparations rapides</button>
            </div>
          ` : ''}
        </div>
        
        ${this.currentDiagnosis ? this.renderDiagnosisFlow() : this.renderMainInterface(isAdmin, isTechnician)}
      </div>
    `;
  }

  renderMainInterface(isAdmin, isTechnician) {
    return `
      <div class="diagnostic-interface">
        <div class="screen-selection-section">
          <h3>Sélectionnez l'écran/les écrans défectueux</h3>
          <div class="selection-options">
            <div class="option-tabs">
              <button class="tab-btn active" data-tab="individual">Écran individuel</button>
              <button class="tab-btn" data-tab="group">Groupe d'écrans</button>
              <button class="tab-btn" data-tab="multiple">Sélection multiple</button>
              <button class="tab-btn" data-tab="room">Par salle</button>
            </div>
            
            <div class="tab-content active" id="individual-tab">
              <select id="screen-select" class="form-control">
                <option value="">-- Sélectionnez un écran --</option>
                ${this.screens.map(s => `
                  <option value="${s.id}" data-room="${s.roomId}">${s.name} (${this.getRoomName(s.roomId)})</option>
                `).join('')}
              </select>
            </div>
            
            <div class="tab-content" id="group-tab">
              <select id="group-select" class="form-control">
                <option value="">-- Sélectionnez un groupe --</option>
                ${Object.values(this.screenGroups).map(g => `
                  <option value="${g.id}">${g.name} (${g.screenIds.length} écrans)</option>
                `).join('')}
              </select>
            </div>
            
            <div class="tab-content" id="multiple-tab">
              <div class="screen-grid">
                ${this.screens.map(s => `
                  <div class="screen-item" data-id="${s.id}">
                    <input type="checkbox" id="screen-${s.id}">
                    <label for="screen-${s.id}">
                      <div class="screen-icon ${s.status === 'offline' ? 'offline' : ''}">
                        <i class="fas fa-tv"></i>
                      </div>
                      <span>${s.name}</span>
                      <small>${this.getRoomName(s.roomId)}</small>
                    </label>
                  </div>
                `).join('')}
              </div>
            </div>
            
            <div class="tab-content" id="room-tab">
              <div class="room-visualization">
                ${this.rooms.map(room => `
                  <div class="room-card" data-id="${room.id}">
                    <h4>${room.name}</h4>
                    <div class="room-map" id="room-map-${room.id}">
                      ${this.renderRoomMap(room)}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
          
          <button id="start-diagnosis-btn" class="btn btn-primary" disabled>Commencer le diagnostic</button>
        </div>
        
        ${isAdmin ? `
          <div class="admin-section">
            <h3>Gestion des problèmes</h3>
            <div class="issues-list">
              ${this.issues.length ? this.renderIssuesList() : `
                <div class="empty-state">
                  <i class="fas fa-info-circle"></i>
                  <p>Aucun problème enregistré</p>
                </div>
              `}
            </div>
          </div>
        ` : ''}
        
        ${isTechnician ? `
          <div class="technician-section">
            <h3>Actions rapides</h3>
            <div class="quick-fixes">
              <button class="btn" data-fix="restart">
                <i class="fas fa-power-off"></i> Redémarrer l'écran
              </button>
              <button class="btn" data-fix="check-cable">
                <i class="fas fa-plug"></i> Vérifier les câbles
              </button>
              <button class="btn" data-fix="source">
                <i class="fas fa-exchange-alt"></i> Changer la source
              </button>
              <button class="btn" data-fix="reset">
                <i class="fas fa-sync-alt"></i> Réinitialiser les paramètres
              </button>
            </div>
          </div>
        ` : ''}
        
        <div class="quick-actions">
          <button id="scan-qr-btn" class="btn gray">
            <i class="fas fa-qrcode"></i> Scanner QR Code
          </button>
          <button id="view-history-btn" class="btn gray">
            <i class="fas fa-history"></i> Historique des diagnostics
          </button>
        </div>
      </div>
    `;
  }

  renderRoomMap(room) {
    const roomScreens = this.screens.filter(s => s.roomId === room.id);
    return `
      <div class="room-image-container">
        ${room.image ? `<img src="${room.image}" alt="Plan de ${room.name}" class="room-image">` : ''}
        <div class="screen-markers">
          ${roomScreens.map(screen => `
            <div class="screen-marker" 
                 style="left: ${screen.positionX}%; top: ${screen.positionY}%;"
                 data-id="${screen.id}"
                 title="${screen.name}">
              <i class="fas fa-tv ${screen.status === 'offline' ? 'offline' : ''}"></i>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderIssuesList() {
    return `
      <table class="issues-table">
        <thead>
          <tr>
            <th>Problème</th>
            <th>Écrans concernés</th>
            <th>Solutions</th>
            <th>Étapes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.issues.map(issue => `
            <tr>
              <td>
                <strong>${issue.name}</strong><br>
                <small>${issue.description}</small>
              </td>
              <td>
                ${this.getIssueScreensLabel(issue)}
              </td>
              <td>
                ${issue.solutions?.length || 0} solution(s)
              </td>
              <td>
                ${issue.steps?.length || 0} étape(s)
              </td>
              <td class="actions">
                <button class="btn-icon edit-issue" data-id="${issue.id}">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="btn-icon delete-issue" data-id="${issue.id}">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  renderDiagnosisFlow() {
    const currentIssue = this.currentDiagnosis;
    const currentStep = currentIssue.steps[this.currentStep];
    
    return `
      <div class="diagnosis-flow">
        <div class="diagnosis-header">
          <h3>Diagnostic: ${currentIssue.name}</h3>
          <div class="breadcrumb">
            ${this.selectedScreens.map(s => `
              <span class="screen-tag">${s.name}</span>
            `).join('')}
          </div>
          <div class="progress">
            <div class="progress-bar" style="width: ${(this.currentStep / currentIssue.steps.length) * 100}%"></div>
            <span>Étape ${this.currentStep + 1} sur ${currentIssue.steps.length}</span>
          </div>
        </div>
        
        <div class="step-content">
          <h4>${currentStep.question}</h4>
          
          ${this.renderStepInput(currentStep)}
          
          ${currentStep.image ? `
            <div class="step-image">
              <img src="${currentStep.image}" alt="Illustration">
            </div>
          ` : ''}
          
          ${currentStep.relatedDevices?.length ? `
            <div class="related-devices">
              <h5>Appareils/câbles associés:</h5>
              <ul>
                ${currentStep.relatedDevices.map(d => `
                  <li>
                    <i class="fas fa-${d.type === 'cable' ? 'plug' : 'microchip'}"></i>
                    ${d.name} (${d.location})
                    ${d.cableType ? `<span class="cable-type">${d.cableType}</span>` : ''}
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
        
        <div class="step-actions">
          ${this.currentStep > 0 ? `
            <button id="prev-step-btn" class="btn gray">Précédent</button>
          ` : ''}
          
          <button id="next-step-btn" class="btn btn-primary">
            ${this.currentStep === currentIssue.steps.length - 1 ? 'Terminer le diagnostic' : 'Suivant'}
          </button>
          
          <button id="cancel-diagnosis-btn" class="btn danger">Annuler</button>
        </div>
      </div>
    `;
  }

  async afterRender() {
    // Gestion des onglets de sélection
    document.querySelectorAll('.option-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.option-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        const tabId = btn.dataset.tab + '-tab';
        document.getElementById(tabId).classList.add('active');
        
        this.updateStartButtonState();
      });
    });

    // Sélection d'écran individuel
    document.getElementById('screen-select').addEventListener('change', () => {
      this.selectedScreens = [];
      const selectedId = document.getElementById('screen-select').value;
      if (selectedId) {
        const screen = this.screens.find(s => s.id == selectedId);
        if (screen) this.selectedScreens.push(screen);
      }
      this.updateStartButtonState();
    });

    // Sélection de groupe
    document.getElementById('group-select').addEventListener('change', () => {
      this.selectedScreens = [];
      const groupId = document.getElementById('group-select').value;
      if (groupId && this.screenGroups[groupId]) {
        this.selectedScreens = this.screens.filter(s => 
          this.screenGroups[groupId].screenIds.includes(s.id)
        );
      }
      this.updateStartButtonState();
    });

    // Sélection multiple
    document.querySelectorAll('.screen-item input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', () => {
        const screenId = chk.id.replace('screen-', '');
        if (chk.checked) {
          const screen = this.screens.find(s => s.id == screenId);
          if (screen) this.selectedScreens.push(screen);
        } else {
          this.selectedScreens = this.selectedScreens.filter(s => s.id != screenId);
        }
        this.updateStartButtonState();
      });
    });

    // Sélection par salle (marqueurs sur l'image)
    document.querySelectorAll('.screen-marker').forEach(marker => {
      marker.addEventListener('click', () => {
        const screenId = marker.dataset.id;
        const screen = this.screens.find(s => s.id == screenId);
        if (screen) {
          this.selectedScreens = [screen];
          document.getElementById('screen-select').value = screenId;
          this.updateStartButtonState();
          this.notifications.showNotification(`Écran sélectionné: ${screen.name}`, 'success');
        }
      });
    });

    // Bouton de démarrage du diagnostic
    document.getElementById('start-diagnosis-btn')?.addEventListener('click', () => {
      if (this.selectedScreens.length === 0) return;
      
      const screenIds = this.selectedScreens.map(s => s.id);
      const potentialIssues = this.issues.filter(issue => {
        if (issue.screenIds?.some(id => screenIds.includes(id))) return true;
        if (issue.groupIds?.some(groupId => {
          const group = this.screenGroups[groupId];
          return group?.screenIds?.some(id => screenIds.includes(id));
        })) return true;
        if (issue.appliesToAll) return true;
        return false;
      });
      
      if (potentialIssues.length === 0) {
        this.notifications.showNotification('Aucun problème enregistré pour les écrans sélectionnés', 'info');
        return;
      }
      
      if (potentialIssues.length === 1) {
        this.startDiagnosis(potentialIssues[0]);
        return;
      }
      
      this.showIssuesSelectionModal(potentialIssues);
    });

    // Scanner QR Code
    document.getElementById('scan-qr-btn')?.addEventListener('click', async () => {
      try {
        const screenId = await this.scanQRCode();
        if (screenId) {
          const screen = this.screens.find(s => s.id == screenId);
          if (screen) {
            this.selectedScreens = [screen];
            document.getElementById('screen-select').value = screenId;
            this.updateStartButtonState();
            this.notifications.showNotification(`Écran sélectionné: ${screen.name}`, 'success');
          } else {
            this.notifications.showNotification('Écran non trouvé', 'error');
          }
        }
      } catch (error) {
        this.notifications.showNotification(`Erreur de scan: ${error.message}`, 'error');
      }
    });

    // Historique des diagnostics
    document.getElementById('view-history-btn')?.addEventListener('click', () => {
      this.showDiagnosisHistory();
    });

    // Actions administrateur
    const user = getCurrentUser();
    if (user?.role === 'admin') {
      // Ajouter un problème
      document.getElementById('add-issue-btn').addEventListener('click', () => {
        this.showIssueForm();
      });

      // Gérer les groupes
      document.getElementById('manage-groups-btn').addEventListener('click', () => {
        this.showGroupsManagement();
      });

      // Voir les statistiques
      document.getElementById('view-stats-btn').addEventListener('click', () => {
        this.showStatistics();
      });

      // Gérer les câbles
      document.getElementById('manage-cables-btn').addEventListener('click', () => {
        this.showCableManagement();
      });

      // Modifier un problème
      document.querySelectorAll('.edit-issue').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const issueId = e.currentTarget.dataset.id;
          const issue = this.issues.find(i => i.id == issueId);
          if (issue) this.showIssueForm(issue);
        });
      });

      // Supprimer un problème
      document.querySelectorAll('.delete-issue').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const issueId = e.currentTarget.dataset.id;
          if (confirm('Confirmez la suppression de ce problème ?')) {
            await db.delete('screen_issues', issueId);
            await this.loadDiagnosisData();
            this.notifications.showNotification('Problème supprimé avec succès', 'success');
            this.afterRender();
          }
        });
      });
    }

    // Actions technicien
    if (user?.role === 'technicien') {
      // Vue technicien
      document.getElementById('tech-view-btn')?.addEventListener('click', () => {
        this.showTechnicianView();
      });

      // Réparations rapides
      document.querySelectorAll('.quick-fixes button').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const fixType = e.currentTarget.dataset.fix;
          this.applyQuickFix(fixType);
        });
      });
    }
  }

  async showTechnicianView() {
    const offlineScreens = this.screens.filter(s => s.status === 'offline');
    const recentIssues = await db.getRecent('diagnosis_history', 5);
    
    const container = document.getElementById('admin-content');
    container.innerHTML = `
      <div class="card">
        <div class="technician-dashboard">
          <h2>Tableau de bord technicien</h2>
          
          <div class="tech-sections">
            <div class="tech-section offline-screens">
              <h3>Écrans hors ligne (${offlineScreens.length})</h3>
              ${offlineScreens.length ? `
                <ul class="screen-list">
                  ${offlineScreens.map(screen => `
                    <li>
                      <div class="screen-info">
                        <strong>${screen.name}</strong>
                        <span>${this.getRoomName(screen.roomId)}</span>
                      </div>
                      <button class="btn diagnose-btn" data-id="${screen.id}">
                        Diagnostiquer
                      </button>
                    </li>
                  `).join('')}
                </ul>
              ` : `
                <div class="empty-state">
                  <i class="fas fa-check-circle"></i>
                  <p>Tous les écrans sont en ligne</p>
                </div>
              `}
            </div>
            
            <div class="tech-section recent-issues">
              <h3>Problèmes récents</h3>
              ${recentIssues.length ? `
                <ul class="issues-list">
                  ${recentIssues.map(issue => `
                    <li>
                      <div class="issue-info">
                        <strong>${this.issues.find(i => i.id === issue.issueId)?.name || 'Inconnu'}</strong>
                        <span>${new Date(issue.startedAt).toLocaleString()}</span>
                      </div>
                      <div class="issue-status ${issue.status}">
                        ${issue.status === 'fixed' ? 'Résolu' : 'En cours'}
                      </div>
                    </li>
                  `).join('')}
                </ul>
              ` : `
                <div class="empty-state">
                  <i class="fas fa-info-circle"></i>
                  <p>Aucun problème récent</p>
                </div>
              `}
            </div>
          </div>
          
          <div class="tech-actions">
            <button id="add-cable-report-btn" class="btn">
              <i class="fas fa-plug"></i> Signaler un câble défectueux
            </button>
            <button id="view-cables-btn" class="btn gray">
              <i class="fas fa-network-wired"></i> Voir tous les câbles
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Boutons de diagnostic
    document.querySelectorAll('.diagnose-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const screenId = btn.dataset.id;
        const screen = this.screens.find(s => s.id === screenId);
        if (screen) {
          this.selectedScreens = [screen];
          document.getElementById('screen-select').value = screenId;
          this.updateStartButtonState();
          this.notifications.showNotification(`Prêt à diagnostiquer ${screen.name}`, 'info');
        }
      });
    });
    
    // Signaler un câble
    document.getElementById('add-cable-report-btn').addEventListener('click', () => {
      this.showCableReportForm();
    });
    
    // Voir les câbles
    document.getElementById('view-cables-btn').addEventListener('click', () => {
      this.showCableManagement();
    });
  }

  async applyQuickFix(fixType) {
    if (this.selectedScreens.length === 0) {
      this.notifications.showNotification('Veuillez sélectionner au moins un écran', 'warning');
      return;
    }
    
    let message = '';
    let success = true;
    
    switch (fixType) {
      case 'restart':
        message = 'Redémarrage des écrans sélectionnés...';
        // Logique de redémarrage
        break;
      case 'check-cable':
        message = 'Vérification des câbles pour les écrans sélectionnés...';
        // Logique de vérification des câbles
        break;
      case 'source':
        message = 'Changement de source pour les écrans sélectionnés...';
        // Logique de changement de source
        break;
      case 'reset':
        message = 'Réinitialisation des paramètres des écrans sélectionnés...';
        // Logique de réinitialisation
        break;
    }
    
    this.notifications.showNotification(message, 'info');
    
    // Simulation d'une réparation
    setTimeout(() => {
      if (Math.random() > 0.3) { // 70% de succès
        this.notifications.showNotification('Réparation réussie!', 'success');
        this.selectedScreens.forEach(async screen => {
          screen.status = 'online';
          await db.save('screens', screen);
        });
      } else {
        this.notifications.showNotification('La réparation rapide n\'a pas fonctionné. Essayez un diagnostic complet.', 'error');
      }
    }, 2000);
  }

  async showCableManagement() {
    const cables = await db.getAll('cables') || [];
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 900px;">
        <span class="close-modal">&times;</span>
        <h3>Gestion des câbles</h3>
        
        <div class="cable-management">
          <div class="cable-list">
            <h4>Câbles enregistrés (${cables.length})</h4>
            ${cables.length ? `
              <table class="cables-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Longueur</th>
                    <th>Connecté à</th>
                    <th>Statut</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${cables.map(cable => `
                    <tr class="${cable.status || 'ok'}">
                      <td>${cable.id}</td>
                      <td>${cable.type}</td>
                      <td>${cable.length || 'N/A'}</td>
                      <td>
                        ${cable.connectedFrom ? `${cable.connectedFrom} → ${cable.connectedTo}` : 'Non connecté'}
                      </td>
                      <td>
                        <span class="status-badge ${cable.status || 'ok'}">
                          ${cable.status === 'broken' ? 'Défectueux' : 'OK'}
                        </span>
                      </td>
                      <td>
                        <button class="btn-icon edit-cable" data-id="${cable.id}">
                          <i class="fas fa-edit"></i>
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `
              <div class="empty-state">
                <i class="fas fa-info-circle"></i>
                <p>Aucun câble enregistré</p>
              </div>
            `}
            
            <button id="add-cable-btn" class="btn">
              <i class="fas fa-plus"></i> Ajouter un câble
            </button>
          </div>
          
          <div class="cable-visualization">
            <h4>Visualisation des connexions</h4>
            <div class="cable-map">
              ${this.renderCableMap(cables)}
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Fermer la modal
    modal.querySelector('.close-modal').addEventListener('click', () => {
      modal.remove();
    });
    
    // Ajouter un câble
    modal.querySelector('#add-cable-btn').addEventListener('click', () => {
      this.showCableForm();
    });
    
    // Modifier un câble
    modal.querySelectorAll('.edit-cable').forEach(btn => {
      btn.addEventListener('click', () => {
        const cableId = btn.dataset.id;
        const cable = cables.find(c => c.id === cableId);
        if (cable) this.showCableForm(cable);
      });
    });
  }

  renderCableMap(cables) {
    // Cette fonction pourrait être améliorée avec une véritable visualisation des connexions
    return `
      <div class="simplified-map">
        ${cables.filter(c => c.connectedFrom && c.connectedTo).map(cable => `
          <div class="cable-connection">
            <div class="connection-from">${cable.connectedFrom}</div>
            <div class="connection-line ${cable.status || 'ok'}">
              <span>${cable.type} ${cable.length ? `(${cable.length})` : ''}</span>
            </div>
            <div class="connection-to">${cable.connectedTo}</div>
          </div>
        `).join('')}
        
        ${cables.filter(c => !c.connectedFrom || !c.connectedTo).length ? `
          <div class="unconnected-cables">
            <h5>Câbles non connectés (${cables.filter(c => !c.connectedFrom || !c.connectedTo).length})</h5>
          </div>
        ` : ''}
      </div>
    `;
  }

  async showCableForm(cable = null) {
    const isEdit = !!cable;
    const devices = await db.getAll('equipments') || [];
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <span class="close-modal">&times;</span>
        <h3>${isEdit ? 'Modifier le câble' : 'Ajouter un nouveau câble'}</h3>
        
        <form id="cable-form">
          <div class="form-group">
            <label>Identifiant du câble</label>
            <input type="text" id="cable-id" value="${cable?.id || ''}" ${isEdit ? 'readonly' : 'required'}>
          </div>
          
          <div class="form-group">
            <label>Type de câble</label>
            <select id="cable-type" required>
              <option value="">-- Sélectionnez --</option>
              ${this.cableTypes.map(type => `
                <option value="${type}" ${cable?.type === type ? 'selected' : ''}>${type}</option>
              `).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label>Longueur (mètres)</label>
            <input type="number" id="cable-length" value="${cable?.length || ''}">
          </div>
          
          <div class="form-group">
            <label>Connecté depuis</label>
            <select id="cable-from">
              <option value="">-- Non connecté --</option>
              ${devices.map(device => `
                <option value="${device.id}" ${cable?.connectedFrom === device.id ? 'selected' : ''}>
                  ${device.name} (${device.type})
                </option>
              `).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label>Connecté à</label>
            <select id="cable-to">
              <option value="">-- Non connecté --</option>
              ${devices.map(device => `
                <option value="${device.id}" ${cable?.connectedTo === device.id ? 'selected' : ''}>
                  ${device.name} (${device.type})
                </option>
              `).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label>Statut</label>
            <select id="cable-status">
              <option value="ok" ${!cable?.status || cable.status === 'ok' ? 'selected' : ''}>Fonctionnel</option>
              <option value="broken" ${cable?.status === 'broken' ? 'selected' : ''}>Défectueux</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Remarques</label>
            <textarea id="cable-notes" rows="2">${cable?.notes || ''}</textarea>
          </div>
          
          <div class="form-actions">
            <button type="button" id="cancel-cable-btn" class="btn danger">
              Annuler
            </button>
            <button type="submit" class="btn btn-primary">
              ${isEdit ? 'Mettre à jour' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Fermer la modal
    const closeModal = () => modal.remove();
    modal.querySelector('.close-modal').addEventListener('click', closeModal);
    modal.querySelector('#cancel-cable-btn').addEventListener('click', closeModal);
    
    // Soumettre le formulaire
    modal.querySelector('#cable-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const cableData = {
        id: modal.querySelector('#cable-id').value,
        type: modal.querySelector('#cable-type').value,
        length: modal.querySelector('#cable-length').value || null,
        connectedFrom: modal.querySelector('#cable-from').value || null,
        connectedTo: modal.querySelector('#cable-to').value || null,
        status: modal.querySelector('#cable-status').value,
        notes: modal.querySelector('#cable-notes').value,
        updatedAt: new Date()
      };
      
      try {
        if (isEdit) {
          await db.save('cables', cableData);
          this.notifications.showNotification('Câble mis à jour avec succès', 'success');
        } else {
          cableData.createdAt = new Date();
          cableData.createdBy = getCurrentUser().username;
          await db.save('cables', cableData);
          this.notifications.showNotification('Câble ajouté avec succès', 'success');
        }
        
        closeModal();
        this.showCableManagement();
      } catch (error) {
        this.notifications.showNotification(`Erreur: ${error.message}`, 'error');
      }
    });
  }

  async showCableReportForm() {
    const devices = await db.getAll('equipments') || [];
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <span class="close-modal">&times;</span>
        <h3>Signaler un câble défectueux</h3>
        
        <form id="cable-report-form">
          <div class="form-group">
            <label>Type de câble</label>
            <select id="report-cable-type" required>
              <option value="">-- Sélectionnez --</option>
              ${this.cableTypes.map(type => `
                <option value="${type}">${type}</option>
              `).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label>Connecté depuis</label>
            <select id="report-cable-from">
              <option value="">-- Non connecté --</option>
              ${devices.map(device => `
                <option value="${device.id}">
                  ${device.name} (${device.type})
                </option>
              `).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label>Connecté à</label>
            <select id="report-cable-to">
              <option value="">-- Non connecté --</option>
              ${devices.map(device => `
                <option value="${device.id}">
                  ${device.name} (${device.type})
                </option>
              `).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label>Description du problème</label>
            <textarea id="report-cable-problem" rows="3" required></textarea>
          </div>
          
          <div class="form-group">
            <label>Urgence</label>
            <select id="report-cable-urgency">
              <option value="low">Faible</option>
              <option value="medium" selected>Moyenne</option>
              <option value="high">Haute</option>
            </select>
          </div>
          
          <div class="form-actions">
            <button type="button" id="cancel-report-btn" class="btn danger">
              Annuler
            </button>
            <button type="submit" class="btn btn-primary">
              Envoyer le rapport
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Fermer la modal
    const closeModal = () => modal.remove();
    modal.querySelector('.close-modal').addEventListener('click', closeModal);
    modal.querySelector('#cancel-report-btn').addEventListener('click', closeModal);
    
    // Soumettre le formulaire
    modal.querySelector('#cable-report-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const reportData = {
        id: `report_${Date.now()}`,
        cableType: modal.querySelector('#report-cable-type').value,
        connectedFrom: modal.querySelector('#report-cable-from').value || null,
        connectedTo: modal.querySelector('#report-cable-to').value || null,
        problem: modal.querySelector('#report-cable-problem').value,
        urgency: modal.querySelector('#report-cable-urgency').value,
        status: 'reported',
        reportedBy: getCurrentUser().username,
        reportedAt: new Date()
      };
      
      try {
        await db.save('cable_reports', reportData);
        this.notifications.showNotification('Rapport envoyé avec succès', 'success');
        closeModal();
      } catch (error) {
        this.notifications.showNotification(`Erreur: ${error.message}`, 'error');
      }
    });
  }

  // ... (other existing methods remain the same, just translated to French)
  // Note: All other methods (startDiagnosis, bindDiagnosisEvents, finishDiagnosis, etc.)
  // should be kept but with French text in the UI elements and notifications

  getIssueScreensLabel(issue) {
    if (issue.appliesToAll) return 'Tous les écrans';
    
    const screens = issue.screenIds?.map(id => 
      this.screens.find(s => s.id === id)?.name
    ).filter(Boolean) || [];
    
    const groups = issue.groupIds?.map(id => 
      this.screenGroups[id]?.name
    ).filter(Boolean) || [];
    
    return [...screens, ...groups].join(', ') || 'Non spécifié';
  }

  getRoomName(roomId) {
    const room = this.rooms.find(r => r.id === roomId);
    return room ? room.name : 'Inconnu';
  }
}