import { db } from './db.js';
// LES RÈGLES DE LA CARTE VIENNENT DU CONTRAT, ET DE LUI SEUL.
//
// Ce fichier en portait une COPIE : quatre fonctions au texte identique, mais s'appuyant sur
// une aide `finite` plus permissive — `Number.isFinite(Number(value))`, où `Number(null)` et
// `Number('')` valent 0. Mesuré sur huit états d'entité : CINQ recevaient deux réponses
// différentes. Une salle aux coordonnées nulles ou vides était comptée « placée » par le code
// qui tourne et « non placée » par le code que les tests vérifient — car `index.html` charge
// CE fichier, tandis que la suite de tests importe le contrat.
//
// Les réimporter au lieu de les redéfinir supprime la divergence ET met enfin les tests en
// face du code réellement exécuté.
import {
  mapEntityPositionState,
  normalizedOperationalState,
  mapQualitySummary,
  smartMapSearch
} from './map-digital-twin-contract.js';

export { mapEntityPositionState, normalizedOperationalState, mapQualitySummary, smartMapSearch };
import { buildPlatformEntityGraph } from './platform-entity-graph.js';
import { traceGraph } from './technical-graph.js';

export const MAP_DIGITAL_TWIN_VERSION = 2;
export const MAP_DIGITAL_TWIN_PHASE = 18;

const ACTIVE_TICKET_STATUSES = new Set(['en cours','attente','pret fermeture','open','pending','in progress']);
const TYPE_LABELS = Object.freeze({room:'Salle',baie:'Baie',equipment:'Équipement'});
const TYPE_ICONS = Object.freeze({room:'door-open',baie:'cube',equipment:'server'});
const asArray = value => Array.isArray(value) ? value : [];
const same = (left,right) => left != null && right != null && String(left) === String(right);
const clean = value => String(value ?? '').trim();
const fold = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
const escapeText = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const cssEscape = value => globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g,'\\$&');

function safeStore(name) { return db.getAll(name).catch(() => []); }

export async function buildMapDigitalTwinSnapshot() {
  await db.open();
  const [rooms,baies,equipments,walls,screens,cables,docs,tickets] = await Promise.all([
    safeStore('rooms'),safeStore('baies'),safeStore('equipments'),safeStore('walls'),safeStore('screens'),safeStore('cables'),safeStore('docs'),safeStore('tickets')
  ]);
  return {rooms,baies,equipments,walls,screens,cables,docs,tickets,loadedAt:new Date().toISOString()};
}

function requiresFieldAttention(record={}) {
  const verification=fold(record.verificationStatus ?? record.evidenceStatus);
  return record.requiresFieldConfirmation === true || record.exactModelConfirmed === false || ['function only','label only','family only','pending','a verifier','to confirm','needs more evidence'].some(token => verification.includes(token));
}

function activeTickets(snapshot) {
  return asArray(snapshot?.tickets).filter(ticket => ACTIVE_TICKET_STATUSES.has(fold(ticket.status)) || (!ticket.status && ticket.closed !== true));
}

function ticketIndex(snapshot) {
  const index=new Map();
  for (const ticket of activeTickets(snapshot)) {
    const type=clean(ticket.relatedType || ticket.type); const id=ticket.relatedId ?? ticket.targetId;
    if (!type || id == null) continue;
    const key=`${type}:${id}`;
    if (!index.has(key)) index.set(key,[]);
    index.get(key).push(ticket);
  }
  return index;
}

function roomOf(snapshot,entity,type) {
  if (!entity) return null;
  if (type === 'room') return entity;
  if (type === 'baie') return snapshot.rooms.find(room => same(room.id,entity.roomId)) || null;
  if (type === 'equipment') {
    if (entity.roomId != null) return snapshot.rooms.find(room => same(room.id,entity.roomId)) || null;
    if (entity.baieId != null) {
      const baie=snapshot.baies.find(item => same(item.id,entity.baieId));
      return baie ? snapshot.rooms.find(room => same(room.id,baie.roomId)) || null : null;
    }
  }
  return null;
}

function baieOf(snapshot,equipment) {
  return equipment?.baieId != null ? snapshot.baies.find(baie => same(baie.id,equipment.baieId)) || null : null;
}

function displayName(record,type) {
  return clean(record?.name || record?.nom || record?.reference || record?.numSerie) || `${TYPE_LABELS[type] || type} ${record?.id ?? ''}`.trim();
}

