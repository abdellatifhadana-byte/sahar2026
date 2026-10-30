import { db } from './db.js';
import { isFaulty } from './equipment-status-contract.js';
import { PermissionManager } from './permissions.js';
import { getCurrentUser } from './security.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[character]);
const fold = value => String(value ?? '').trim().toLocaleLowerCase('fr-FR');
const activeTicket = ticket => !['fermé','ferme','closed','résolu','resolu','resolved'].includes(fold(ticket.status));
// Même définition de l'anomalie que le tableau de bord et la page Équipements.
const faulty = equipment => isFaulty(equipment);
const percent = (part,total) => total ? Math.round(part / total * 100) : 100;

export default class Rapports {
  constructor(notifications = null) {
    this.notifications = notifications;
    this.snapshot = null;
  }

  async load() {
    const stores = ['equipments','rooms','baies','users','walls','screens','tickets','cables','docs','screen_issues','diagnosis_history'];
    const values = await Promise.all(stores.map(async store => {
      try { return await db.getAll(store); } catch { return []; }
    }));
    this.snapshot = Object.fromEntries(stores.map((store,index) => [store, values[index]]));
    return this.snapshot;
  }

  async render() {
    const data = await this.load();
    const equipments = data.equipments;
    const rooms = data.rooms;
    const baies = data.baies;
    const screens = data.screens;
    const cables = data.cables;
    const tickets = data.tickets;
    const diagrams = data.docs.filter(record => record.kind === 'technical_diagram');

    const byType = new Map();
    for (const equipment of equipments) {
      const type = String(equipment.type || 'Non renseigné').trim() || 'Non renseigné';
      byType.set(type, (byType.get(type) || 0) + 1);
    }
    const byRoom = rooms.map(room => ({
      room,
      equipments:equipments.filter(item => String(item.roomId) === String(room.id)).length,
      baies:baies.filter(item => String(item.roomId) === String(room.id)).length,
      screens:screens.filter(item => String(item.roomId) === String(room.id)).length
    })).sort((a,b) => b.equipments - a.equipments);

    const equipmentsWithRoom = equipments.filter(item => item.roomId != null && rooms.some(room => String(room.id) === String(item.roomId))).length;
    const equipmentsWithBaie = equipments.filter(item => item.baieId == null || baies.some(baie => String(baie.id) === String(item.baieId))).length;
    const equipmentsWithPorts = equipments.filter(item => Array.isArray(item.ports) && item.ports.length > 0).length;
    const connectedCables = cables.filter(item => item.sourcePortId && item.destinationPortId).length;
    const roomsWithImage = rooms.filter(item => item.image || item.imageUrl).length;
    const activeTickets = tickets.filter(activeTicket);
    const faultyEquipments = equipments.filter(faulty);
    const validatedDiagrams = diagrams.filter(item => item.status === 'validated');

    return `<section class="reports-modern">
      <header class="card" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div><h2 style="margin:0;">Rapports & santé de la plateforme</h2><p style="margin:.45rem 0 0;color:#64748b;">Vue consolidée construite à partir des mêmes données canoniques que la carte, les schémas et les pages opérationnelles.</p></div>
        ${PermissionManager.check(getCurrentUser(), 'reports', 'export')
          ? `<button type="button" class="btn gray" id="reports-export"><i class="fas fa-download"></i> Exporter l'instantané</button>`
          : ''}
      </header>

