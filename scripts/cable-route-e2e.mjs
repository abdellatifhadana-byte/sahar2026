/**
 * @file scripts/cable-route-e2e.mjs — LE TRACÉ NE CONTOURNE PAS L'AUTORISATION DES SCÈNES.
 *
 * Épreuve de bout en bout, contre le serveur réel et PostgreSQL réel.
 *
 * POURQUOI CE SCÉNARIO PRÉCISÉMENT.
 *
 * Les deux EXTRÉMITÉS sont dans STC : la garde de zone existante laisse donc passer
 * l'écriture. Mais le CHEMINEMENT traverse RF1 — un chemin de câbles qui passe par la
 * régie. C'est le seul cas où la garde de tracé est la DERNIÈRE défense : avec un câble
 * inter-zones, la garde d'extrémités refuse déjà tout et masque le défaut.
 *
 * Sans cette garde, le pilote de STC efface le segment RF1 en enregistrant une simple
 * correction de référence — une sauvegarde honnête détruit la donnée protégée.
 */
const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
async function req(path,{method='GET',cookie='',body}={}){const r=await fetch(`${base}${path}`,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let p={};try{p=t?JSON.parse(t):{};}catch{p={text:t};}return{status:r.status,payload:p,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
const login=async(u,pw)=>{const r=await req('/api/auth/login',{method:'POST',body:{username:u,password:pw}});return{user:r.payload.user,cookie:r.cookie};};
const cablesDe = async C => (await req('/api/sync', C)).payload.data?.cables || [];
const lire = async (C,id) => (await cablesDe(C)).find(c=>c.id===id);
let echecs=0;
const verifie=(t,a,o)=>{const ok=JSON.stringify(a)===JSON.stringify(o);if(!ok)echecs++;console.log(`  ${ok?'✓':'✗ ÉCHEC'} ${t}`);if(!ok)console.log(`        attendu : ${JSON.stringify(a)}\n        obtenu  : ${JSON.stringify(o)}`);};

const admin = await login(adminUsername, adminPassword);
const A={cookie:admin.cookie};
// Mise en place complète : le scénario doit être rejouable sur une base neuve.
await req('/api/access/zones',{method:'POST',...A,body:{id:'trace-stc',name:'STC',publicSummary:'Salle technique centrale'}});
await req('/api/access/zones',{method:'POST',...A,body:{id:'trace-rf1',name:'Régie Finale RF1',publicSummary:'Régie finale'}});
await req('/api/data/rooms/901',{method:'PUT',...A,body:{id:901,name:'STC — épreuve tracé'}});
await req('/api/data/rooms/902',{method:'PUT',...A,body:{id:902,name:'RF1 — épreuve tracé'}});
await req('/api/access/resource-zones',{method:'POST',...A,body:{resourceType:'room',resourceId:901,zoneId:'trace-stc'}});
await req('/api/access/resource-zones',{method:'POST',...A,body:{resourceType:'room',resourceId:902,zoneId:'trace-rf1'}});
await req('/api/data/equipments/910',{method:'PUT',...A,body:{id:910,name:'Ultrix — épreuve tracé',roomId:901,ports:[{id:'OUT1',number:'OUT1',direction:'OUT',type:'BNC / SDI'}]}});
// Second équipement DANS STC : les deux bouts du câble restent dans la même zone.
await req('/api/data/equipments/912',{method:'PUT',...A,body:{id:912,name:'Moniteur — épreuve tracé',roomId:901,ports:[{id:'IN9',number:'IN9',direction:'IN',type:'BNC / SDI'}]}});

const SEG_STC = { sceneType:'room', sceneId:901, naturalWidth:2000, naturalHeight:1000, waypoints:[{x:10,y:10},{x:400,y:300}], anchors:[] };
const SEG_RF1 = { sceneType:'room', sceneId:902, naturalWidth:1800, naturalHeight:900,  waypoints:[{x:50,y:60},{x:777,y:222}], anchors:[] };
const TRACE = { version:1, status:'verified', segments:[SEG_STC, SEG_RF1] };
const base_cable = { id:'CAB-TRACE-E2E', category:'Vidéo', type:'SDI', status:'Connecté',
  sourceType:'equipment', sourceId:910, sourcePortId:'OUT1',
  destinationType:'equipment', destinationId:912, destinationPortId:'IN9' };

console.log('\n── 1 · câble INTRA-zone (STC→STC) dont le tracé passe par RF1 ──');
/*
 * REJOUABLE : la CI enchaîne les épreuves et un développeur relance celle-ci à la main. Un
 * câble laissé par une exécution précédente ne doit pas faire échouer la suivante — on
 * repose alors le tracé de référence sur la révision courante.
 */
const dejaLa = await lire(A,'CAB-TRACE-E2E');
const pose = dejaLa
  ? await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,body:{...dejaLa, ...base_cable, route:TRACE}})
  : await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,body:{...base_cable, route:TRACE}});
verifie('le câble et son tracé sont en place', 200, pose.status);
const vuAdmin = await lire(A,'CAB-TRACE-E2E');
verifie('admin voit les deux segments', 2, vuAdmin?.route?.segments?.length);

console.log('\n── 2 · le pilote de STC reçoit un tracé amputé ──');
const MDP='Trace-Perimetre-Verrou-2026!';
await req('/api/data/users/91',{method:'PUT',...A,body:{id:91,username:'pilote.trace',fullName:'Pilote Tracé',role:'chef',status:'active',password:Buffer.from(MDP,'utf8').toString('base64')}});
await req('/api/access/memberships',{method:'POST',...A,body:{userId:91,zoneId:'trace-stc'}});
for (const p of ['zone.summary.read','equipment.read','equipment.edit','cable.read','cable.edit']) {
  await req('/api/access/grants',{method:'POST',...A,body:{userId:91,zoneId:'trace-stc',permission:p}});
}
const pilote = await login('pilote.trace',MDP);
const P={cookie:pilote.cookie};
const vuPilote = await lire(P,'CAB-TRACE-E2E');
verifie('il reçoit UN segment', 1, vuPilote?.route?.segments?.length);
verifie('déclaré partiel', true, vuPilote?.route?.partial);
const fuite = JSON.stringify(vuPilote.route);
for (const secret of ['777','222','1800','900']) verifie(`rien de RF1 ne fuit (« ${secret} »)`, false, fuite.includes(secret));