function equipmentIdsFromTrace(trace={}) {
  const ids=new Set();
  for (const node of asArray(trace.nodes)) {
    if (node.type === 'equipment' && node.entity?.id != null) ids.add(String(node.entity.id));
    else if (node.type === 'port' && node.ownerType === 'equipment' && node.ownerId != null) ids.add(String(node.ownerId));
    else if (node.type === 'component' && node.parentEquipmentId != null) ids.add(String(node.parentEquipmentId));
  }
  return ids;
}

export function analyzeMapImpact(snapshot,equipmentId) {
  // Ne pas construire une topologie parallèle ici : buildPlatformEntityGraph lit les TOPOLOGY_KINDS
  // canoniques directement depuis docs, y compris topology_router_port / topology_signal_path.
  const graph=buildPlatformEntityGraph({
    rooms:snapshot.rooms,baies:snapshot.baies,equipments:snapshot.equipments,walls:snapshot.walls,screens:snapshot.screens,
    cables:snapshot.cables,docs:snapshot.docs,continuityRecords:snapshot.docs
  });
  const start=`equipment:${equipmentId}`;
  if (!graph.nodes.has(start)) return {available:false,start,equipmentId:String(equipmentId),upstream:new Set(),downstream:new Set(),screens:[],graph};
  const downstreamTrace=traceGraph(graph,start,{direction:'downstream',maxDepth:40});
  const upstreamTrace=traceGraph(graph,start,{direction:'upstream',maxDepth:40});
  const downstream=equipmentIdsFromTrace(downstreamTrace); const upstream=equipmentIdsFromTrace(upstreamTrace);
  downstream.delete(String(equipmentId)); upstream.delete(String(equipmentId));
  const screens=[...new Map(downstreamTrace.nodes.filter(node => node?.type === 'screen' && node.entity?.id != null).map(node => [String(node.entity.id),node.entity])).values()];
  return {
    available:true,start,equipmentId:String(equipmentId),upstream,downstream,screens,graph,
    downstreamEdges:downstreamTrace.edges.length,upstreamEdges:upstreamTrace.edges.length,
    unresolved:graph.unresolved.length,compatibilityIssues:graph.compatibilityIssues?.length || 0,
    truncated:Boolean(downstreamTrace.truncated || upstreamTrace.truncated)
  };
}

function searchDocuments(snapshot) {
  const tickets=ticketIndex(snapshot); const documents=[];
  for (const room of snapshot.rooms) documents.push({type:'room',id:room.id,name:displayName(room,'room'),record:room,detail:clean(room.code || room.description),room:null,baie:null});
  for (const baie of snapshot.baies) {
    const room=roomOf(snapshot,baie,'baie');
    documents.push({type:'baie',id:baie.id,name:displayName(baie,'baie'),record:baie,detail:[room && displayName(room,'room'),baie.reference].filter(Boolean).join(' · '),room,baie:null});
  }
  for (const equipment of snapshot.equipments) {
    const room=roomOf(snapshot,equipment,'equipment'); const baie=baieOf(snapshot,equipment);
    documents.push({type:'equipment',id:equipment.id,name:displayName(equipment,'equipment'),record:equipment,room,baie,detail:[equipment.marque,equipment.modele,equipment.reference,baie && displayName(baie,'baie'),room && displayName(room,'room')].filter(Boolean).join(' · ')});
  }
  return documents.map(document => ({...document,tickets:tickets.get(`${document.type}:${document.id}`) || []}));
}

function ensureStyleLink() {
  if (document.getElementById('map-digital-twin-css')) return;
  const link=document.createElement('link'); link.id='map-digital-twin-css'; link.rel='stylesheet'; link.href='/map-digital-twin.css'; document.head.appendChild(link);
}

function ensureContextMenuSeed() {
  let menu=document.getElementById('admin-context-menu');
  if (!menu) {
    menu=document.createElement('div'); menu.id='admin-context-menu'; menu.className='map-admin-context-menu'; menu.setAttribute('role','menu');
    menu.innerHTML=`<button type="button" class="context-menu-item" data-action="edit" role="menuitem"><i class="fas fa-pen"></i><span>Modifier / dessiner la zone</span></button><button type="button" class="context-menu-item" data-action="move" role="menuitem"><i class="fas fa-arrows-alt"></i><span>Déplacer</span></button><button type="button" class="context-menu-item" data-action="resize" role="menuitem"><i class="fas fa-expand-arrows-alt"></i><span>Redimensionner</span></button><button type="button" class="context-menu-item" data-action="change-image" role="menuitem"><i class="fas fa-image"></i><span>Changer l’image</span></button><div class="context-menu-separator"></div><button type="button" class="context-menu-item" data-action="delete" role="menuitem"><i class="fas fa-trash"></i><span>Supprimer</span></button>`;
    document.body.appendChild(menu);
  }
  if (!menu.__mapTypedAttributeBridge) {
    const nativeSet=menu.setAttribute.bind(menu),nativeGet=menu.getAttribute.bind(menu);
    menu.setAttribute=(name,value)=>{ if (name==='data-id') menu.__mapTypedId=/^-?\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))?Number(value):String(value); return nativeSet(name,value); };
    menu.getAttribute=name=>name==='data-id'&&menu.__mapTypedId!==undefined?menu.__mapTypedId:nativeGet(name);
    Object.defineProperty(menu,'__mapTypedAttributeBridge',{value:true});
  }
  globalThis.contextMenuVisible=Boolean(globalThis.contextMenuVisible);
  return menu;
}

