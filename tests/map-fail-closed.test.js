/**
 * @file tests/map-fail-closed.test.js — le plan technique ne sort que pour qui couvre
 *       TOUTES les zones qu'il représente. Lot #131.
 *
 * CES TESTS EXÉCUTENT LES DÉCISIONS, ILS NE LES LISENT PAS.
 *
 * L'audit #130 a montré pourquoi cela compte : les 1 261 tests de la base étaient au vert
 * pendant que `/api/settings/map-image` livrait le plan à un Visiteur d'un autre
 * département, et que `/assets/plan-technique.PNG` le livrait à un client NON AUTHENTIFIÉ.
 * Aucune assertion de texte ne pouvait voir cela — il fallait faire tourner la règle.
 *
 * Chacun de ces tests ÉCHOUE sur la base b5f538e7 et passe sur ce lot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessControl } from '../scripts/access-control.js';
import {
  MAP_SOURCE, OPERATIONAL_MAP_FILES, isOperationalMapAsset,
  classifyOperationalMapSource, designatesBuiltinOperationalMap, isServableMapReference
} from '../map-image-contract.js';

/**
 * Un décor à trois zones, comme le plan réel : STC, l'informatique, et une régie.
 * `grants` dit qui est habilité où ; l'appartenance suit les habilitations.
 */
function decor({ zonesHabilitees = [], zonesAvecSalle = ['Z-STC', 'Z-INFO', 'Z-REGIE'], zoneInactive = null } = {}) {
  const records = {
    zones: ['Z-STC', 'Z-INFO', 'Z-REGIE'].map(id => ({
      id, name: id, status: id === zoneInactive ? 'inactive' : 'active'
    })),
    resource_zones: zonesAvecSalle.map((zoneId, index) => ({
      id: `RZ-${index}`, resourceType: 'room', resourceId: `R-${index}`, zoneId
    })),
    zone_memberships: zonesHabilitees.map(zoneId => ({
      id: `M-${zoneId}`, userId: 'u1', zoneId, status: 'active'
    })),
    zone_grants: zonesHabilitees.map(zoneId => ({
      id: `G-${zoneId}`, userId: 'u1', zoneId, permission: 'zone.summary.read', status: 'active'
    }))
  };
  const pool = { async query(sql, params = []) {
    if (sql.startsWith('SELECT data FROM')) {
      return { rows: (records[params[0]] || []).filter(item => String(item.id) === String(params[1])).map(data => ({ data })) };
    }
    if (sql.startsWith('SELECT record_id,data')) return { rows: (records[params[0]] || []).map(data => ({ data })) };
    throw new Error(`Requête inattendue: ${sql}`);
  } };
  return createAccessControl(pool);
}

const technicien = { id: 'u1', role: 'technicien' };

test('le plan représente les zones qui portent une salle, et elles seules', async () => {
  const access = decor({ zonesAvecSalle: ['Z-STC', 'Z-INFO'] });
  const zones = await access.operationalMapZones();
  assert.deepEqual([...zones].sort(), ['Z-INFO', 'Z-STC'],
    'une zone sans salle ne figure pas sur le plan et ne doit pas durcir l’accès pour rien');
});

test('une zone inactive ne compte pas parmi les zones du plan', async () => {
  const access = decor({ zoneInactive: 'Z-REGIE' });
  const zones = await access.operationalMapZones();
  assert.ok(!zones.includes('Z-REGIE'), 'une zone désactivée ne doit pas rendre le plan inatteignable');
});

test('UNE zone habilitée sur trois ne suffit pas : le bitmap est indivisible', async () => {
  const access = decor({ zonesHabilitees: ['Z-STC'] });
  assert.equal(await access.canReadOperationalMap(technicien), false,
    'le plan porte RF1, l’acquisition et les serveurs sur les mêmes pixels : ' +
    'être habilité sur STC seul ne donne aucun droit sur le reste de l’image');
});

test('DEUX zones sur trois ne suffisent toujours pas', async () => {
  const access = decor({ zonesHabilitees: ['Z-STC', 'Z-INFO'] });
  assert.equal(await access.canReadOperationalMap(technicien), false,
    'une couverture partielle ferme ; elle n’ouvre pas');
});

test('la couverture COMPLÈTE ouvre le plan', async () => {
  const access = decor({ zonesHabilitees: ['Z-STC', 'Z-INFO', 'Z-REGIE'] });
  assert.equal(await access.canReadOperationalMap(technicien), true);
});

test('aucune habilitation : refus', async () => {
  const access = decor({ zonesHabilitees: [] });
  assert.equal(await access.canReadOperationalMap(technicien), false);
});

test('sans utilisateur, et pour un rôle inconnu : refus', async () => {
  const access = decor({ zonesHabilitees: ['Z-STC', 'Z-INFO', 'Z-REGIE'] });
  assert.equal(await access.canReadOperationalMap(null), false);
  assert.equal(await access.canReadOperationalMap({ id: 'u1', role: 'supervisor-x' }), false,
    'un rôle abîmé ne doit hériter d’aucun plafond, y compris ici');
});

test('un rôle à portée globale reçoit le plan sans habilitation de zone', async () => {
  const access = decor({ zonesHabilitees: [] });
  assert.equal(await access.canReadOperationalMap({ id: 'a', role: 'admin' }), true,
    'la porte globale reste celle du moteur (`seesEveryZone`) : #133 la redéfinira ' +
    'pour les périmètres confiés, sans réécrire ce lot');
});