console.log('\n── 3 · LA QUESTION DÉCISIVE — sa sauvegarde honnête efface-t-elle RF1 ? ──');
const renvoi = { ...vuPilote, reference:'CAB-TRACE-E2E-corrigée' };
const r3 = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...P,body:renvoi});
console.log(`     PUT renvoyant la vue partielle : ${r3.status} ${r3.status>=400?r3.payload.error:'ACCEPTÉ'}`);
verifie('l\'écriture légitime aboutit', 200, r3.status);
const apres = await lire(A,'CAB-TRACE-E2E');
verifie('la référence a bien été corrigée', 'CAB-TRACE-E2E-corrigée', apres?.reference);
verifie('le tracé COMPLET a survécu', 2, apres?.route?.segments?.length);
verifie('le segment RF1 est intact', 777, apres?.route?.segments?.find(s=>String(s.sceneId)==='902')?.waypoints?.[1]?.x);

console.log('\n── 4 · s\'il MODIFIE le tracé qu\'il n\'a pas vu en entier ──');
const apresVu = await lire(P,'CAB-TRACE-E2E');
const modifie = { ...apresVu, route:{ version:1, status:'verified',
  segments:[{ ...apresVu.route.segments[0], waypoints:[{x:1,y:1},{x:2,y:2}] }] } };
const r4 = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...P,body:modifie});
verifie('refus nommé', 'ROUTE_SCOPE_INSUFFICIENT', r4.payload.error);
verifie('statut 403', 403, r4.status);
verifie('tracé complet intact', 2, (await lire(A,'CAB-TRACE-E2E'))?.route?.segments?.length);

console.log('\n── 5 · écrire de la géométrie DANS une scène interdite ──');
const intrus = { ...apresVu, route:{ version:1, status:'verified', segments:[
  { sceneType:'room', sceneId:902, naturalWidth:1800, naturalHeight:900, waypoints:[{x:1,y:1},{x:2,y:2}], anchors:[] }]}};
const r5 = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...P,body:intrus});
/*
 * Ici DEUX faits sont vrais : il n'a jamais vu le tracé en entier, et il n'a aucune
 * autorité d'écriture sur RF1. Le premier est le refus le plus fondamental — on ne
 * remplace pas ce qu'on n'a pas vu — et c'est lui qui se prononce. L'étape 8 éprouve
 * l'autre cas, où le tracé est entièrement LU mais pas entièrement modifiable.
 */
verifie('refus nommé', 'ROUTE_SCOPE_INSUFFICIENT', r5.payload.error);
verifie('statut 403', 403, r5.status);
verifie('tracé complet intact', 2, (await lire(A,'CAB-TRACE-E2E'))?.route?.segments?.length);

console.log('\n── 6 · l\'admin voit tout : il peut remplacer ──');
const courant = await lire(A,'CAB-TRACE-E2E');
const r6 = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,body:{...courant, route:{...TRACE, status:'proposed'}}});
verifie('remplacement accepté', 200, r6.status);
verifie('statut du tracé mis à jour', 'proposed', (await lire(A,'CAB-TRACE-E2E'))?.route?.status);

console.log('\n── 7 · supprimer le TRACÉ n\'est pas supprimer le CÂBLE ──');
const avant = await lire(A,'CAB-TRACE-E2E');
const r7 = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,body:{...avant, route:null}});
verifie('suppression du tracé acceptée', 200, r7.status);
const sansTrace = await lire(A,'CAB-TRACE-E2E');
verifie('le tracé a disparu', null, sansTrace?.route ?? null);
verifie('le câble existe toujours', 'CAB-TRACE-E2E', sansTrace?.id);
for (const [champ, attendu] of [['sourceId',910],['sourcePortId','OUT1'],['destinationId',912],['destinationPortId','IN9'],['type','SDI'],['category','Vidéo']]) {
  verifie(`« ${champ} » préservé`, attendu, sansTrace?.[champ]);
}

console.log('\n── 8 · LECTURE > ÉDITION : voir une scène n\'est pas pouvoir la modifier ──');
/*
 * Le pilote reçoit RF1 en LECTURE (zone.summary.read, equipment.read, cable.read) mais n'y
 * détient AUCUN cable.edit. Le tracé lui arrive donc COMPLET — `partial` absent — et c'est
 * précisément ce qui rendait la faille invisible : rien dans la donnée ne signalait qu'une
 * scène échappait à son autorité d'écriture.
 */
/*
 * UN UTILISATEUR DÉDIÉ, et non celui de l'étape 2 : lui accorder RF1 en lecture élargirait
 * son périmètre et ferait échouer l'étape 2 à la RELANCE suivante — le tracé ne lui
 * arriverait plus amputé. Une épreuve qui ne se rejoue pas ne prouve rien la seconde fois.
 */
const MDP_LECTURE = 'Lecture-Large-Verrou-2026!';
await req('/api/data/users/92',{method:'PUT',...A,body:{id:92,username:'pilote.lecture',fullName:'Pilote Lecture',role:'chef',status:'active',password:Buffer.from(MDP_LECTURE,'utf8').toString('base64')}});
await req('/api/access/memberships',{method:'POST',...A,body:{userId:92,zoneId:'trace-stc'}});
await req('/api/access/memberships',{method:'POST',...A,body:{userId:92,zoneId:'trace-rf1'}});
for (const p of ['zone.summary.read','equipment.read','equipment.edit','cable.read','cable.edit']) {
  await req('/api/access/grants',{method:'POST',...A,body:{userId:92,zoneId:'trace-stc',permission:p}});
}
for (const p of ['zone.summary.read','equipment.read','cable.read']) {
  await req('/api/access/grants',{method:'POST',...A,body:{userId:92,zoneId:'trace-rf1',permission:p}});
}
const relu = await login('pilote.lecture', MDP_LECTURE);
const L = { cookie: relu.cookie };
// On repose un tracé complet à deux segments pour la mesure.
const socle = await lire(A,'CAB-TRACE-E2E');
await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,body:{...socle, route:{version:1,status:'verified',segments:[SEG_STC,SEG_RF1]}}});

const vuComplet = await lire(L,'CAB-TRACE-E2E');
verifie('il lit le tracé ENTIER', 2, vuComplet?.route?.segments?.length);
verifie('rien ne le marque partiel', undefined, vuComplet?.route?.partial);

const bouger = { ...vuComplet, route:{ version:1, status:'verified',
  segments:[SEG_STC, { ...SEG_RF1, waypoints:[{x:1,y:1},{x:2,y:2}] }] } };
const r8 = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...L,body:bouger});
verifie('modifier un point dans RF1 est refusé', 'ROUTE_SCENE_EDIT_FORBIDDEN', r8.payload.error);
verifie('statut 403', 403, r8.status);

const frais = await lire(L,'CAB-TRACE-E2E');
const r8b = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...L,body:{...frais, route:{version:1,status:'verified',segments:[SEG_STC]}}});
verifie('retirer le segment RF1 est refusé', 'ROUTE_SCENE_EDIT_FORBIDDEN', r8b.payload.error);