function clampContextMenu() {
  const menu=document.getElementById('admin-context-menu'); if (!menu||menu.style.display==='none') return;
  const rect=menu.getBoundingClientRect();
  menu.style.left=`${clamp(parseFloat(menu.style.left)||0,8,Math.max(8,window.innerWidth-rect.width-8))}px`;
  menu.style.top=`${clamp(parseFloat(menu.style.top)||0,8,Math.max(8,window.innerHeight-rect.height-8))}px`;
}

function findEntity(snapshot,type,id) {
  const records=type==='room'?snapshot.rooms:type==='baie'?snapshot.baies:snapshot.equipments;
  return records.find(record=>same(record.id,id))||null;
}

function accessibleLabel(snapshot,type,id) {
  const record=findEntity(snapshot,type,id); if (!record) return TYPE_LABELS[type]||type;
  const location=[]; const room=roomOf(snapshot,record,type); const baie=type==='equipment'?baieOf(snapshot,record):null;
  if (room&&type!=='room') location.push(displayName(room,'room')); if (baie) location.push(displayName(baie,'baie'));
  return `${TYPE_LABELS[type]||type} ${displayName(record,type)}${location.length?` — ${location.join(' / ')}`:''}`;
}

function qualityWarningFor(type,record) { return !mapEntityPositionState(type,record)||(type==='equipment'&&requiresFieldAttention(record)); }

function applyImpactClasses(modal,state) {
  for (const spot of modal.querySelectorAll('.map-hotspot')) spot.classList.remove('map-impact-origin','map-impact-upstream','map-impact-downstream');
  const impact=state.impact; if (!impact?.available) return;
  for (const spot of modal.querySelectorAll('.map-hotspot.equipment[data-id]')) {
    const id=String(spot.dataset.id);
    if (id===impact.equipmentId) spot.classList.add('map-impact-origin');
    else { if (impact.downstream.has(id)) spot.classList.add('map-impact-downstream'); if (impact.upstream.has(id)) spot.classList.add('map-impact-upstream'); }
  }
}

function decorateHotspots(modal,state) {
  if (!state.snapshot) return;
  const tickets=ticketIndex(state.snapshot);
  for (const spot of modal.querySelectorAll('.map-hotspot[data-type][data-id]')) {
    const type=spot.dataset.type,id=spot.dataset.id,record=findEntity(state.snapshot,type,id); if (!record) continue;
    spot.tabIndex=0; spot.setAttribute('role','button'); spot.setAttribute('aria-label',accessibleLabel(state.snapshot,type,id));
    spot.classList.remove('map-status-fault','map-status-warning','map-status-ok','map-has-ticket','map-quality-warning','map-has-alert');
    const operational=normalizedOperationalState(record); if (operational!=='neutral') spot.classList.add(`map-status-${operational}`);
    const hasTicket=(tickets.get(`${type}:${id}`)||[]).length>0,quality=qualityWarningFor(type,record);
    if (hasTicket) spot.classList.add('map-has-ticket'); if (quality) spot.classList.add('map-quality-warning'); if (hasTicket||operational==='fault'||operational==='warning') spot.classList.add('map-has-alert');
    if (!spot.dataset.mapKeyboardReady) {
      spot.dataset.mapKeyboardReady='1';
      spot.addEventListener('keydown',event=>{ if (event.key==='Enter'||event.key===' ') { event.preventDefault(); spot.click(); } });
      spot.addEventListener('pointerdown',event=>{
        if (!['touch','pen'].includes(event.pointerType)||!modal.querySelector('#edit-mode-btn.success')||typeof spot.onmousedown!=='function') return;
        event.preventDefault(); spot.onmousedown(new MouseEvent('mousedown',{clientX:event.clientX,clientY:event.clientY,bubbles:false}));
        const move=moveEvent=>{ if (moveEvent.pointerId===event.pointerId&&typeof document.onmousemove==='function') document.onmousemove(new MouseEvent('mousemove',{clientX:moveEvent.clientX,clientY:moveEvent.clientY})); };
        const end=endEvent=>{ if (endEvent.pointerId!==event.pointerId) return; document.removeEventListener('pointermove',move,true); document.removeEventListener('pointerup',end,true); document.removeEventListener('pointercancel',end,true); document.onmouseup?.(new MouseEvent('mouseup',{clientX:endEvent.clientX,clientY:endEvent.clientY})); };
        document.addEventListener('pointermove',move,true); document.addEventListener('pointerup',end,true); document.addEventListener('pointercancel',end,true);
      });
    }
  }
  applyImpactClasses(modal,state);
}