test('aucune zone connue : refus, y compris avec des habilitations', async () => {
  const access = decor({ zonesHabilitees: ['Z-STC', 'Z-INFO', 'Z-REGIE'], zonesAvecSalle: [] });
  assert.equal(await access.canReadOperationalMap(technicien), false,
    'on ne sait pas ce que le plan représente : on ferme, on ne suppose pas');
});

test('une zone ajoutée resserre l’accès immédiatement, sans redémarrage', async () => {
  const complet = decor({ zonesHabilitees: ['Z-STC', 'Z-INFO'], zonesAvecSalle: ['Z-STC', 'Z-INFO'] });
  assert.equal(await complet.canReadOperationalMap(technicien), true);
  const apresAjout = decor({ zonesHabilitees: ['Z-STC', 'Z-INFO'], zonesAvecSalle: ['Z-STC', 'Z-INFO', 'Z-REGIE'] });
  assert.equal(await apresAjout.canReadOperationalMap(technicien), false,
    'la liste des zones du plan est relue à chaque décision, jamais mise en cache');
});

/* ────────────────────────── le chemin statique ────────────────────────── */

test('le plan opérationnel n’est plus un actif public, dans ses deux casses', () => {
  for (const fichier of OPERATIONAL_MAP_FILES) {
    assert.equal(isOperationalMapAsset(`/${fichier}`), true, `${fichier} doit être fermé`);
  }
  assert.equal(isOperationalMapAsset('/assets/plan-technique.PNG'), true);
  assert.equal(isOperationalMapAsset('/assets/plan-technique.png'), true);
  assert.equal(isOperationalMapAsset('/assets/plan-technique.PNG?v=2'), true,
    'une chaîne de requête ne doit pas rouvrir le fichier');
  assert.equal(isOperationalMapAsset('/assets%2Fplan-technique.PNG'), true,
    'un chemin encodé désigne le même fichier');
});

test('la fermeture est CIBLÉE : les actifs généraux restent publics', () => {
  for (const public_ of [
    '/assets/images/2m-logo.webp', '/assets/image-indisponible.svg', '/main.css',
    '/assets/webfonts/fa-solid-900.woff2', '/index.html', '/assets/all.min.css'
  ]) {
    assert.equal(isOperationalMapAsset(public_), false, `${public_} doit rester servi`);
  }
});

/* ────────────────────────── la source configurée ────────────────────────── */

test('le plan intégré est reconnu à sa valeur exacte, jamais par défaut', () => {
  // CUSTOM-URL-1 / CUSTOM-URL-2
  for (const builtin of ['', '   ', undefined, null, 'assets/plan-technique.PNG', 'assets/plan-technique.png']) {
    assert.equal(classifyOperationalMapSource(builtin), MAP_SOURCE.BUILTIN,
      `${JSON.stringify(builtin)} désigne le plan livré avec la plateforme`);
    assert.equal(designatesBuiltinOperationalMap(builtin), true);
  }
});

test('une URL distante N’EST PAS le plan intégré', () => {
  // CUSTOM-URL-3. La première version traitait tout ce qui n'était pas `data:` comme le
  // plan intégré : une image configurée par « Appliquer l'URL » était donc remplacée en
  // silence, pendant que l'écran annonçait un enregistrement réussi.
  for (const distante of [
    'https://example.test/custom-map.png', 'http://example.test/custom-map.jpg',
    'HTTPS://EXAMPLE.TEST/PLAN.PNG'
  ]) {
    assert.equal(classifyOperationalMapSource(distante), MAP_SOURCE.REMOTE, distante);
    assert.equal(designatesBuiltinOperationalMap(distante), false,
      'une URL distante ne doit jamais être remplacée par le plan intégré');
  }
});

test('une charge téléversée se porte elle-même', () => {
  assert.equal(classifyOperationalMapSource('data:image/png;base64,AAAA'), MAP_SOURCE.UPLOAD);
  assert.equal(classifyOperationalMapSource('data:image/webp;base64,AAAA'), MAP_SOURCE.UPLOAD);
  assert.equal(designatesBuiltinOperationalMap('data:image/png;base64,AAAA'), false);
});

test('une valeur inclassable ferme au lieu de retomber sur le plan intégré', () => {
  for (const inconnue of [
    'javascript:alert(1)', 'file:///etc/passwd', 'ftp://hote/plan.png',
    'data:text/html;base64,PHNjcmlwdD4=', 'assets/autre-plan.png', '../../etc/passwd', 'plan'
  ]) {
    assert.equal(classifyOperationalMapSource(inconnue), MAP_SOURCE.UNKNOWN, inconnue);
    assert.equal(designatesBuiltinOperationalMap(inconnue), false,
      'deviner ici reviendrait à servir un document à la place d’un autre');
  }
});

test('seules trois formes peuvent atteindre un attribut src', () => {
  for (const servable of ['data:image/png;base64,AAAA', 'https://hote.test/p.png', 'http://hote.test/p.jpg']) {
    assert.equal(isServableMapReference(servable), true, servable);
  }
  for (const refusee of [
    'javascript:alert(1)', 'file:///etc/passwd', 'ftp://hote/p.png',
    'data:text/html;base64,PHNjcmlwdD4=', 'assets/plan-technique.PNG', '', null, undefined
  ]) {
    assert.equal(isServableMapReference(refusee), false, String(refusee));
  }
});