const frais2 = await lire(L,'CAB-TRACE-E2E');
const r8c = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...L,body:{...frais2, route:null}});
verifie('supprimer le tracé entier est refusé', 'ROUTE_SCENE_EDIT_FORBIDDEN', r8c.payload.error);

const apres8 = await lire(A,'CAB-TRACE-E2E');
verifie('le tracé stocké est resté intact', 2, apres8?.route?.segments?.length);
verifie('le point de RF1 n\'a pas bougé', 777, apres8?.route?.segments?.find(s=>String(s.sceneId)==='902')?.waypoints?.[1]?.x);

console.log('\n── 9 · mais un champ HORS TRACÉ reste modifiable ──');
/*
 * Sans quoi la protection deviendrait un blocage : un câble dont le cheminement sort du
 * périmètre d'édition serait devenu totalement inéditable.
 */
const frais3 = await lire(L,'CAB-TRACE-E2E');
const r9 = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...L,body:{...frais3, reference:'CAB-TRACE-E2E-notée'}});
verifie('la correction de référence aboutit', 200, r9.status);
const apres9 = await lire(A,'CAB-TRACE-E2E');
verifie('la référence est bien changée', 'CAB-TRACE-E2E-notée', apres9?.reference);
verifie('le tracé est resté EXACTEMENT le même', 2, apres9?.route?.segments?.length);
verifie('y compris le point de RF1', 777, apres9?.route?.segments?.find(s=>String(s.sceneId)==='902')?.waypoints?.[1]?.x);

console.log('\n── 10 · avec cable.edit sur RF1, la même modification passe ──');
/*
 * UN TROISIÈME UTILISATEUR, habilité des deux côtés dès le départ. Accorder `cable.edit`
 * à celui de l'étape 8 modifierait un périmètre que la relance suivante croit connaître —
 * et il n'existe aucun `GET /api/access/grants` pour vérifier qu'une révocation a bien eu
 * lieu. On ne mute pas ce qu'on ne peut pas relire.
 */
const MDP_PLEIN = 'Deux-Zones-Verrou-2026!';
await req('/api/data/users/93',{method:'PUT',...A,body:{id:93,username:'pilote.plein',fullName:'Pilote Deux Zones',role:'chef',status:'active',password:Buffer.from(MDP_PLEIN,'utf8').toString('base64')}});
for (const zone of ['trace-stc','trace-rf1']) {
  await req('/api/access/memberships',{method:'POST',...A,body:{userId:93,zoneId:zone}});
  for (const p of ['zone.summary.read','equipment.read','equipment.edit','cable.read','cable.edit']) {
    await req('/api/access/grants',{method:'POST',...A,body:{userId:93,zoneId:zone,permission:p}});
  }
}
const habilite = await login('pilote.plein', MDP_PLEIN);
const H = { cookie: habilite.cookie };
const frais4 = await lire(H,'CAB-TRACE-E2E');
const r10 = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...H,body:{...frais4,
  route:{ version:1, status:'verified', segments:[SEG_STC, { ...SEG_RF1, waypoints:[{x:1,y:1},{x:2,y:2}] }] } }});
verifie('la modification est acceptée', 200, r10.status);
verifie('le point de RF1 a bien bougé', 2, (await lire(A,'CAB-TRACE-E2E'))?.route?.segments?.find(s=>String(s.sceneId)==='902')?.waypoints?.[1]?.x);

console.log('\n── 11 · une scène FANTÔME est refusée, y compris aux rôles globaux ──');
/*
 * « Voir toutes les zones » veut dire franchir les habilitations sur une ressource RÉELLE.
 * Cela ne peut pas vouloir dire inventer une ressource. Un tracé pointant vers une salle
 * absente est une géométrie que le jumeau numérique ne pourra jamais ouvrir — et c'est le
 * rôle censé garantir la cohérence qui l'écrirait.
 */
const MDP_GESTION = 'Gestion-Globale-Verrou-2026!';
await req('/api/data/users/94',{method:'PUT',...A,body:{id:94,username:'gestionnaire.trace',fullName:'Gestionnaire',role:'manager',status:'active',password:Buffer.from(MDP_GESTION,'utf8').toString('base64')}});
const gestion = await login('gestionnaire.trace', MDP_GESTION);
const G = { cookie: gestion.cookie };
verifie('le compte est bien un gestionnaire', 'manager', gestion.user?.role);

const fantome = (type, id) => ({ sceneType:type, sceneId:id, naturalWidth:1000, naturalHeight:500,
  waypoints:[{x:10,y:10},{x:20,y:20}], anchors:[] });

for (const [qui, cookie] of [['administrateur', A.cookie], ['gestionnaire', G.cookie]]) {
  for (const [quoi, scene] of [['salle', fantome('room','ROOM-NOT-FOUND')], ['baie', fantome('baie','BAIE-NOT-FOUND')]]) {
    const frais = await lire(A,'CAB-TRACE-E2E');
    const r = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',cookie,
      body:{ ...frais, route:{ version:1, status:'verified', segments:[SEG_STC, scene] } }});
    verifie(`${qui} → ${quoi} inexistante : refusé`, 'ROUTE_SCENE_INVALID', r.payload.error);
  }
}
const apres11 = await lire(A,'CAB-TRACE-E2E');
verifie('aucune scène fantôme n\'a été persistée', 2, apres11?.route?.segments?.length);
verifie('les deux scènes stockées sont réelles', [901, 902],
  apres11?.route?.segments?.map(s => s.sceneId).sort((a,b)=>a-b));

console.log('\n── 12 · la CAPACITÉ d\'édition est servie par le serveur ──');
/*
 * Le navigateur ne peut pas l'établir seul : `/api/access/context` ne porte aucune
 * cartographie enregistrement → zones. C'est donc le serveur qui répond, avec la même
 * sémantique que sa garde — et la réponse ne dit QUE oui ou non.
 */
const capaciteDe = async (C, id) => (await lire(C, id))?.routeAccess;

const capAdmin = await capaciteDe(A,'CAB-TRACE-E2E');
verifie('l\'administrateur reçoit la capacité', true, Boolean(capAdmin));
verifie('elle ne porte QUE readable et editable', ['editable','readable'], Object.keys(capAdmin || {}).sort());
verifie('administrateur : lisible', true, capAdmin?.readable);
verifie('administrateur : modifiable', true, capAdmin?.editable);

// Le lecteur large (RF1 en lecture seule) : il VOIT tout le tracé mais ne peut pas l'écrire.
const capLecture = await capaciteDe(L,'CAB-TRACE-E2E');
verifie('lecteur RF1 : lisible', true, capLecture?.readable);
verifie('lecteur RF1 : NON modifiable', false, capLecture?.editable);