function panelHeading(modal) {
  const panel=modal.querySelector('#map-panel'); if (!panel||getComputedStyle(panel).display==='none') return 'Plan technique';
  const candidate=panel.querySelector('h1,h2,h3,.panel-title,strong'); return clean(candidate?.textContent).slice(0,90)||'Détail cartographique';
}

function ensureBreadcrumb(modal) {
  let breadcrumb=modal.querySelector('#map-digital-breadcrumb');
  if (!breadcrumb) { breadcrumb=document.createElement('div'); breadcrumb.id='map-digital-breadcrumb'; breadcrumb.innerHTML='<i class="fas fa-map-marked-alt"></i><span></span>'; modal.appendChild(breadcrumb); }
  const next=`Jumeau opérationnel · ${panelHeading(modal)}`; const span=breadcrumb.querySelector('span'); if (span.textContent!==next) span.textContent=next;
}

function renderSmartResults(state,results) {
  const container=state.modal.querySelector('#map-search-results'); if (!container) return;
  container.classList.add('map-smart-search'); container.replaceChildren();
  if (!results.length) { container.style.display='none'; state.searchResults=[]; state.searchCursor=-1; return; }
  results.forEach((result,index)=>{
    const button=document.createElement('button'); button.type='button'; button.className='map-smart-result map-search-result'; button.dataset.type=result.type; button.dataset.id=String(result.id); button.dataset.index=String(index);
    const icon=document.createElement('i'); icon.className=`fas fa-${TYPE_ICONS[result.type]||'circle'}`;
    const text=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small'); strong.textContent=result.name; small.textContent=result.detail||TYPE_LABELS[result.type]; text.append(strong,small);
    const badges=document.createElement('span'); badges.className='map-result-badges';
    if (normalizedOperationalState(result.record)==='fault') { const badge=document.createElement('i'); badge.className='map-result-badge fault'; badge.title='Panne / état critique'; badges.appendChild(badge); }
    if (result.tickets.length) { const badge=document.createElement('i'); badge.className='map-result-badge ticket'; badge.title=`${result.tickets.length} ticket(s) actif(s)`; badges.appendChild(badge); }
    if (qualityWarningFor(result.type,result.record)) { const badge=document.createElement('i'); badge.className='map-result-badge'; badge.title='Position ou preuve à compléter'; badges.appendChild(badge); }
    button.append(icon,text,badges); container.appendChild(button);
  });
  container.style.display='block'; state.searchResults=results; state.searchCursor=-1;
}

function clickVisibleSpot(modal,type,id) {
  const spot=modal.querySelector(`.map-hotspot.${type}[data-id="${cssEscape(id)}"]`); if (!spot) return false; spot.click(); return true;
}

async function returnToMapRoot(modal) {
  for (let step=0;step<5;step+=1) {
    const panel=modal.querySelector('#map-panel'); if (!panel||getComputedStyle(panel).display==='none') return;
    const back=panel.querySelector('#panel-back-btn'); if (!back) return; back.click(); await new Promise(resolve=>setTimeout(resolve,25));
  }
}

async function navigateSearchResult(state,result) {
  const modal=state.modal;
  if (result.type==='equipment') return; // map-equipment-360-bridge garde la Fiche 360 comme navigation canonique.
  if (clickVisibleSpot(modal,result.type,result.id)) return;
  await returnToMapRoot(modal);
  if (result.type==='room') { clickVisibleSpot(modal,'room',result.id); return; }
  if (result.type==='baie') {
    const baie=findEntity(state.snapshot,'baie',result.id); if (!baie) return;
    if (baie.roomId!=null && clickVisibleSpot(modal,'room',baie.roomId)) { await new Promise(resolve=>setTimeout(resolve,30)); clickVisibleSpot(modal,'baie',baie.id); }
  }
}

