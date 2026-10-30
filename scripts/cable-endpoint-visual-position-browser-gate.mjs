/**
 * @file scripts/cable-endpoint-visual-position-browser-gate.mjs — LA FICHE « SIGNAL FLOW »
 *       DIT-ELLE LA VÉRITÉ SUR LA POSITION VISUELLE DE CHAQUE EXTRÉMITÉ ?
 *
 * CE QUE CE LOT PROUVE.
 *
 * `cable-endpoint-contract.js#resolveCableEndpoint` résout déjà l'IDENTITÉ logique d'une
 * extrémité (équipement, composant, écran) — jamais sa position de pixel. Un `portId` est
 * une identité vérifiée contre les ports déclarés, PAS une preuve de position : aucun
 * ancrage aujourd'hui n'associe un port à un pixel (les repères existants sont
 * `source/destination + x/y`, jamais `+ portId`). La Fiche 360°, dans son bloc « Signal
 * Flow », affichait donc l'identité et le port de chaque bout SANS jamais dire si une
 * position visuelle réelle existe pour l'entité qui le porte.
 *
 * `cable-route-presentation.js#endpointVisualPositionLabel` ferme cet écart en lisant le
 * contrat des formes imbriquées DÉJÀ existant (`nested-shape-contract.js` —
 * `shapeInRoom`/`shapeInBaie`/`shapeInEquipment`, ou son repli en point hérité
 * `x_inRoom`/`x_inBaie`) pour l'ENTITÉ porteuse — jamais pour le connecteur. Ce lot prouve,
 * au navigateur réel et dans la vraie Fiche 360°, que cette ligne s'affiche, dit vrai dans
 * les deux sens (documenté / à confirmer), et ne bouge jamais le tracé du câble
 * (`drawRouteLayer`, la pastille, la phrase du cheminement) qu'elle ne touche pas.
 *
 * AUCUN NOUVEAU CHAMP, AUCUNE NOUVELLE DONNÉE.
 *
 * Ce lot ne crée ni magasin ni champ : il relit `shapeInEquipment`/`shapeInRoom` que
 * `equipment-component-shapes.js` et `interactive-map.js` savent déjà écrire.
 *
 * AUCUNE donnée de production : zone, salle, équipements et câble préfixés `cevp-`,
 * base de recette, serveur éphémère.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:4188';
const adminUser = process.env.PLATFORM_ADMIN_USERNAME || 'e2e-admin';
const adminPass = process.env.PLATFORM_ADMIN_PASSWORD || 'E2e-Admin-Password-2026!';
const chemin = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function api(path, { method = 'GET', cookie = '', body, expected = null } = {}) {
  const reponse = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await reponse.text();
  let charge = {};
  try { charge = texte ? JSON.parse(texte) : {}; } catch { charge = { texte }; }
  if (expected !== null) assert.equal(reponse.status, expected, `${method} ${path} : attendu ${expected}, reçu ${reponse.status} ${texte}`);
  return { statut: reponse.status, charge, cookie: reponse.headers.get('set-cookie')?.split(';')[0] || '' };
}

const connexion = async (username, password) => {
  const { cookie, charge } = await api('/api/auth/login', { method: 'POST', body: { username, password }, expected: 200 });
  assert.ok(cookie.startsWith('tp_session='), `session absente pour ${username}`);
  return { cookie, user: charge.user };
};

let echecs = 0;
const verifie = (titre, condition) => {
  if (!condition) echecs += 1;
  console.log(`  ${condition ? '✓' : '✗ ÉCHEC'} ${titre}`);
};

async function evaluerStable(page, fonction, argument, essais = 4) {
  let derniere = null;
  for (let essai = 0; essai < essais; essai += 1) {
    try { return await page.evaluate(fonction, argument); }
    catch (erreur) {
      if (!/context was destroyed|Execution context|Failed to fetch|NetworkError/i.test(String(erreur?.message))) throw erreur;
      derniere = erreur;
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  throw derniere;
}

const { cookie: admin, user: adminUser360 } = await connexion(adminUser, adminPass);
const A = { cookie: admin };

const SUFFIXE = Date.now() % 1000000;
const ZONE = `cevp-zone-${SUFFIXE}`;
const SALLE = 70000 + SUFFIXE;
// Un équipement DIRECT de salle, avec une forme documentée (shapeInRoom) — bout 1.
const EQ_AVEC_FORME = 71000 + SUFFIXE;
// Un équipement direct de salle, SANS aucune position — bout 2 (extrémité « à confirmer »).
const EQ_SANS_POSITION = 72000 + SUFFIXE;
// Un châssis avec un composant SANS forme — bout 3.
const EQ_CHASSIS = 73000 + SUFFIXE;
const COMPOSANT_SANS_FORME = `cevp-composant-${SUFFIXE}`;
const PORT_CHASSIS = `cevp-port-chassis-${SUFFIXE}`;
const PORT_FORME_OUT = `cevp-port-forme-out-${SUFFIXE}`;
const PORT_FORME_IN = `cevp-port-forme-in-${SUFFIXE}`;
const PORT_VIDE = `cevp-port-vide-${SUFFIXE}`;
const CABLE_A = 74000 + SUFFIXE; // EQ_AVEC_FORME (documenté) -> EQ_SANS_POSITION (à confirmer)
const CABLE_B = 75000 + SUFFIXE; // Composant SANS forme (à confirmer) -> EQ_AVEC_FORME (documenté)

const PHOTO = `data:image/png;base64,${readFileSync(new URL('../assets/favicon.png', import.meta.url)).toString('base64')}`;

await api('/api/access/zones', { method: 'POST', ...A, body: { id: ZONE, name: 'Recette position visuelle', publicSummary: 'Zone de recette' } });
await api(`/api/data/rooms/${SALLE}`, { method: 'PUT', ...A, body: { id: SALLE, name: `Salle recette position ${SUFFIXE}`, x: 500, y: 400 } });
await api('/api/access/resource-zones', { method: 'POST', ...A, body: { resourceType: 'room', resourceId: SALLE, zoneId: ZONE } });

await api(`/api/data/equipments/${EQ_AVEC_FORME}`, { method: 'PUT', ...A, body: {
  id: EQ_AVEC_FORME, name: `Eq avec forme ${SUFFIXE}`, roomId: SALLE,
  shapeInRoom: { type: 'rect', x: 40, y: 40, w: 60, h: 40 },
  ports: [
    { id: PORT_FORME_OUT, number: '1', type: 'BNC / SDI', direction: 'OUT' },
    { id: PORT_FORME_IN, number: '2', type: 'BNC / SDI', direction: 'IN' }
  ]
} });
await api(`/api/data/equipments/${EQ_SANS_POSITION}`, { method: 'PUT', ...A, body: {
  id: EQ_SANS_POSITION, name: `Eq sans position ${SUFFIXE}`, roomId: SALLE,
  ports: [{ id: PORT_VIDE, number: '1', type: 'BNC / SDI', direction: 'IN' }]
} });
await api(`/api/data/equipments/${EQ_CHASSIS}`, { method: 'PUT', ...A, body: {
  id: EQ_CHASSIS, name: `Chassis recette ${SUFFIXE}`, type: 'Châssis modulaire', roomId: SALLE,
  images: [{ url: PHOTO, sourceType: 'instance' }],
  components: [{ id: COMPOSANT_SANS_FORME, type: 'Carte broadcast / traitement', name: 'Carte sans forme', slot: 'Slot 1',
    ports: [{ id: PORT_CHASSIS, number: '1', type: 'BNC / SDI', direction: 'OUT' }] }]
} });

await api(`/api/data/cables/${CABLE_A}`, { method: 'PUT', ...A, expected: 200, body: {
  id: CABLE_A, reference: `Câble A ${SUFFIXE}`, category: 'Vidéo', type: 'SDI', status: 'Connecté',
  sourceType: 'equipment', sourceId: EQ_AVEC_FORME, sourcePortId: PORT_FORME_OUT,
  destinationType: 'equipment', destinationId: EQ_SANS_POSITION, destinationPortId: PORT_VIDE
} });
await api(`/api/data/cables/${CABLE_B}`, { method: 'PUT', ...A, expected: 200, body: {
  id: CABLE_B, reference: `Câble B ${SUFFIXE}`, category: 'Vidéo', type: 'SDI', status: 'Connecté',
  sourceType: 'component', sourceId: COMPOSANT_SANS_FORME, sourceParentEquipmentId: EQ_CHASSIS, sourcePortId: PORT_CHASSIS,
  destinationType: 'equipment', destinationId: EQ_AVEC_FORME, destinationPortId: PORT_FORME_IN
} });

console.log('── 0 · fixtures posées ──');

const navigateur = await chromium.launch({ executablePath: chemin, args: ['--no-sandbox'] });
const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
const [nom, valeur] = admin.split('=');
await contexte.addCookies([{ name: nom, value: valeur, url: base }]);
await contexte.addInitScript(charge => { try { localStorage.setItem('auth', charge); } catch {} }, JSON.stringify(adminUser360 || { id: 1, role: 'admin', username: adminUser }));
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', erreur => erreurs.push(String(erreur.message)));
await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.waitForFunction(() => {
  const splash = document.getElementById('startup-splash');
  return !splash || getComputedStyle(splash).pointerEvents === 'none';
}, { timeout: 8000 }).catch(() => {});

async function ouvrirFiche360(equipmentId) {
  for (let essai = 0; essai < 30; essai += 1) {
    await evaluerStable(page, id => window.TechOperations?.openEquipment360?.(id), equipmentId);
    const pret = await page.waitForSelector('.ops-flow-row', { timeout: 1200 }).then(() => true).catch(() => false);
    if (pret) return true;
  }
  return false;
}

/*
 * CHAQUE LIGNE PORTE SA PROPRE RÉFÉRENCE — dans son propre nœud `.ops-flow-arrow`, un
 * enfant du `.ops-flow-row` lui-même. Plusieurs câbles listés dans la même fiche partagent
 * un même parent `.ops-flow` : filtrer sur `parentElement`/`nextElementSibling` matchait
 * donc TOUJOURS la première ligne, quelle que soit la référence cherchée.
 */