// Celui dont le tracé arrive amputé : il ne peut pas remplacer ce qu'il n'a pas vu.
const capPartiel = await capaciteDe(P,'CAB-TRACE-E2E');
verifie('périmètre STC : lisible', true, capPartiel?.readable);
verifie('périmètre STC : NON modifiable', false, capPartiel?.editable);

// Et celui qui détient les deux zones.
const capPlein = await capaciteDe(H,'CAB-TRACE-E2E');
verifie('deux zones : modifiable', true, capPlein?.editable);

console.log('\n── 13 · la capacité CONCORDE avec ce que le serveur accepte vraiment ──');
for (const [qui, C] of [['administrateur', A], ['lecteur RF1', L], ['périmètre STC', P], ['deux zones', H]]) {
  const vu = await lire(C,'CAB-TRACE-E2E');
  const annonce = vu?.routeAccess?.editable;
  const essai = { ...vu, route:{ version:1, status:'verified',
    segments:[SEG_STC, { ...SEG_RF1, waypoints:[{x:3,y:3},{x:4,y:4}] }] } };
  const r = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...C,body:essai});
  const accepte = r.status < 400;
  verifie(`${qui} : la capacité annonce ce que le serveur fait`, annonce, accepte);
  if (accepte) { // on repose le tracé de référence pour la mesure suivante
    const c = await lire(A,'CAB-TRACE-E2E');
    await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,body:{...c, route:{version:1,status:'verified',segments:[SEG_STC,SEG_RF1]}}});
  }
}

console.log('\n── 14 · la capacité ne s\'enregistre JAMAIS ──');
const avecCapacite = await lire(A,'CAB-TRACE-E2E');
verifie('elle est bien présente à la lecture', true, Boolean(avecCapacite.routeAccess));
// Le client la renvoie telle quelle, comme le ferait n'importe quel écran honnête.
const renvoyee = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,
  body:{ ...avecCapacite, routeAccess:{ readable:true, editable:true }, reference:'CAB-TRACE-E2E-cap' }});
verifie('l\'écriture aboutit', 200, renvoyee.status);
const stocke = (await req('/api/sync', A)).payload.data?.cables?.find(c=>c.id==='CAB-TRACE-E2E');
verifie('la référence a changé', 'CAB-TRACE-E2E-cap', stocke?.reference);
// Elle est là, mais RECALCULÉE — pas celle que le client a renvoyée.
verifie('la capacité servie reste calculée par le serveur', true, Boolean(stocke?.routeAccess));
const brut = (await req('/api/data/cables/CAB-TRACE-E2E', A));
verifie('aucune capacité n\'a été persistée dans l\'enregistrement', undefined,
  (await lire(H,'CAB-TRACE-E2E'))?.routeAccess?.persisted);

console.log('\n── 15 · CLÔTURE : une scène RÉELLE dont l\'appartenance ne se résout pas ──');
/*
 * CE QUE CETTE SECTION MESURAIT, ET CE QU'ELLE FERME MAINTENANT.
 *
 * Elle constatait un RÉSIDU : « un rôle global peut écrire dans une scène au périmètre non
 * résolu ». Deux choses s'y révèlent fausses ou incomplètes à la remesure.
 *
 * 1. LA SALLE 903 N'ÉTAIT PAS LE BON TÉMOIN. Une salle créée par l'API emporte son
 *    rattachement : le serveur frappe une zone de transition `room-<id>` et l'attache avant
 *    de répondre 200. MESURÉ : la salle 903 résout `["room-903"]`, le détachement est
 *    refusé (`ZONE_NOT_FOUND`), et un import `roomZones: []` en reforge une. Une salle a
 *    donc TOUJOURS une appartenance résolvable, et l'accepter pour un rôle global n'est pas
 *    un résidu : c'est la dérogation de zone ordinaire sur une ressource dont on sait à qui
 *    elle appartient. La ligne « résidu signalé » décrivait un état que ce chemin ne produit
 *    pas — et c'est elle qui a fait classer le défaut au mauvais endroit.
 *
 * 2. LA BAIE, ELLE, LE PRODUIT VRAIMENT. Une baie ne porte pas de rattachement propre :
 *    elle se résout PAR SA SALLE. Une baie dont la salle n'existe pas — ou qui n'en déclare
 *    aucune — existe bel et bien et résout `[]`. MESURÉ sur `fe16425`, avant correction :
 *
 *      admin   → baie à salle inexistante : 200 ACCEPTÉ, géométrie persistée
 *      manager → baie à salle inexistante : 200 ACCEPTÉ, géométrie persistée
 *      admin   → baie sans aucune salle   : 200 ACCEPTÉ, géométrie persistée
 *      manager → baie sans aucune salle   : 200 ACCEPTÉ, géométrie persistée
 *      rôle à périmètre                   : 403, déjà fermé
 *      capacité servie `creatableHere`    : true pour admin ET manager
 *
 *    La cause était l'ORDRE dans `routeSceneWritable` : la dérogation globale répondait
 *    `true` avant que `!zoneIds.length` ne soit lu, si bien que seuls les rôles à périmètre
 *    atteignaient ce garde-fou. « Voir toutes les zones » franchit les HABILITATIONS d'une
 *    ressource dont l'appartenance est connue ; cela ne peut pas franchir l'absence
 *    d'appartenance, sans quoi plus personne ne peut dire de quel périmètre relève la
 *    géométrie écrite, ni la protéger, ni la relire avec la même règle.
 *
 * Cette section n'observe donc plus : elle EXIGE.
 */
await req('/api/data/rooms/903',{method:'PUT',...A,body:{id:903,name:'Salle sans zone — épreuve'}});

/* Le fait qui disqualifie la salle comme témoin — mesuré, pas supposé. */
const rattachements903 = ((await req('/api/access/manage', A)).payload?.resourceZones || [])
  .filter(lien => String(lien.resourceType || '').toLowerCase().startsWith('room') && String(lien.resourceId) === '903')
  .map(lien => String(lien.zoneId));
verifie('une salle créée emporte TOUJOURS une appartenance résolvable', 1, rattachements903.length);
verifie('le détachement d\'une salle est refusé', true,
  (await req('/api/access/resource-zones',{method:'POST',...A,body:{resourceType:'room',resourceId:903,zoneId:null}})).status >= 400);