function installSmartSearch(modal,state) {
  const oldInput=modal.querySelector('#map-search'); if (!oldInput||oldInput.dataset.smartMapSearch==='1') return;
  const input=oldInput.cloneNode(true); input.dataset.smartMapSearch='1'; input.placeholder='Rechercher nom, modèle, référence, salle, baie…'; oldInput.replaceWith(input);
  const container=modal.querySelector('#map-search-results');
  container?.addEventListener('click',event=>{
    const button=event.target.closest('.map-smart-result'); if (!button) return;
    const result=state.searchResults[Number(button.dataset.index)]; if (!result) return;
    if (result.type!=='equipment') { event.preventDefault(); event.stopImmediatePropagation(); container.style.display='none'; navigateSearchResult(state,result).catch(()=>{}); }
  },true);
  input.addEventListener('input',()=>renderSmartResults(state,smartMapSearch(state.snapshot,input.value)));
  input.addEventListener('keydown',event=>{
    const buttons=[...modal.querySelectorAll('#map-search-results .map-smart-result')]; if (!buttons.length) return;
    if (event.key==='ArrowDown') { event.preventDefault(); state.searchCursor=(state.searchCursor+1)%buttons.length; }
    else if (event.key==='ArrowUp') { event.preventDefault(); state.searchCursor=(state.searchCursor-1+buttons.length)%buttons.length; }
    else if (event.key==='Enter'&&state.searchCursor>=0) { event.preventDefault(); buttons[state.searchCursor]?.click(); return; }
    else if (event.key==='Escape') { renderSmartResults(state,[]); return; } else return;
    buttons.forEach((button,index)=>button.classList.toggle('active',index===state.searchCursor)); buttons[state.searchCursor]?.scrollIntoView({block:'nearest'});
  });
}

function relationLocation(snapshot,equipment) {
  const room=roomOf(snapshot,equipment,'equipment'),baie=baieOf(snapshot,equipment); return [room&&displayName(room,'room'),baie&&displayName(baie,'baie')].filter(Boolean).join(' / ')||'Localisation non résolue';
}

function impactSection(state) {
  const impact=state.impact;
  if (!impact?.available) return `<p class="mdt-disclaimer"><strong>Mode Impact :</strong> sélectionnez un équipement sur la carte. Seules les relations réellement présentes dans le graphe canonique sont suivies. Aucun routage live n’est deviné.</p>`;
  const equipment=findEntity(state.snapshot,'equipment',impact.equipmentId);
  const downstream=[...impact.downstream].map(id=>findEntity(state.snapshot,'equipment',id)).filter(Boolean),upstream=[...impact.upstream].map(id=>findEntity(state.snapshot,'equipment',id)).filter(Boolean);
  const item=(record,kind)=>`<button type="button" class="mdt-list-item" data-focus-equipment="${escapeText(record.id)}"><strong>${escapeText(displayName(record,'equipment'))}</strong><span class="mdt-pill ${kind==='Aval'?'alert':''}">${kind}</span><small>${escapeText(relationLocation(state.snapshot,record))}</small></button>`;
  return `<div class="mdt-list"><div class="mdt-list-item" style="cursor:default"><strong>${escapeText(displayName(equipment,'equipment'))}</strong><span class="mdt-pill">Origine</span><small>${escapeText(relationLocation(state.snapshot,equipment))}</small></div>${upstream.slice(0,10).map(record=>item(record,'Amont')).join('')}${downstream.slice(0,14).map(record=>item(record,'Aval')).join('')}</div><p class="mdt-disclaimer" style="margin-top:8px">${upstream.length} équipement(s) amont · ${downstream.length} aval · ${impact.screens.length} écran(s) · ${impact.unresolved} relation(s) non résolue(s).${impact.truncated?' Tracé borné pour sécurité.':''}</p>`;
}