function ligneDuFlux(page, refCable) {
  return evaluerStable(page, ref => {
    const ligne = [...document.querySelectorAll('.ops-flow-row')]
      .find(row => row.textContent?.includes(ref));
    if (!ligne) return null;
    const noeuds = [...ligne.querySelectorAll('.ops-flow-node')];
    return noeuds.map(noeud => ({
      texte: noeud.textContent.trim(),
      position: noeud.querySelector('.ops-flow-position')?.textContent?.trim() || null
    }));
  }, refCable);
}

/* ═══════════ 1 · CÂBLE A — un bout documenté (shapeInRoom), un bout à confirmer ═══════════ */

console.log('── 1 · câble A : equipement documenté (shapeInRoom) -> équipement sans position ──');
{
  const pret = await ouvrirFiche360(EQ_AVEC_FORME);
  verifie('la fiche 360° affiche au moins un flux de signal', pret);
  const noeuds = await ligneDuFlux(page, `Câble A ${SUFFIXE}`);
  verifie('les deux nœuds du câble A sont trouvés', Array.isArray(noeuds) && noeuds.length === 2);
  verifie('le nœud « Eq avec forme » porte « Repère visuel documenté sur sa photo »',
    noeuds?.some(n => n.texte.includes(`Eq avec forme ${SUFFIXE}`) && n.position === 'Repère visuel documenté sur sa photo'));
  verifie('le nœud « Eq sans position » porte « Position visuelle du port à confirmer »',
    noeuds?.some(n => n.texte.includes(`Eq sans position ${SUFFIXE}`) && n.position === 'Position visuelle du port à confirmer'));
}