/* LES DEUX BAIES QUI PRODUISENT VRAIMENT L'ÉTAT : aucune appartenance résolvable. */
const baiesExistantes = (await req('/api/sync', A)).payload.data?.baies || [];
const poserBaie = async (id, corps) => {
  const existante = baiesExistantes.find(item => String(item.id) === id);
  return req(`/api/data/baies/${id}`, { method: 'PUT', ...A, body: { ...(existante || {}), id, ...corps } });
};
verifie('une baie dont la salle n\'existe pas peut être créée', 200,
  (await poserBaie('BAIE-ORPHELINE-E2E', { name: 'Baie sans salle — épreuve', roomId: 'SALLE-QUI-NEXISTE-PAS' })).status);
verifie('une baie sans aucune salle peut être créée', 200,
  (await poserBaie('BAIE-APATRIDE-E2E', { name: 'Baie apatride — épreuve' })).status);
/* Témoin inverse : une baie dans une salle rattachée, qui doit RESTER inscriptible. */
await poserBaie('BAIE-RATTACHEE-E2E', { name: 'Baie rattachée — épreuve', roomId: 903 });

const segBaie = id => ({ sceneType:'baie', sceneId:id, naturalWidth:800, naturalHeight:600,
  waypoints:[{x:5,y:5},{x:50,y:50}], anchors:[] });
const remettreTrace = async () => {
  const courant = await lire(A,'CAB-TRACE-E2E');
  await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,
    body:{ ...courant, route:{ version:1, status:'verified', segments:[SEG_STC] } }});
};
/** Écrit un segment dans cette scène, puis dit ce que le serveur a fait ET ce qui reste. */
const ecrireDans = async (contexte, scene) => {
  await remettreTrace();
  const frais = await lire(contexte,'CAB-TRACE-E2E');
  const reponse = await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...contexte,
    body:{ ...frais, route:{ version:1, status:'verified', segments:[SEG_STC, scene] } }});
  const apres = await lire(A,'CAB-TRACE-E2E');
  return { status: reponse.status, code: reponse.payload.error,
    persiste: (apres?.route?.segments || []).some(s => String(s.sceneId) === String(scene.sceneId)) };
};

for (const [qui, contexte] of [['administrateur', A], ['gestionnaire', G]]) {
  for (const [nom, baie] of [['salle inexistante', 'BAIE-ORPHELINE-E2E'], ['aucune salle', 'BAIE-APATRIDE-E2E']]) {
    const resultat = await ecrireDans(contexte, segBaie(baie));
    console.log(`     ${qui} → baie (${nom}) : ${resultat.status} ${resultat.code || 'ACCEPTÉ'}`);
    verifie(`${qui} ne peut PAS écrire dans une baie (${nom})`, true, resultat.status >= 400);
    verifie(`${qui} — aucune géométrie n'est persistée (${nom})`, false, resultat.persiste);
  }
}
const refusPerimetre = await ecrireDans(H, segBaie('BAIE-APATRIDE-E2E'));
verifie('le rôle à périmètre reste fermé, comme avant', true, refusPerimetre.status >= 400);
verifie('et rien n\'est persisté pour lui non plus', false, refusPerimetre.persiste);

/* CE QUI DOIT RESTER OUVERT — la correction ne referme rien d'autre. */
const surBaieRattachee = await ecrireDans(A, segBaie('BAIE-RATTACHEE-E2E'));
verifie('une baie dont la salle EST rattachée reste inscriptible', 200, surBaieRattachee.status);
const surSalleRattachee = await ecrireDans(A, { sceneType:'room', sceneId:902, naturalWidth:1800,
  naturalHeight:900, waypoints:[{x:7,y:7},{x:70,y:70}], anchors:[] });
verifie('une salle rattachée reste inscriptible pour l\'administrateur', 200, surSalleRattachee.status);
const surPlan = await ecrireDans(A, { sceneType:'map', sceneId:null, naturalWidth:2000,
  naturalHeight:1200, waypoints:[{x:1,y:1},{x:2,y:2}], anchors:[] });
verifie('la scène PLAN se comporte exactement comme avant', 200, surPlan.status);

/* LA CAPACITÉ SERVIE DIT LA MÊME CHOSE QUE LA GARDE — sinon l'écran promettrait un refus. */
const capaciteBaie = async (contexte, id) =>
  (await req(`/api/cables/CAB-TRACE-E2E/route-access?sceneType=baie&sceneId=${id}`, contexte)).payload;
verifie('administrateur : « créable ici » est FAUX sur une baie sans appartenance', false,
  (await capaciteBaie(A, 'BAIE-APATRIDE-E2E')).creatableHere);
verifie('gestionnaire : idem', false, (await capaciteBaie(G, 'BAIE-APATRIDE-E2E')).creatableHere);
verifie('et VRAI sur une baie dont la salle est rattachée', true,
  (await capaciteBaie(A, 'BAIE-RATTACHEE-E2E')).creatableHere);

await remettreTrace();
const socle15 = await lire(A,'CAB-TRACE-E2E');
await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,
  body:{ ...socle15, route:{ version:1, status:'verified', segments:[SEG_STC, SEG_RF1] } }});

console.log('\n── 16 · la capacité PAR SCÈNE, pour le bouton « Ajouter un tracé » ──');
/*
 * `editable` sur un câble SANS tracé ne prouve rien : `routeAuthority(null)` ne rencontre
 * aucune scène, donc rien n'est masqué et tout est « inscriptible ». Mesuré avant
 * correction : un pilote habilité sur STC, la carte ouverte sur RF1, recevait
 * `editable: true` — l'écran aurait proposé de dessiner, le serveur aurait refusé le trait.
 * La scène doit donc être NOMMÉE dans la demande, jamais déduite.
 */
await req('/api/data/equipments/914',{method:'PUT',...A,body:{id:914,name:'Sans tracé A',roomId:901,ports:[{id:'OUT7',number:'OUT7',direction:'OUT',type:'BNC / SDI'}]}});
await req('/api/data/equipments/915',{method:'PUT',...A,body:{id:915,name:'Sans tracé B',roomId:901,ports:[{id:'IN7',number:'IN7',direction:'IN',type:'BNC / SDI'}]}});
const nuDejaLa = await lire(A,'CAB-SANS-TRACE');
await req('/api/data/cables/CAB-SANS-TRACE',{method:'PUT',...A,body:{...(nuDejaLa||{}),
  id:'CAB-SANS-TRACE', category:'Vidéo', type:'SDI', status:'Connecté',
  sourceType:'equipment', sourceId:914, sourcePortId:'OUT7',
  destinationType:'equipment', destinationId:915, destinationPortId:'IN7', route:null }});

const acces = async (C, id, q='') => (await req(`/api/cables/${id}/route-access${q}`, C)).payload;