function renderCommandCenter(state) {
  const panel=state.panel; if (!panel||!state.snapshot) return;
  const quality=mapQualitySummary(state.snapshot),graph=state.graph,missing=quality.missing.slice(0,12);
  panel.querySelector('.mdt-scroll').innerHTML=`<section class="mdt-section"><h3><i class="fas fa-tachometer-alt"></i> État cartographique</h3><div class="mdt-kpis"><div class="mdt-kpi ok"><strong>${quality.coverage}%</strong><small>couverture des positions</small></div><div class="mdt-kpi ${quality.tickets?'alert':''}"><strong>${quality.tickets}</strong><small>tickets actifs</small></div><div class="mdt-kpi ${quality.faults?'alert':''}"><strong>${quality.faults}</strong><small>équipements en panne/critique</small></div><div class="mdt-kpi ${graph?.unresolved?.length?'warn':''}"><strong>${graph?.unresolved?.length||0}</strong><small>relations non résolues</small></div></div><div class="mdt-progress" title="${quality.positioned} sur ${quality.total} éléments positionnés"><span style="width:${quality.coverage}%"></span></div></section>
  <section class="mdt-section"><h3><i class="fas fa-layer-group"></i> Couches</h3><div class="mdt-layer-grid"><label class="mdt-layer"><input type="checkbox" data-layer="room" checked> Salles</label><label class="mdt-layer"><input type="checkbox" data-layer="baie" checked> Baies</label><label class="mdt-layer"><input type="checkbox" data-layer="equipment" checked> Équipements</label><label class="mdt-layer"><input type="checkbox" data-layer="alerts"> Alertes seules</label><label class="mdt-layer"><input type="checkbox" data-layer="quality"> À compléter</label><label class="mdt-layer"><input type="checkbox" data-layer="tickets" checked disabled> Tickets actifs</label></div></section>
  <section class="mdt-section"><h3><i class="fas fa-project-diagram"></i> Jumeau opérationnel</h3><div class="mdt-actions"><button type="button" class="mdt-btn ${state.impactMode?'active':''}" data-action="impact"><i class="fas fa-bolt"></i> Mode Impact</button><button type="button" class="mdt-btn" data-action="clear-impact"><i class="fas fa-eraser"></i> Effacer</button>${state.impact?.available?'<button type="button" class="mdt-btn" data-action="open-origin-360"><i class="fas fa-cube"></i> Fiche 360</button>':''}</div><div style="margin-top:9px">${impactSection(state)}</div></section>
  <section class="mdt-section"><h3><i class="fas fa-exclamation-triangle"></i> Qualité / terrain</h3><div class="mdt-kpis"><div class="mdt-kpi ${quality.missing.length?'warn':'ok'}"><strong>${quality.missing.length}</strong><small>positions à compléter</small></div><div class="mdt-kpi ${quality.needsEvidence?'warn':'ok'}"><strong>${quality.needsEvidence}</strong><small>identifications terrain à confirmer</small></div></div><div class="mdt-list" style="margin-top:8px">${missing.length?missing.map(item=>`<button type="button" class="mdt-list-item" data-search-target="${escapeText(item.name)}"><strong>${escapeText(item.name)}</strong><span class="mdt-pill warn">${TYPE_LABELS[item.type]}</span><small>Position cartographique incomplète</small></button>`).join(''):'<div class="mdt-empty">Aucune position manquante détectée.</div>'}</div></section>
  <section class="mdt-section"><h3><i class="fas fa-map-signs"></i> Navigation</h3><div class="mdt-actions"><button type="button" class="mdt-btn" data-action="fit"><i class="fas fa-expand-arrows-alt"></i> Adapter</button><button type="button" class="mdt-btn" data-action="reset"><i class="fas fa-compress"></i> Réinitialiser</button><button type="button" class="mdt-btn" data-action="search"><i class="fas fa-search"></i> Rechercher</button><button type="button" class="mdt-btn" data-action="refresh"><i class="fas fa-sync-alt"></i> Actualiser</button></div></section>
  <section class="mdt-section"><h3><i class="fas fa-info-circle"></i> Légende & confiance</h3><div class="mdt-legend"><span><i class="mdt-dot"></i> opérationnel</span><span><i class="mdt-dot warn"></i> à vérifier</span><span><i class="mdt-dot fault"></i> panne/critique</span><span><i class="mdt-dot ticket"></i> ticket actif</span><span><i class="mdt-dot up"></i> impact amont</span><span><i class="mdt-dot down"></i> impact aval</span></div><p class="mdt-disclaimer" style="margin-top:9px"><strong>Important :</strong> cette vue n’invente aucun câble, port ou crosspoint. Le Mode Impact suit seulement le graphe canonique documenté ; les relations non résolues restent signalées comme telles.</p></section>`;
  bindCommandCenter(state);
  state.toggle?.querySelector('.map-command-alert-dot')?.remove();
  if (quality.tickets||quality.faults||quality.missing.length) { const dot=document.createElement('span'); dot.className='map-command-alert-dot'; state.toggle?.appendChild(dot); }
}

function applyLayerState(state) {
  const modal=state.modal; modal.classList.toggle('map-digital-hide-room',state.layers.room===false); modal.classList.toggle('map-digital-hide-baie',state.layers.baie===false); modal.classList.toggle('map-digital-hide-equipment',state.layers.equipment===false); modal.classList.toggle('map-digital-alerts-only',state.layers.alerts===true); modal.classList.toggle('map-digital-quality-only',state.layers.quality===true);
}

