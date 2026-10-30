export const MAP_DIGITAL_TWIN_PHASE = 18;

const ACTIVE_TICKET_STATUSES = new Set(['en cours','attente','pret fermeture','open','pending','in progress']);
const TYPE_LABELS = Object.freeze({room:'Salle',baie:'Baie',equipment:'Équipement'});
const asArray = value => Array.isArray(value) ? value : [];
const same = (left,right) => left != null && right != null && String(left) === String(right);
const clean = value => String(value ?? '').trim();
const fold = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const finite = value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
const pair = (record,a,b) => finite(record?.[a]) && finite(record?.[b]);
const hasShape = value => value && typeof value === 'object'
  && (('type' in value) || ('points' in value) || ('center' in value) || (finite(value.x) && finite(value.y)));

/*
 * Une baie ou un équipement peut désormais être positionné par une FORME dessinée sur la
 * photo de sa salle ou de sa baie (`shapeInRoom`/`shapeInBaie`, voir
 * nested-shape-contract.js), pas seulement par un point. Ce contrat ne réimporte pas
 * nested-shape-contract.js pour rester sans dépendance circulaire avec
 * map-shape-contract.js ; `hasShape` n'a besoin que de reconnaître une valeur non vide, la
 * validation fine restant au contrat qui écrit ces champs.
 */
export function mapEntityPositionState(type,record={}) {
  const rect=record.rect;
  const rectValid=rect && finite(rect.x) && finite(rect.y) && finite(rect.w) && finite(rect.h) && Number(rect.w)>0 && Number(rect.h)>0;
  if (type === 'room') return rectValid || pair(record,'x_inMap','y_inMap');
  if (type === 'baie') return rectValid || hasShape(record.shapeInRoom) || pair(record,'x_inRoom','y_inRoom') || pair(record,'x_inMap','y_inMap');
  if (type === 'equipment') return hasShape(record.shapeInBaie) || hasShape(record.shapeInRoom) || pair(record,'x_inBaie','y_inBaie') || pair(record,'x_inRoom','y_inRoom') || pair(record,'x_inMap','y_inMap');
  return false;
}

export function normalizedOperationalState(record={}) {
  const value=fold(record.status ?? record.statut ?? record.operationalStatus ?? record.state);
  if (!value) return 'neutral';
  if (['faulty','panne','en panne','hs','down','critical','critique','hors service','defectueux','defective','failed'].some(token => value === token || value.includes(token))) return 'fault';
  if (['a verifier','warning','degraded','degrade','maintenance','unknown','inconnu','pending','needs evidence','needs more evidence'].some(token => value === token || value.includes(token))) return 'warning';
  if (['operational','operationnel','active','actif','ok','healthy','normal','service'].some(token => value === token || value.includes(token))) return 'ok';
  return 'neutral';
}

export function mapRequiresFieldAttention(record={}) {
  const verification=fold(record.verificationStatus ?? record.evidenceStatus);
  return record.requiresFieldConfirmation === true || record.exactModelConfirmed === false || ['function only','label only','family only','pending','a verifier','to confirm','needs more evidence'].some(token => verification.includes(token));
}

export function mapActiveTickets(snapshot={}) {
  return asArray(snapshot.tickets).filter(ticket => ACTIVE_TICKET_STATUSES.has(fold(ticket.status)) || (!ticket.status && ticket.closed !== true));
}

export function mapTicketIndex(snapshot={}) {
  const index=new Map();
  for (const ticket of mapActiveTickets(snapshot)) {
    const type=clean(ticket.relatedType || ticket.type);
    const id=ticket.relatedId ?? ticket.targetId;
    if (!type || id == null) continue;
    const key=`${type}:${id}`;
    if (!index.has(key)) index.set(key,[]);
    index.get(key).push(ticket);
  }
  return index;
}

export function mapRoomOf(snapshot,entity,type) {
  if (!entity) return null;
  if (type === 'room') return entity;
  if (type === 'baie') return asArray(snapshot.rooms).find(room => same(room.id,entity.roomId)) || null;
  if (type === 'equipment') {
    if (entity.roomId != null) return asArray(snapshot.rooms).find(room => same(room.id,entity.roomId)) || null;
    if (entity.baieId != null) {
      const baie=asArray(snapshot.baies).find(item => same(item.id,entity.baieId));
      return baie ? asArray(snapshot.rooms).find(room => same(room.id,baie.roomId)) || null : null;
    }
  }
  return null;
}