const generique = await acces(L,'CAB-SANS-TRACE');
verifie('sans scène, la réponse ne contient PAS creatableHere', undefined, generique.creatableHere);
verifie('scène STC (édition) : créable', true, (await acces(L,'CAB-SANS-TRACE','?sceneType=room&sceneId=901')).creatableHere);
verifie('scène RF1 (lecture seule) : NON créable', false, (await acces(L,'CAB-SANS-TRACE','?sceneType=room&sceneId=902')).creatableHere);
verifie('salle fantôme : NON créable', false, (await acces(L,'CAB-SANS-TRACE','?sceneType=room&sceneId=ROOM-NOT-FOUND')).creatableHere);

for (const [nom, sceneId] of [['STC',901],['RF1',902]]) {
  const cap = await acces(L,'CAB-SANS-TRACE',`?sceneType=room&sceneId=${sceneId}`);
  const frais = await lire(L,'CAB-SANS-TRACE');
  const seg = { sceneType:'room', sceneId, naturalWidth:1800, naturalHeight:900,
    waypoints:[{x:11,y:11},{x:22,y:22}], anchors:[] };
  const r = await req('/api/data/cables/CAB-SANS-TRACE',{method:'PUT',...L,
    body:{ ...frais, route:{ version:1, status:'verified', segments:[seg] } }});
  verifie(`${nom} : creatableHere annonce ce que le serveur fait`, cap.creatableHere, r.status < 400);
  if (r.status < 400) { const c = await lire(A,'CAB-SANS-TRACE'); await req('/api/data/cables/CAB-SANS-TRACE',{method:'PUT',...A,body:{...c, route:null}}); }
}

verifie('un câble hors périmètre ne révèle pas son existence', 404,
  (await req('/api/cables/CAB-INEXISTANT/route-access', L)).status);
verifie('une scène inconnue est refusée', 'ROUTE_SCENE_INVALID',
  (await req('/api/cables/CAB-SANS-TRACE/route-access?sceneType=satellite', L)).payload.error);

console.log('\n── 17 · une habilitation RÉVOQUÉE ferme le bouton tout de suite ──');
/*
 * La copie synchronisée peut être vieille de plusieurs secondes. C'est pourquoi l'écran
 * interroge cette route au moment d'OUVRIR l'éditeur, et non son cache : une habilitation
 * retirée doit fermer le geste immédiatement, pas au prochain instantané.
 */
const AVANT = await acces(H,'CAB-TRACE-E2E','?sceneType=room&sceneId=902');
verifie('avant révocation : créable dans RF1', true, AVANT.creatableHere);
verifie('avant révocation : tracé modifiable', true, AVANT.editable);
// L'identifiant d'habilitation est construit par le serveur : ZG-<user>-<zone>-<permission>.
await req(`/api/access/grants/${encodeURIComponent('ZG-93-trace-rf1-cable.edit')}`, { method:'DELETE', ...A });
const APRES = await acces(H,'CAB-TRACE-E2E','?sceneType=room&sceneId=902');
verifie('après révocation : NON créable dans RF1', false, APRES.creatableHere);
verifie('après révocation : tracé NON modifiable', false, APRES.editable);
verifie('la lecture, elle, reste ouverte', true, APRES.readable);
// On la remet, pour que l'épreuve reste rejouable.
await req('/api/access/grants',{method:'POST',...A,body:{userId:93,zoneId:'trace-rf1',permission:'cable.edit'}});

console.log('\n── 18 · RÉVOCATION PARTIELLE : la géométrie servie suit la permission ──');
/*
 * LE CAS DISCRIMINANT. Après une révocation qui ne retire QU'UNE scène, le serveur répond
 * encore `readable: true` — le reste du tracé est légitimement visible. Un écran qui se
 * contenterait de rafraîchir le booléen continuerait d'afficher, depuis son cache, le
 * segment qu'on vient de lui retirer. La réponse doit donc porter la GÉOMÉTRIE du moment.
 */
const socleR = await lire(A,'CAB-TRACE-E2E');
await req('/api/data/cables/CAB-TRACE-E2E',{method:'PUT',...A,
  body:{ ...socleR, route:{ version:1, status:'verified', segments:[SEG_STC, SEG_RF1] } }});

const vueAvant = (await req('/api/cables/CAB-TRACE-E2E/route-access', H)).payload;
verifie('avant révocation : les deux segments sont servis', 2, vueAvant.route?.segments?.length);
verifie('avant révocation : rien n\'est marqué partiel', undefined, vueAvant.route?.partial);
verifie('la réponse porte une révision', true, Number.isFinite(vueAvant.revision));

// On retire à `pilote.plein` la LECTURE de RF1 — et elle seule.
for (const p of ['zone.summary.read','equipment.read','cable.read','cable.edit']) {
  await req(`/api/access/grants/${encodeURIComponent(`ZG-93-trace-rf1-${p}`)}`, { method:'DELETE', ...A });
}

const vueApres = (await req('/api/cables/CAB-TRACE-E2E/route-access', H)).payload;
verifie('après révocation : la lecture reste ouverte', true, vueApres.readable);
verifie('après révocation : UN seul segment est servi', 1, vueApres.route?.segments?.length);
verifie('après révocation : le tracé est marqué partiel', true, vueApres.route?.partial);
verifie('après révocation : plus modifiable', false, vueApres.editable);
const fuiteVue = JSON.stringify(vueApres.route);
for (const secret of ['902','1800','900','777','222']) {
  verifie(`rien de RF1 ne fuit dans la vue (« ${secret} »)`, false, fuiteVue.includes(secret));
}
verifie('aucun compte de segments masqués', ['partial','segments','status','version'],
  Object.keys(vueApres.route).sort());

// On remet les habilitations pour que l'épreuve reste rejouable.
for (const p of ['zone.summary.read','equipment.read','cable.read','cable.edit']) {
  await req('/api/access/grants',{method:'POST',...A,body:{userId:93,zoneId:'trace-rf1',permission:p}});
}

console.log('\n── 19 · LE PREMIER TRACÉ — `readable:false` ne veut pas dire « il n\'y en a pas » ──');
/*
 * LE DÉFAUT MESURÉ. Sur un câble sans cheminement relevé, le serveur répond `readable:
 * false` — il n'y a rien à lire — et la couche client en concluait « rien à voir », jetait
 * la sélection, et la toute première documentation d'un tracé devenait inatteignable. Or le
 * MÊME `readable: false` couvre une situation opposée : un cheminement bien réel dont pas un
 * segment ne nous regarde. Créer là-dessus l'écraserait.
 *
 * Ces épreuves mesurent, sur le serveur réel, que les deux réponses SONT distinguables sans
 * rien révéler, et que le serveur refuse l'écrasement même si un écran se trompait.
 */