function bindCommandCenter(state) {
  const panel=state.panel;
  panel.querySelectorAll('[data-layer]').forEach(input=>{ const key=input.dataset.layer; if (key in state.layers) input.checked=Boolean(state.layers[key]); input.addEventListener('change',()=>{ state.layers[key]=input.checked; applyLayerState(state); }); });
  panel.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{
    const action=button.dataset.action;
    if (action==='impact') { state.impactMode=!state.impactMode; renderCommandCenter(state); }
    if (action==='clear-impact') { state.impact=null; applyImpactClasses(state.modal,state); renderCommandCenter(state); }
    if (action==='fit') state.modal.querySelector('#fit-map-btn')?.click();
    if (action==='reset') state.modal.querySelector('#reset-zoom')?.click();
    if (action==='search') state.modal.querySelector('#map-search')?.focus();
    if (action==='refresh') await refreshState(state);
    if (action==='open-origin-360'&&state.impact?.equipmentId&&window.TechOperations?.openEquipment360) { const equipment=findEntity(state.snapshot,'equipment',state.impact.equipmentId); if (equipment) window.TechOperations.openEquipment360(equipment); }
  }));
  panel.querySelectorAll('[data-search-target]').forEach(button=>button.addEventListener('click',()=>{ const input=state.modal.querySelector('#map-search'); if (!input) return; input.value=button.dataset.searchTarget; input.dispatchEvent(new Event('input',{bubbles:true})); input.focus(); }));
  panel.querySelectorAll('[data-focus-equipment]').forEach(button=>button.addEventListener('click',()=>{ const id=button.dataset.focusEquipment,spot=state.modal.querySelector(`.map-hotspot.equipment[data-id="${cssEscape(id)}"]`); if (spot) { spot.focus(); spot.animate?.([{transform:'scale(1)'},{transform:'scale(1.5)'},{transform:'scale(1)'}],{duration:650}); } else { const equipment=findEntity(state.snapshot,'equipment',id),input=state.modal.querySelector('#map-search'); if (equipment&&input) { input.value=displayName(equipment,'equipment'); input.dispatchEvent(new Event('input',{bubbles:true})); input.focus(); } } }));
}

async function selectImpact(state,equipmentId) { state.impact=analyzeMapImpact(state.snapshot,equipmentId); applyImpactClasses(state.modal,state); renderCommandCenter(state); state.panel.classList.add('open'); }

function installPanel(modal,state) {
  const toggle=document.createElement('button'); toggle.type='button'; toggle.id='map-command-center-toggle'; toggle.title='Centre opérationnel de la carte'; toggle.setAttribute('aria-label','Ouvrir le centre opérationnel de la carte'); toggle.innerHTML='<i class="fas fa-layer-group"></i>';
  const panel=document.createElement('aside'); panel.id='map-command-center'; panel.setAttribute('aria-label','Centre opérationnel de la carte'); panel.innerHTML='<div class="mdt-head"><div><h2>Jumeau opérationnel</h2><p>Carte · incidents · preuves · impact documenté</p></div><button type="button" class="mdt-close" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="mdt-scroll"><div class="mdt-empty">Chargement du graphe…</div></div>';
  modal.append(toggle,panel); state.toggle=toggle; state.panel=panel; toggle.onclick=()=>panel.classList.toggle('open'); panel.querySelector('.mdt-close').onclick=()=>panel.classList.remove('open');
}

async function refreshState(state) {
  state.snapshot=await buildMapDigitalTwinSnapshot();
  try { state.graph=buildPlatformEntityGraph({rooms:state.snapshot.rooms,baies:state.snapshot.baies,equipments:state.snapshot.equipments,walls:state.snapshot.walls,screens:state.snapshot.screens,cables:state.snapshot.cables,docs:state.snapshot.docs,continuityRecords:state.snapshot.docs}); }
  catch (error) { state.graph={nodes:new Map(),edges:[],unresolved:[{type:'graph-build',message:error.message}],compatibilityIssues:[]}; }
  installSmartSearch(state.modal,state); decorateHotspots(state.modal,state); renderCommandCenter(state); ensureBreadcrumb(state.modal);
}

function installDirtyGuard(modal,state) {
  const indicator=document.createElement('div'); indicator.id='map-dirty-indicator'; indicator.innerHTML='<i class="fas fa-exclamation-circle"></i><span>Positions modifiées localement — utilisez Enregistrer.</span>'; modal.appendChild(indicator);
  const mark=event=>{ if (modal.querySelector('#edit-mode-btn.success')&&event.target.closest('.map-hotspot')) { state.dirty=true; modal.classList.add('map-digital-dirty'); } };
  modal.addEventListener('mousedown',mark,true); modal.addEventListener('pointerdown',mark,true);
  modal.querySelector('#save-all-btn')?.addEventListener('click',()=>{ state.dirty=false; modal.classList.remove('map-digital-dirty'); },true);
  modal.querySelector('#close-map')?.addEventListener('click',event=>{ if (state.dirty&&!window.confirm('Des positions ont été modifiées sans enregistrement. Fermer la carte et perdre ces changements ?')) { event.preventDefault(); event.stopImmediatePropagation(); } },true);
}