/* ═══════════ 2 · CÂBLE B — un composant SANS forme, un équipement documenté ═══════════ */

console.log('── 2 · câble B : composant SANS forme -> équipement documenté ──');
{
  const pret = await ouvrirFiche360(EQ_AVEC_FORME);
  verifie('la fiche 360° affiche au moins un flux de signal', pret);
  const noeuds = await ligneDuFlux(page, `Câble B ${SUFFIXE}`);
  verifie('les deux nœuds du câble B sont trouvés', Array.isArray(noeuds) && noeuds.length === 2);
  verifie('le nœud du composant SANS forme porte « à confirmer », jamais un pixel inventé',
    noeuds?.some(n => n.texte.includes('Carte sans forme') && n.position === 'Position visuelle du port à confirmer'));
  verifie('le nœud « Eq avec forme » (destination) porte de nouveau « documenté »',
    noeuds?.some(n => n.texte.includes(`Eq avec forme ${SUFFIXE}`) && n.position === 'Repère visuel documenté sur sa photo'));
}

/* ═══════════ 3 · APRÈS avoir dessiné la forme du composant, sa ligne devient « documenté » ═══════════ */

console.log('── 3 · dessiner shapeInEquipment fait passer le composant à « documenté » ──');
{
  const { charge: sync } = await api('/api/sync', { cookie: admin });
  const chassisFrais = sync?.data?.equipments?.find(e => String(e.id) === String(EQ_CHASSIS));
  assert.ok(chassisFrais, 'le châssis doit exister avant de lui poser une forme');
  await api(`/api/data/equipments/${EQ_CHASSIS}`, { method: 'PUT', ...A, expected: 200, body: {
    ...chassisFrais,
    components: chassisFrais.components.map(c => c.id === COMPOSANT_SANS_FORME
      ? { ...c, shapeInEquipment: { type: 'rect', x: 10, y: 10, w: 20, h: 20 } }
      : c)
  } });
  /*
   * L'ÉCRITURE SERVEUR PRÉCÈDE L'HYDRATATION LOCALE.
   *
   * La Fiche 360° lit l'IndexedDB du client (central-sync.js). Un PUT fait par un appel
   * direct, hors de CETTE page, n'y redescend pas tout seul en arrière-plan — mesuré :
   * 20 réouvertures de la fiche sur 8 secondes ne l'ont jamais vu passer. Un rechargement
   * complet de la page relance la synchronisation complète au démarrage, exactement comme
   * un exploitant qui rouvrirait l'onglet verrait la donnée à jour.
   */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const splash = document.getElementById('startup-splash');
    return !splash || getComputedStyle(splash).pointerEvents === 'none';
  }, { timeout: 8000 }).catch(() => {});
  let noeuds = null;
  for (let essai = 0; essai < 10 && !noeuds?.some(n => n.position === 'Repère visuel documenté sur sa photo' && n.texte.includes('Carte sans forme')); essai += 1) {
    const pret = await ouvrirFiche360(EQ_AVEC_FORME);
    if (!pret) { await page.waitForTimeout(300); continue; }
    noeuds = await ligneDuFlux(page, `Câble B ${SUFFIXE}`);
    if (!noeuds?.some(n => n.position === 'Repère visuel documenté sur sa photo')) await page.waitForTimeout(400);
  }
  verifie('le composant, désormais avec shapeInEquipment, porte « documenté »',
    noeuds?.some(n => n.texte.includes('Carte sans forme') && n.position === 'Repère visuel documenté sur sa photo'));
}