/*
 * DEUX ÉQUIPEMENTS DÉDIÉS, ET LEURS PROPRES PORTS.
 *
 * Un port déjà occupé est refusé par le serveur (`PORT_ALREADY_CONNECTED`) : réutiliser
 * ceux de `CAB-SANS-TRACE` aurait fait échouer la mise en place, et surtout, un port ne
 * s'invente pas pour arranger une épreuve. Les deux bouts restent dans STC, pour que ce
 * soit bien la garde de TRACÉ — et non celle des extrémités — qui décide.
 */
await req('/api/data/equipments/916',{method:'PUT',...A,body:{id:916,name:'Premier tracé A',roomId:901,ports:[{id:'OUT8',number:'OUT8',direction:'OUT',type:'BNC / SDI'}]}});
await req('/api/data/equipments/917',{method:'PUT',...A,body:{id:917,name:'Premier tracé B',roomId:901,ports:[{id:'IN8',number:'IN8',direction:'IN',type:'BNC / SDI'}]}});
const posePremier = await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...A,body:{...(await lire(A,'CAB-PREMIER-TRACE')||{}),
  id:'CAB-PREMIER-TRACE', category:'Vidéo', type:'SDI', status:'Connecté', reference:'CAB-PREMIER-TRACE',
  sourceType:'equipment', sourceId:916, sourcePortId:'OUT8',
  destinationType:'equipment', destinationId:917, destinationPortId:'IN8', route:null }});
verifie('le câble d\'épreuve est en place', 200, posePremier.status);

const remetANeuf = async () => {
  const c = await lire(A,'CAB-PREMIER-TRACE');
  await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...A,body:{...c, route:null}});
  return lire(A,'CAB-PREMIER-TRACE');
};
const SEG_NEUF = { sceneType:'room', sceneId:901, naturalWidth:2000, naturalHeight:1000,
  waypoints:[{x:33,y:33},{x:333,y:303}], anchors:[] };
const SEG_CACHE = { sceneType:'room', sceneId:902, naturalWidth:1600, naturalHeight:800,
  waypoints:[{x:44,y:44},{x:444,y:404}], anchors:[] };

console.log('  · 19.1 — un câble SANS tracé, scène STC (inscriptible pour ce pilote)');
await remetANeuf();
const nu = await acces(P,'CAB-PREMIER-TRACE','?sceneType=room&sceneId=901');
console.log(`        réponse réelle : ${JSON.stringify(nu)}`);
verifie('readable est FAUX — il n\'y a rien à lire', false, nu.readable);
verifie('et pourtant la scène ouverte est créable', true, nu.creatableHere);
verifie('la géométrie servie est `null` : rien n\'est enregistré', null, nu.route);

console.log('  · 19.2 — un tracé ENTIÈREMENT hors périmètre : le même `readable`, l\'inverse comme fait');
const socle19 = await lire(A,'CAB-PREMIER-TRACE');
await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...A,
  body:{...socle19, route:{ version:1, status:'verified', segments:[SEG_CACHE] }}});
const cache = await acces(P,'CAB-PREMIER-TRACE','?sceneType=room&sceneId=901');
verifie('readable est FAUX, exactement comme sur un câble vierge', false, cache.readable);
verifie('mais la géométrie servie n\'est PAS `null`', true, cache.route !== null && typeof cache.route === 'object');
verifie('elle ne porte aucun segment', 0, cache.route?.segments?.length);
verifie('et elle se déclare partielle : un tracé existe et nous échappe', true, cache.route?.partial);
verifie('aucun compte, aucun identifiant masqué', ['partial','segments','status','version'],
  Object.keys(cache.route).sort());
const fuite19 = JSON.stringify(cache.route);
for (const secret of ['902','1600','800','444','404']) {
  verifie(`rien de RF1 ne fuit (« ${secret} »)`, false, fuite19.includes(secret));
}

console.log('  · 19.3 — créer par-dessus ce tracé invisible : le serveur refuse');
/*
 * Le refus du client n'est pas la seule défense. Si un écran confondait les deux réponses
 * ci-dessus, il enverrait un « premier tracé » qui EFFACERAIT le relevé de RF1.
 */
const vuP19 = await lire(P,'CAB-PREMIER-TRACE');
const ecrase = await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...P,
  body:{...vuP19, route:{ version:1, status:'proposed', segments:[SEG_NEUF] }}});
console.log(`        PUT « premier tracé » sur un tracé invisible : ${ecrase.status} ${ecrase.payload.error||''}`);
verifie('l\'écriture est refusée', true, ecrase.status >= 400);
verifie('et le motif est le périmètre du tracé', 'ROUTE_SCOPE_INSUFFICIENT', ecrase.payload.error);
const intact = await lire(A,'CAB-PREMIER-TRACE');
verifie('le relevé de RF1 est intact', 444, intact?.route?.segments?.[0]?.waypoints?.[1]?.x);
verifie('et il est resté seul', 1, intact?.route?.segments?.length);

console.log('  · 19.4 — sur une absence PROUVÉE, le premier relevé aboutit');
const vierge = await remetANeuf();
verifie('le câble est bien revenu sans tracé', null, (await lire(P,'CAB-PREMIER-TRACE'))?.route ?? null);
const preuve = await acces(P,'CAB-PREMIER-TRACE','?sceneType=room&sceneId=901');
verifie('preuve fraîche : aucun tracé, scène créable', 'false/true',
  `${preuve.route !== null}/${preuve.creatableHere}`);
const synchro = await lire(P,'CAB-PREMIER-TRACE');
const premier = await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...P,
  body:{...synchro, route:{ version:1, status:'proposed', segments:[SEG_NEUF] }}});
verifie('le premier tracé est accepté', 200, premier.status);
const pose19 = await lire(A,'CAB-PREMIER-TRACE');
verifie('un seul segment, dans STC', 'room/901', `${pose19?.route?.segments?.[0]?.sceneType}/${pose19?.route?.segments?.[0]?.sceneId}`);
verifie('la géométrie est celle qui a été dessinée', 333, pose19?.route?.segments?.[0]?.waypoints?.[1]?.x);
verifie('le reste du câble n\'a pas bougé', 'equipment/916/OUT8',
  `${pose19?.sourceType}/${pose19?.sourceId}/${pose19?.sourcePortId}`);

console.log('  · 19.5 — la scène NON inscriptible reste fermée, capacité et écriture d\'accord');
await remetANeuf();
const surRF1 = await acces(P,'CAB-PREMIER-TRACE','?sceneType=room&sceneId=902');
verifie('RF1 : NON créable pour ce pilote', false, surRF1.creatableHere);
const synchro2 = await lire(P,'CAB-PREMIER-TRACE');
const dansRF1 = await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...P,
  body:{...synchro2, route:{ version:1, status:'proposed', segments:[SEG_CACHE] }}});