      <div class="reports-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0;">
        ${[
          ['Équipements',equipments.length,'server'],['Salles',rooms.length,'door-open'],['Baies',baies.length,'cube'],
          ['Écrans',screens.length,'tv'],['Câbles',cables.length,'project-diagram'],['Tickets ouverts',activeTickets.length,'life-ring'],
          ['Équipements en anomalie',faultyEquipments.length,'exclamation-triangle'],['Schémas validés',validatedDiagrams.length,'drafting-compass']
        ].map(([label,value,icon]) => `<article class="card" style="padding:15px;"><i class="fas fa-${icon}" aria-hidden="true"></i><strong style="display:block;font-size:1.8rem;margin-top:8px;">${value}</strong><span>${esc(label)}</span></article>`).join('')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px;">
        <article class="card">
          <h3>Qualité des données</h3>
          ${[
            ['Équipements rattachés à une salle',equipmentsWithRoom,equipments.length],
            ['Références de baie cohérentes',equipmentsWithBaie,equipments.length],
            ['Équipements avec ports documentés',equipmentsWithPorts,equipments.length],
            ['Câbles avec deux ports',connectedCables,cables.length],
            ['Salles avec image',roomsWithImage,rooms.length],
            ['Schémas validés',validatedDiagrams.length,diagrams.length]
          ].map(([label,value,total]) => {
            const coverage = percent(value,total);
            return `<div style="margin:12px 0;"><div style="display:flex;justify-content:space-between;gap:10px;"><span>${esc(label)}</span><strong>${coverage}%</strong></div><div style="height:8px;border-radius:99px;background:#e5edf3;overflow:hidden;margin-top:5px;"><span style="display:block;width:${coverage}%;height:100%;background:currentColor;"></span></div><small>${value} / ${total}</small></div>`;
          }).join('')}
        </article>

        <article class="card">
          <h3>Répartition des équipements par type</h3>
          <div style="max-height:360px;overflow:auto;">
            <table class="tableau"><thead><tr><th>Type</th><th>Nombre</th></tr></thead><tbody>
              ${[...byType.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0],'fr')).map(([type,count]) => `<tr><td>${esc(type)}</td><td><strong>${count}</strong></td></tr>`).join('') || '<tr><td colspan="2">Aucun équipement.</td></tr>'}
            </tbody></table>
          </div>
        </article>

        <article class="card" style="grid-column:1/-1;">
          <h3>Occupation par salle</h3>
          <div style="overflow:auto;"><table class="tableau"><thead><tr><th>Salle</th><th>Baies</th><th>Équipements</th><th>Écrans</th><th>Image</th></tr></thead><tbody>
            ${byRoom.map(item => `<tr><td><strong>${esc(item.room.name || item.room.id)}</strong></td><td>${item.baies}</td><td>${item.equipments}</td><td>${item.screens}</td><td>${item.room.image || item.room.imageUrl ? 'Oui' : 'À compléter'}</td></tr>`).join('') || '<tr><td colspan="5">Aucune salle.</td></tr>'}
          </tbody></table></div>
        </article>
      </div>
    </section>`;
  }

  async afterRender() {
    /*
     * ON RETIRE UNE ACTION, PAS DES DONNÉES.
     *
     * `permissions.js` accorde au Responsable `reports.view` et `reports.generate`, et lui
     * refuse `reports.export`. Il doit donc continuer de consulter et de produire ses
     * rapports exactement comme avant ; seule l'extraction du fichier lui est fermée.
     *
     * La question est la PERMISSION, jamais le nom du rôle. Comparer le rôle en dur aurait
     * recréé une seconde matrice, fausse dès le prochain rôle ajouté — et invisible depuis
     * `permissions.js`, qui est pourtant l'endroit où l'on va chercher la réponse.
     */
    document.getElementById('reports-export')?.addEventListener('click', async () => {
      if (!PermissionManager.check(getCurrentUser(), 'reports', 'export')) {
        this.notifications?.showNotification("Vous n'êtes pas autorisé à exporter ce rapport.", 'error');
        return;
      }
      const data = this.snapshot || await this.load();
      const exportValue = { ...data, generatedAt:new Date().toISOString(), reportVersion:2 };
      const blob = new Blob([JSON.stringify(exportValue,null,2)], { type:'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `2mtech-rapport-${new Date().toISOString().slice(0,10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 0);
      this.notifications?.showNotification('Instantané du rapport exporté.', 'success');
    });
  }
}