function installFallbackImageGuard(modal) {
  modal.addEventListener('error',event=>{ const image=event.target; if (!(image instanceof HTMLImageElement)||image.dataset.mapFallbackApplied==='1') return; image.dataset.mapFallbackApplied='1'; image.src='/assets/images/tech-icon.webp'; image.alt=image.alt||'Image technique indisponible'; },true);
}

async function enhanceMap(modal) {
  if (!modal||modal.dataset.mapDigitalTwin==='1') return;
  modal.dataset.mapDigitalTwin='1'; modal.classList.add('map-digital-twin-ready'); modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-label','Carte technique interactive 2M');
  const state={modal,snapshot:null,graph:null,panel:null,toggle:null,impactMode:false,impact:null,dirty:false,layers:{room:true,baie:true,equipment:true,alerts:false,quality:false},searchResults:[],searchCursor:-1}; modal.__mapDigitalTwinState=state;
  installPanel(modal,state); installDirtyGuard(modal,state); installFallbackImageGuard(modal); ensureBreadcrumb(modal); applyLayerState(state);
  const observer=new MutationObserver(()=>{ clearTimeout(state.decorateTimer); state.decorateTimer=setTimeout(()=>{ decorateHotspots(modal,state); ensureBreadcrumb(modal); installSmartSearch(modal,state); },35); });
  observer.observe(modal,{childList:true,subtree:true,attributes:true,attributeFilter:['style']}); state.observer=observer; await refreshState(state);
}

function getWelcomeSeen() { try { return sessionStorage.getItem('2m-map-welcome-seen')==='1'; } catch { return false; } }
function setWelcomeSeen() { try { sessionStorage.setItem('2m-map-welcome-seen','1'); } catch {} }

function installGlobalRuntime() {
  ensureStyleLink(); ensureContextMenuSeed();
  document.addEventListener('contextmenu',()=>requestAnimationFrame(clampContextMenu),true);
  document.addEventListener('click',event=>{ const modal=document.getElementById('map-modal'),state=modal?.__mapDigitalTwinState; if (!state?.impactMode) return; const spot=event.target.closest?.('.map-hotspot.equipment[data-id]'); if (!spot||!modal.contains(spot)) return; event.preventDefault(); event.stopImmediatePropagation(); selectImpact(state,spot.dataset.id).catch(()=>{}); },true);
  document.addEventListener('keydown',event=>{ const modal=document.getElementById('map-modal'),state=modal?.__mapDigitalTwinState; if (!state||event.ctrlKey||event.metaKey||event.altKey) return; const editing=/input|textarea|select/i.test(document.activeElement?.tagName||''); if (event.key==='/'&&!editing) { event.preventDefault(); modal.querySelector('#map-search')?.focus(); } if (event.key.toLowerCase()==='l'&&!editing) state.panel?.classList.toggle('open'); if (event.key.toLowerCase()==='i'&&!editing) { state.impactMode=!state.impactMode; renderCommandCenter(state); } });
  const observer=new MutationObserver(mutations=>{
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const welcome=node.id==='welcome-screen'?node:node.querySelector?.('#welcome-screen');
      if (welcome) { const start=welcome.querySelector('#welcome-start-btn'); if (getWelcomeSeen()) queueMicrotask(()=>start?.click()); else start?.addEventListener('click',setWelcomeSeen,{once:true,capture:true}); }
      const modal=node.id==='map-modal'?node:node.querySelector?.('#map-modal'); if (modal) queueMicrotask(()=>enhanceMap(modal).catch(error=>console.warn('Jumeau cartographique non initialisé',error)));
    }
  });
  observer.observe(document.body,{childList:true,subtree:true}); const existing=document.getElementById('map-modal'); if (existing) enhanceMap(existing).catch(()=>{});
}

if (typeof window!=='undefined'&&typeof document!=='undefined') {
  window.MapDigitalTwin=Object.freeze({version:MAP_DIGITAL_TWIN_VERSION,phase:MAP_DIGITAL_TWIN_PHASE,snapshot:buildMapDigitalTwinSnapshot,quality:mapQualitySummary,search:smartMapSearch,impact:analyzeMapImpact,refresh:async()=>{ const state=document.getElementById('map-modal')?.__mapDigitalTwinState; return state?refreshState(state):null; }});
  if (document.body) installGlobalRuntime(); else window.addEventListener('DOMContentLoaded',installGlobalRuntime,{once:true});
}
