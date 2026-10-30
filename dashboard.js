import { db } from './db.js';
import { summarizeEquipmentStatuses, EQUIPMENT_STATUSES } from './equipment-status-contract.js';

/**
 * Les quatre états du parc, déclarés UNE fois.
 *
 * L'anneau et la légende lisent la même table : deux listes de couleurs tenues d'accord à la
 * main finiraient par se contredire, et une légende qui ment sur une couleur est pire que
 * pas de légende du tout.
 */
const ETATS_DU_PARC = Object.freeze([
  Object.freeze({ cle: 'active', libelle: 'Actifs', couleur: '#27ae60' }),
  Object.freeze({ cle: 'maintenance', libelle: 'En maintenance', couleur: '#f39c12' }),
  Object.freeze({ cle: 'faulty', libelle: 'En panne', couleur: '#e74c3c' }),
  Object.freeze({ cle: 'toVerify', libelle: 'À vérifier', couleur: '#5b8aa8' })
]);

export default class Dashboard {
  constructor(container, router = null) {
    this.container = container;
    this.router = router;
    this.ready = this.render();
  }

  async loadData() {
    const stores = ['equipments', 'rooms', 'baies', 'users', 'notifications', 'logs', 'tickets', 'walls', 'screens'];
    const values = await Promise.all(stores.map(async store => {
      try { return await db.getAll(store); }
      catch (error) { throw new Error(`Lecture du store « ${store} » impossible : ${error.message}`); }
    }));
    return Object.fromEntries(stores.map((store, index) => [store, values[index]]));
  }