/* ═══════════ 4 · RÉGRESSION — la pastille et la phrase du tracé n’ont pas bougé ═══════════ */

console.log('── 4 · régression : pastille et message d’absence de tracé inchangés ──');
{
  const pret = await ouvrirFiche360(EQ_AVEC_FORME);
  verifie('la fiche 360° se recharge', pret);
  const etat = await evaluerStable(page, ref => {
    const ligne = [...document.querySelectorAll('.ops-flow-row')].find(row => row.textContent?.includes(ref));
    const conteneur = ligne?.nextElementSibling;
    return conteneur ? { badge: conteneur.querySelector('.ops-route-badge')?.textContent?.trim() || null, aBouton: Boolean(conteneur.querySelector('.ops-voir-trace')) } : null;
  }, `Câble A ${SUFFIXE}`);
  verifie('un câble sans tracé relevé porte toujours la pastille « absent »', etat?.badge === 'Tracé physique non renseigné');
  verifie('aucun bouton « Voir le tracé » pour un câble sans géométrie (comportement inchangé)', etat?.aBouton === false);
}
verifie('aucune erreur JavaScript sur toute la recette', erreurs.length === 0);

console.log(`\n${echecs === 0 ? '✓ TOUT PASSE' : `✗ ${echecs} ÉCHEC(S)`}`);
await navigateur.close();
process.exit(echecs === 0 ? 0 : 1);
