import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as connectivite from '../connectivity-contract.js';
import * as topologie from '../topology-contract.js';
import * as diffusion from '../broadcast-topology.js';

const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/*
 * UN SEUL VOCABULAIRE DE VÉRIFICATION POUR TOUTE LA PLATEFORME.
 *
 * `connectivity-contract.js` et `topology-contract.js` portaient chacun leur liste d'états de
 * vérification. Elles n'étaient PAS les mêmes :
 *
 *   connectivité : verified, documented, observed, observed-handwritten, to-confirm, draft
 *   topologie    : verified, documented,           observed-handwritten, to-confirm, draft
 *
 * Or `normalizeVerification` remplace par « to-confirm » toute valeur absente de sa liste.
 *
 * Mesuré dans la base : HUIT enregistrements portent « observed ». Lus par la voie topologie,
 * ils devenaient « to-confirm » — l'observation terrain enregistrée disparaissait, et
 * l'équipement semblait redemander une vérification que quelqu'un avait déjà faite.
 *
 * C'est la même famille de défaut que la copie des règles de carte : deux définitions du même
 * concept, tenues d'accord à la main, qui finissent par diverger sans que rien ne le signale.
 */

test('les deux contrats partagent LE MÊME objet, pas deux listes jumelles', () => {
  // L'identité est la seule vérification qu'une copie ne peut pas satisfaire.
  assert.equal(topologie.VERIFICATION_STATUSES, connectivite.VERIFICATION_STATUSES,
    'topology-contract.js redéfinit sa propre liste d’états de vérification');
  assert.equal(topologie.PATH_ROLES, connectivite.PATH_ROLES,
    'topology-contract.js redéfinit ses propres rôles de chemin');
});

test('« observed » traverse la topologie sans être dégradé', () => {
  // Le cas exact des 8 enregistrements mesurés.
  assert.equal(topologie.normalizeVerification('observed'), 'observed');
  // Et tous les autres états connus survivent aussi au passage.
  for (const etat of connectivite.VERIFICATION_STATUSES) {
    assert.equal(topologie.normalizeVerification(etat), etat,
      `l’état « ${etat} » est dégradé en traversant la topologie`);
  }
});

test('une valeur inconnue reste rejetée — la garde n’a pas été retirée', () => {
  // Élargir le vocabulaire ne doit pas revenir à tout accepter : une valeur inventée doit
  // toujours retomber sur « à confirmer », sinon n'importe quelle faute de frappe devient
  // un état de vérification valable.
  for (const absurde of ['n-importe-quoi', '', null, undefined, 42, 'VERIFIED!!']) {
    assert.equal(topologie.normalizeVerification(absurde), 'to-confirm',
      `« ${String(absurde)} » a été accepté comme état de vérification`);
  }
});

test('la couche diffusion hérite du même vocabulaire', () => {
  // `broadcast-topology.js` réexporte depuis la topologie : la chaîne complète doit tenir.
  assert.equal(diffusion.VERIFICATION_STATUSES, connectivite.VERIFICATION_STATUSES);
  assert.equal(diffusion.PATH_ROLES, connectivite.PATH_ROLES);
});

test('la topologie ne redéfinit plus ces listes dans son source', () => {
  const source = lire('topology-contract.js');
  assert.doesNotMatch(source, /^export const VERIFICATION_STATUSES\s*=\s*Object\.freeze\(\[/m,
    'une liste locale d’états de vérification est réapparue');
  assert.doesNotMatch(source, /^export const PATH_ROLES\s*=\s*Object\.freeze\(\[/m,
    'une liste locale de rôles de chemin est réapparue');
  assert.match(source, /from '\.\/connectivity-contract\.js'/);
});

test('le contrat source reste une feuille, donc aucun cycle n’est créé', () => {
  // `connectivity-contract.js` n'importe rien : c'est ce qui permet à tout le monde d'en
  // dépendre. Le jour où il importerait quelque chose, ce test le signalerait avant que le
  // cycle ne casse le chargement des modules dans le navigateur.
  const source = lire('connectivity-contract.js');
  assert.doesNotMatch(source, /^\s*import\s/m,
    'connectivity-contract.js n’est plus une feuille : un cycle d’import devient possible');
});