  async render() {
    this.container.replaceChildren(this.createStatus('Chargement du tableau de bord…', 'dashboard-loading'));
    try {
      const data = await this.loadData();
      if (!this.container.isConnected) return;
      // Un seul vocabulaire d'état, partagé avec la page Équipements et les Rapports.
      const statuses = summarizeEquipmentStatuses(data.equipments);
      const active = statuses.counts[EQUIPMENT_STATUSES.OPERATIONAL];
      const maintenance = statuses.counts[EQUIPMENT_STATUSES.MAINTENANCE];
      const faulty = statuses.counts[EQUIPMENT_STATUSES.DOWN];
      const toVerify = statuses.counts[EQUIPMENT_STATUSES.TO_VERIFY];
      const unread = data.notifications.filter(item => !item.read).length;
      const screensInError = data.screens.filter(item => ['offline', 'error', 'faulty', 'hs'].includes(String(item.status || '').toLowerCase())).length;
      const screensWithoutWall = data.screens.filter(item => item.wallId == null || item.wallId === '').length;
      const screensWithoutEquipment = data.screens.filter(item => item.equipmentId == null || item.equipmentId === '').length;
      const recentLogs = [...data.logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 8);
      const recentTickets = [...data.tickets].sort((a, b) => new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp)).slice(0, 5);
      const roomStats = data.rooms.map(room => ({
        room,
        equipments: data.equipments.filter(item => String(item.roomId) === String(room.id)).length,
        baies: data.baies.filter(item => String(item.roomId) === String(room.id)).length,
        walls: data.walls.filter(item => String(item.roomId) === String(room.id)).length
      })).sort((a, b) => b.equipments - a.equipments).slice(0, 5);

      const root = document.createElement('div'); root.className = 'dashboard-main';
      const cards = document.createElement('div'); cards.className = 'dashboard-cards';
      const definitions = [
        ['Équipements', data.equipments.length, 'server', 'devices'],
        ['Équipements actifs', active, 'check-circle', 'devices'],
        ['En maintenance', maintenance, 'tools', 'devices'],
        ['En panne', faulty, 'times-circle', 'devices'],
        ['État à vérifier', toVerify, 'question-circle', 'devices'],
        ['Salles', data.rooms.length, 'building', 'salles'],
        ['Baies', data.baies.length, 'network-wired', 'baies'],
        ["Murs d'images", data.walls.length, 'border-all', 'walls'],
        ['Écrans', data.screens.length, 'tv', 'screensDiagnostic'],
        ['Écrans en erreur', screensInError, 'exclamation-triangle', 'screensDiagnostic'],
        ['Écrans sans mur', screensWithoutWall, 'unlink', 'screensDiagnostic'],
        ['Écrans sans équipement', screensWithoutEquipment, 'plug', 'screensDiagnostic'],
        ['Utilisateurs', data.users.length, 'users', 'users'],
        ['Notifications non lues', unread, 'bell', null],
        ['Tickets', data.tickets.length, 'ticket-alt', 'tickets']
      ];
      for (const definition of definitions) cards.appendChild(this.createCard(...definition));
      root.appendChild(cards);

      const detail = document.createElement('div'); detail.className = 'dashboard-flex';
      const chartSection = this.section("État des équipements");
      const canvas = document.createElement('canvas'); canvas.id = 'equipments-status-chart'; canvas.width = 220; canvas.height = 220;
      chartSection.appendChild(canvas);
      chartSection.appendChild(this.createChartLegend({ active, maintenance, faulty, toVerify }));
      detail.appendChild(chartSection);
      detail.appendChild(this.createListSection('Activités récentes', recentLogs, log => `${log.action || 'Activité'} — ${this.formatDate(log.timestamp)}`));
      detail.appendChild(this.createListSection('Tickets récents', recentTickets, ticket => `${ticket.title || 'Ticket support'} — ${ticket.status || 'ouvert'}`));
      root.appendChild(detail);

      const roomsSection = this.section('Salles les plus équipées');
      for (const item of roomStats) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'room-stat-card clickable';
        button.textContent = `${item.room.name} — ${item.equipments} équipement(s), ${item.baies} baie(s), ${item.walls} mur(s)`;
        button.addEventListener('click', () => this.navigate('salles'));
        roomsSection.appendChild(button);
      }
      if (!roomStats.length) roomsSection.appendChild(this.createStatus('Aucune salle enregistrée.', 'empty-note'));
      root.appendChild(roomsSection);
      this.container.replaceChildren(root);
      this.renderEquipmentsChart(canvas, active, maintenance, faulty, toVerify);
    } catch (error) {
      console.error('Dashboard initialization failed', error);
      const failure = this.createStatus(`Impossible de charger le tableau de bord : ${error.message}`, 'error-message');
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.textContent = 'Réessayer'; retry.addEventListener('click', () => this.render());
      failure.appendChild(retry); this.container.replaceChildren(failure);
    }
  }

  createCard(label, value, icon, destination) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'stat-card clickable'; card.disabled = !destination;
    const iconElement = document.createElement('i'); iconElement.className = `fas fa-${icon}`;
    const valueElement = document.createElement('strong'); valueElement.textContent = value;
    const labelElement = document.createElement('span'); labelElement.textContent = label;
    card.append(iconElement, valueElement, labelElement);
    if (destination) card.addEventListener('click', () => this.navigate(destination));
    return card;
  }

  section(title) { const section = document.createElement('section'); section.className = 'dashboard-section'; const heading = document.createElement('h3'); heading.textContent = title; section.appendChild(heading); return section; }
  createListSection(title, items, formatter) { const section = this.section(title); if (!items.length) section.appendChild(this.createStatus('Aucune donnée récente.', 'empty-note')); for (const item of items) { const row = document.createElement('p'); row.textContent = formatter(item); section.appendChild(row); } return section; }
  createStatus(message, className) { const status = document.createElement('div'); status.className = className; status.textContent = message; return status; }
  formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'date inconnue' : date.toLocaleString('fr-FR'); }
  navigate(destination) { if (this.router?.navigate) this.router.navigate(destination); else window.location.hash = `#/${destination}`; }

  /**
   * L'anneau d'état du parc.
   *
   * CE QU'IL NE MONTRAIT PAS
   * ------------------------
   * Il ne connaissait que trois catégories : actif, en maintenance, en panne. Or « état à
   * vérifier » est calculé juste à côté, affiché en carte… et n'était jamais passé ici.
   *
   * Sur le parc réel de 2M, les 448 équipements sont TOUS « à vérifier » : les trois
   * catégories connues valaient donc 0, le total tombait à 0, et l'anneau ne dessinait rien
   * — un grand cadre vide avec un « 0 » au milieu, alors que la plateforme contient 448
   * appareils. Le graphique était aveugle à la seule catégorie qui décrit le parc.
   */
  /** La légende : sans elle, quatre couleurs ne veulent rien dire. */
  createChartLegend(valeurs) {
    const legende = document.createElement('ul');
    legende.className = 'chart-legend';
    for (const etat of ETATS_DU_PARC) {
      const item = document.createElement('li');
      const pastille = document.createElement('span');
      pastille.className = 'chart-legend-dot';
      pastille.style.background = etat.couleur;
      const texte = document.createElement('span');
      texte.textContent = `${etat.libelle} : ${Number(valeurs[etat.cle]) || 0}`;
      item.append(pastille, texte);
      legende.appendChild(item);
    }
    return legende;
  }

  renderEquipmentsChart(canvas, active, maintenance, faulty, toVerify = 0) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error("Le navigateur ne permet pas d'afficher le graphique");
    const valeurs = { active, maintenance, faulty, toVerify };
    const data = ETATS_DU_PARC.map(etat => Number(valeurs[etat.cle]) || 0);
    const colors = ETATS_DU_PARC.map(etat => etat.couleur);
    const somme = data.reduce((sum, value) => sum + value, 0);
    // Aucun équipement du tout : le dire, plutôt que dessiner un anneau vide qui laisse
    // croire à une panne d'affichage.
    if (!somme) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = '15px Segoe UI'; context.fillStyle = '#7a8b9b'; context.textAlign = 'center';
      context.fillText('Aucun équipement enregistré', 110, 115);
      return;
    }
    const total = somme;
    let start = -Math.PI / 2;
    data.forEach((value, index) => { const angle = value / total * Math.PI * 2; context.beginPath(); context.moveTo(110, 110); context.arc(110, 110, 90, start, start + angle); context.closePath(); context.fillStyle = colors[index]; context.fill(); start += angle; });
    context.beginPath(); context.arc(110, 110, 60, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill(); context.font = 'bold 32px Segoe UI'; context.fillStyle = '#2874a6'; context.textAlign = 'center'; context.fillText(String(data.reduce((sum, value) => sum + value, 0)), 110, 122);
  }
}