export function mapBaieOf(snapshot,equipment) {
  return equipment?.baieId != null ? asArray(snapshot.baies).find(baie => same(baie.id,equipment.baieId)) || null : null;
}

export function mapDisplayName(record,type) {
  return clean(record?.name || record?.nom || record?.reference || record?.numSerie) || `${TYPE_LABELS[type] || type} ${record?.id ?? ''}`.trim();
}

export function mapQualityWarningFor(type,record) {
  return !mapEntityPositionState(type,record) || (type === 'equipment' && mapRequiresFieldAttention(record));
}

export function mapQualitySummary(snapshot={}) {
  const collections=[['room',asArray(snapshot.rooms)],['baie',asArray(snapshot.baies)],['equipment',asArray(snapshot.equipments)]];
  let total=0,positioned=0,needsEvidence=0,faults=0;
  const missing=[];
  for (const [type,records] of collections) for (const record of records) {
    total += 1;
    if (mapEntityPositionState(type,record)) positioned += 1;
    else missing.push({type,id:record.id,name:mapDisplayName(record,type),record});
    if (type === 'equipment' && mapRequiresFieldAttention(record)) needsEvidence += 1;
    if (type === 'equipment' && normalizedOperationalState(record) === 'fault') faults += 1;
  }
  return {total,positioned,missing,needsEvidence,faults,tickets:mapActiveTickets(snapshot).length,coverage:total ? Math.round(positioned/total*100) : 100};
}

export function mapSearchDocuments(snapshot={}) {
  const tickets=mapTicketIndex(snapshot);
  const documents=[];
  for (const room of asArray(snapshot.rooms)) documents.push({type:'room',id:room.id,name:mapDisplayName(room,'room'),record:room,detail:clean(room.code || room.description),room:null,baie:null});
  for (const baie of asArray(snapshot.baies)) {
    const room=mapRoomOf(snapshot,baie,'baie');
    documents.push({type:'baie',id:baie.id,name:mapDisplayName(baie,'baie'),record:baie,detail:[room && mapDisplayName(room,'room'),baie.reference].filter(Boolean).join(' · '),room,baie:null});
  }
  for (const equipment of asArray(snapshot.equipments)) {
    const room=mapRoomOf(snapshot,equipment,'equipment');
    const baie=mapBaieOf(snapshot,equipment);
    documents.push({type:'equipment',id:equipment.id,name:mapDisplayName(equipment,'equipment'),record:equipment,room,baie,detail:[equipment.marque,equipment.modele,equipment.reference,baie && mapDisplayName(baie,'baie'),room && mapDisplayName(room,'room')].filter(Boolean).join(' · ')});
  }
  return documents.map(document => ({...document,tickets:tickets.get(`${document.type}:${document.id}`) || []}));
}

export function smartMapSearch(snapshot,query,{limit=18}={}) {
  const q=fold(query);
  if (q.length < 2) return [];
  const tokens=q.split(' ').filter(Boolean);
  const ranked=[];
  for (const document of mapSearchDocuments(snapshot)) {
    const name=fold(document.name);
    const detail=fold(document.detail);
    const id=fold(document.id);
    let score=0;
    if (name===q) score+=120;
    if (id===q) score+=110;
    if (name.startsWith(q)) score+=80;
    if (name.includes(q)) score+=55;
    if (detail.includes(q)) score+=30;
    if (id.includes(q)) score+=26;
    for (const token of tokens) {
      if (name.startsWith(token)) score+=16;
      else if (name.includes(token)) score+=11;
      else if (detail.includes(token)) score+=6;
    }
    if (!score) continue;
    if (document.tickets.length) score+=4;
    if (normalizedOperationalState(document.record)==='fault') score+=3;
    ranked.push({...document,score});
  }
  return ranked.sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name,'fr')).slice(0,limit);
}