console.log(`        PUT d'un premier tracé DANS RF1 : ${dansRF1.status} ${dansRF1.payload.error||''}`);
verifie('l\'écriture est refusée', true, dansRF1.status >= 400);
verifie('et le motif nomme la scène', 'ROUTE_SCENE_EDIT_FORBIDDEN', dansRF1.payload.error);
verifie('aucun tracé n\'a été créé', null, (await lire(A,'CAB-PREMIER-TRACE'))?.route ?? null);

console.log('  · 19.6 — COURSE : un autre relève le tracé entre la preuve et l\'enregistrement');
/*
 * C'est le cas que la preuve d'absence ne peut pas fermer à elle seule : elle est vraie à
 * l'instant où elle est faite. DEUX défenses la suivent, et elles ne se recouvrent pas.
 *
 * (a) Quand le relevé de l'autre touche une scène que le retardataire ne voit pas, c'est
 *     la garde de TRACÉ qui parle, avant toute question de révision.
 * (b) Quand il tient entièrement dans son périmètre, la garde de tracé n'a rien à dire :
 *     seul le contrat de concurrence sépare alors l'écrasement de la mise à jour.
 *
 * MESURÉ : (a) rend 403 ROUTE_SCOPE_INSUFFICIENT, pas le 409 que j'attendais. La garde de
 * tracé est la plus proche du danger, et elle tranche la première.
 */
await remetANeuf();
const avantCourse = await lire(P,'CAB-PREMIER-TRACE');
await acces(P,'CAB-PREMIER-TRACE','?sceneType=room&sceneId=901');   // la preuve, faite AVANT
// Pendant ce temps, un pilote habilité sur les deux zones relève un cheminement qui SORT
// du périmètre du retardataire.
const parAutrui = await lire(H,'CAB-PREMIER-TRACE');
const posePar93 = await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...H,
  body:{...parAutrui, route:{ version:1, status:'verified', segments:[SEG_NEUF, SEG_CACHE] }}});
verifie('l\'autre exploitant enregistre bien son relevé', 200, posePar93.status);

const tardif = await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...P,
  body:{...avantCourse, route:{ version:1, status:'proposed', segments:[SEG_NEUF] }}});
console.log(`        (a) hors périmètre — « premier tracé » arrivé trop tard : ${tardif.status} ${tardif.payload.error||''}`);
verifie('(a) l\'écriture tardive est refusée', true, tardif.status >= 400);
verifie('(a) et c\'est la garde de TRACÉ qui tranche, avant la révision', 'ROUTE_SCOPE_INSUFFICIENT', tardif.payload.error);
const apresCourse = await lire(A,'CAB-PREMIER-TRACE');
verifie('(a) le relevé de l\'autre est INTACT', 2, apresCourse?.route?.segments?.length);
verifie('(a) y compris son segment RF1', 444, apresCourse?.route?.segments?.find(s=>String(s.sceneId)==='902')?.waypoints?.[1]?.x);

// (b) Le relevé de l'autre tient ENTIÈREMENT dans STC : le retardataire le voit en entier,
// la garde de tracé le laisse donc passer, et seul le contrat de concurrence reste.
const SEG_AUTRE = { sceneType:'room', sceneId:901, naturalWidth:2000, naturalHeight:1000,
  waypoints:[{x:55,y:55},{x:555,y:505}], anchors:[] };
await remetANeuf();
const avantCourseB = await lire(P,'CAB-PREMIER-TRACE');
await acces(P,'CAB-PREMIER-TRACE','?sceneType=room&sceneId=901');
const parAutruiB = await lire(H,'CAB-PREMIER-TRACE');
verifie('(b) l\'autre relève un cheminement entièrement dans STC', 200,
  (await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...H,
    body:{...parAutruiB, route:{ version:1, status:'verified', segments:[SEG_AUTRE] }}})).status);
verifie('(b) et le retardataire le voit en ENTIER', 'true/false',
  `${(await acces(P,'CAB-PREMIER-TRACE')).readable}/${Boolean((await acces(P,'CAB-PREMIER-TRACE')).route?.partial)}`);

const tardifB = await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...P,
  body:{...avantCourseB, route:{ version:1, status:'proposed', segments:[SEG_NEUF] }}});
console.log(`        (b) dans le périmètre — « premier tracé » arrivé trop tard : ${tardifB.status} ${tardifB.payload.error||''}`);
verifie('(b) l\'écriture tardive est refusée', 409, tardifB.status);
verifie('(b) et c\'est le contrat de concurrence qui tranche', 'STALE_WRITE', tardifB.payload.error);
verifie('(b) le relevé de l\'autre est INTACT', 555,
  (await lire(A,'CAB-PREMIER-TRACE'))?.route?.segments?.[0]?.waypoints?.[1]?.x);

console.log('  · 19.7 — POURQUOI la révision servie ne s\'écrit JAMAIS');
/*
 * La preuve fraîche rapporte une révision. Si l'écran la collait sur les champs qu'il
 * détient depuis son dernier instantané, le contrat de concurrence n'aurait plus rien à
 * comparer : l'écriture passerait, et le relevé de l'autre disparaîtrait. On le MESURE ici,
 * une fois, sur le cas (b) — celui où la garde de tracé ne protège plus rien — pour que la
 * règle ne reste pas une précaution de principe.
 */
const preuveTardive = await acces(P,'CAB-PREMIER-TRACE','?sceneType=room&sceneId=901');
verifie('la preuve rapporte une révision plus récente que la copie locale', true,
  Number(preuveTardive.revision) > Number(avantCourseB._revision));
const contrefacon = await req('/api/data/cables/CAB-PREMIER-TRACE',{method:'PUT',...P,
  body:{...avantCourseB, _revision: preuveTardive.revision,
    route:{ version:1, status:'proposed', segments:[SEG_NEUF] }}});
verifie('collée sur des champs périmés, elle FAIT PASSER l\'écrasement', 200, contrefacon.status);
verifie('et le relevé de l\'autre a bien disparu', 333,
  (await lire(A,'CAB-PREMIER-TRACE'))?.route?.segments?.[0]?.waypoints?.[1]?.x);
console.log('        → c\'est pourquoi `payload(cable)` part du câble SYNCHRONISÉ, jamais de la preuve.');
await remetANeuf();

console.log(`\n${echecs===0?'TOUT VERT':echecs+' ÉCHEC(S)'}`);
process.exit(echecs===0?0:1);
