import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogPortTemplate, hasPortTemplate, normalizeTemplateEntry, buildPortsFromTemplate,
  defaultSelection, compatibleCableTypes, usableCableTypesByCategory, portUsage, TEMPLATE_SCOPES
} from '../equipment-port-template.js';
import { validatePortCollection } from '../connectivity-contract.js';

const MC1 = {
  id: 'kb-ross-mc1uhd',
  portTemplate: [
    { key: 'sdi-in', label: 'Entrées SDI', direction: 'IN', portType: '12G-SDI', connector: 'HD_BNC',
      signalDomains: ['VIDEO'], protocols: ['SDI'], formats: ['HD-SDI', '3G-SDI', '12G-SDI'], count: 6,
      scope: 'rear-module-dependent', requiresRearModule: 'GATOR-MC1-2-R4' },
    { key: 'sdi-out', label: 'Sorties SDI', direction: 'OUT', portType: '12G-SDI', connector: 'HD_BNC',
      signalDomains: ['VIDEO'], protocols: ['SDI'], count: 6, scope: 'rear-module-dependent' },
    { key: 'ref-in', label: 'Référence (REF IN)', direction: 'IN', portType: 'Genlock / REF', connector: 'HD_BNC',
      signalDomains: ['SYNC'], protocols: ['GENLOCK'], count: 1, scope: 'model-capability' },
    { key: 'aes', label: 'AES', direction: 'IN/OUT', portType: 'AES/EBU',
      signalDomains: ['AUDIO'], protocols: ['AES3'], count: null, scope: 'rear-module-dependent' }
  ]
};

test('gabarit: lit le modèle sans jamais inventer une quantité inconnue', () => {
  const template = catalogPortTemplate(MC1);
  assert.equal(template.length, 4);
  assert.equal(hasPortTemplate(MC1), true);
  assert.equal(hasPortTemplate({}), false);
  const aes = template.find(entry => entry.key === 'aes');
  assert.equal(aes.count, null, 'une quantité absente ne doit pas être devinée');
  assert.equal(aes.countKnown, false);
  const sdiIn = template.find(entry => entry.key === 'sdi-in');
  assert.equal(sdiIn.count, 6);
  assert.equal(sdiIn.countKnown, true);
});

test('gabarit: un type de port inconnu retombe sur « Autre » sans casser', () => {
  const entry = normalizeTemplateEntry({ key: 'x', label: 'Bus propriétaire', portType: 'Bus maison', direction: 'BIZARRE' });
  assert.equal(entry.portType, 'Autre');
  assert.equal(entry.portTypeKnown, false);
  assert.equal(entry.direction, 'IN/OUT', 'un sens invalide ne doit pas produire un sens invalide');
  assert.ok(TEMPLATE_SCOPES.includes(entry.scope));
});

test('gabarit: la sélection par défaut ne retient que le documenté avec certitude', () => {
  const selection = defaultSelection(catalogPortTemplate(MC1));
  assert.deepEqual(selection, { 'sdi-in': 6, 'sdi-out': 6, 'ref-in': 1 });
  assert.equal('aes' in selection, false);
});

test('gabarit: matérialise exactement les ports choisis, et rien d’autre', () => {
  const template = catalogPortTemplate(MC1);
  const { ports, added } = buildPortsFromTemplate(template, { 'sdi-in': 6, 'sdi-out': 6, 'ref-in': 1 }, { catalogId: 'kb-ross-mc1uhd' });
  assert.equal(added.length, 13);
  assert.equal(ports.length, 13);
  assert.equal(added.filter(port => port.direction === 'IN').length, 7);
  assert.equal(added.filter(port => port.direction === 'OUT').length, 6);
  assert.ok(added.every(port => port.verificationStatus === 'to-confirm'),
    'un port issu du modèle reste à confirmer tant que personne ne l’a vu sur l’unité');
  assert.ok(added.every(port => String(port.sourceRef).includes('kb-ross-mc1uhd')));
  const withRear = added.find(port => port.number.startsWith('SDI-IN'));
  assert.match(withRear.notes, /GATOR-MC1-2-R4/);
});

test('gabarit: les ports produits passent la validation du contrat de connectivité', () => {
  const template = catalogPortTemplate(MC1);
  const { ports } = buildPortsFromTemplate(template, defaultSelection(template), { catalogId: 'kb-ross-mc1uhd' });
  const checked = validatePortCollection(ports, { ownerLabel: 'le test' });
  assert.deepEqual(checked.errors, [], 'aucun doublon d’identifiant ni de numéro ne doit être produit');
});

test('gabarit: n’écrase jamais les ports déjà saisis et signale les conflits', () => {
  const template = catalogPortTemplate(MC1);
  const existing = [{ id: 'DEJA-1', number: 'SDI-IN-1', type: 'BNC / SDI', direction: 'IN' }];
  const { ports, added, skipped } = buildPortsFromTemplate(template, { 'sdi-in': 2 }, { existingPorts: existing });
  assert.equal(ports.length, existing.length + added.length);
  assert.equal(ports[0].id, 'DEJA-1', 'le port existant est conservé en tête');
  assert.equal(skipped.length, 1, 'le numéro déjà pris est signalé, pas dupliqué');
  assert.equal(skipped[0].number, 'SDI-IN-1');
  assert.equal(validatePortCollection(ports).errors.length, 0);
});

test('gabarit: une quantité absente ou nulle ne crée aucun port', () => {
  const template = catalogPortTemplate(MC1);
  assert.equal(buildPortsFromTemplate(template, {}).added.length, 0);
  assert.equal(buildPortsFromTemplate(template, { aes: 0 }).added.length, 0);
  assert.equal(buildPortsFromTemplate(template, { aes: -3 }).added.length, 0);
  assert.equal(buildPortsFromTemplate(template, { inexistant: 5 }).added.length, 0);
});

test('câbles: propose uniquement ce que le moteur serveur accepterait', () => {
  const sdiOut = { id: 'a', number: '1', type: '3G-SDI', direction: 'OUT' };
  const sdiIn = { id: 'b', number: '1', type: '3G-SDI', direction: 'IN' };
  const grouped = usableCableTypesByCategory(sdiOut, sdiIn);
  assert.ok(grouped['Vidéo']?.some(item => item.type === '3G-SDI'), 'un câble SDI doit être proposé entre deux ports SDI');
  assert.equal(grouped['Énergie'], undefined, 'un câble secteur ne doit jamais être proposé pour de la vidéo');
  assert.equal(grouped['Audio'], undefined);
});

test('câbles: un couple physiquement incompatible ne propose rien d’utilisable', () => {
  const hdmi = { id: 'a', number: '1', type: 'HDMI', direction: 'OUT' };
  const displayPort = { id: 'b', number: '1', type: 'DisplayPort', direction: 'IN' };
  const all = compatibleCableTypes(hdmi, displayPort);
  assert.ok(all.length > 0);
  assert.equal(all.filter(item => item.usable).length, 0, 'HDMI vers DisplayPort ne doit proposer aucun câble direct');
  const hdmiCable = all.find(item => item.type === 'HDMI');
  assert.equal(hdmiCable.status, 'incompatible');
  assert.ok(hdmiCable.reasons.length > 0, 'la raison du refus doit être exploitable par l’interface');
});

test('câbles: la cage SFP reste proposable mais à confirmer', () => {
  const sfpOut = { id: 'a', number: '1', type: 'SFP / SFP+', direction: 'OUT' };
  const sfpIn = { id: 'b', number: '1', type: 'SFP / SFP+', direction: 'IN' };
  const grouped = usableCableTypesByCategory(sfpOut, sfpIn);
  const fibre = grouped['Fibre optique'] || [];
  assert.ok(fibre.length > 0, 'la fibre doit rester proposable sur une cage SFP');
  assert.ok(fibre.every(item => item.status === 'to-confirm'), 'elle doit être marquée à confirmer, pas refusée');
  assert.equal(usableCableTypesByCategory(sfpOut, sfpIn, { includeToConfirm: false })['Fibre optique'], undefined);
});

test('sens: expose ce qu’un port peut faire avant que l’utilisateur ne se trompe', () => {
  assert.deepEqual(
    { ...portUsage({ id: 'a', number: '1', type: 'BNC / SDI', direction: 'OUT' }), pathRoles: undefined },
    { canSource: true, canDestination: false, pathRoles: undefined }
  );
  const patch = portUsage({ id: 'b', number: '1', type: 'BNC / SDI', direction: 'IN', behavior: 'patch' });
  assert.equal(patch.canSource, true, 'un point de brassage reste utilisable dans les deux sens');
  assert.equal(patch.canDestination, true);
  assert.equal(portUsage(null).canSource, false);
});

test('câblage: le module est chargé par le cache PWA et relié au formulaire', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
  const [worker, knowledge, ports] = await Promise.all([
    read('service-worker.js'), read('equipment-knowledge.js'), read('broadcast-ports-cables.js')
  ]);
  assert.match(worker, /equipment-port-template\.js/, 'le module doit être servi hors connexion');
  assert.match(knowledge, /from '\.\/equipment-port-template\.js'/, 'le formulaire doit consommer le gabarit');
  assert.match(knowledge, /eq-apply-port-template/, 'le bouton d’application du gabarit doit exister');
  assert.match(ports, /panel\.appendPorts/, 'les ports générés doivent passer par l’éditeur existant, sans liste parallèle');
  assert.doesNotMatch(knowledge, /db\.save\('ports'/, 'aucun magasin de ports parallèle ne doit apparaître');
});

test('formulaire câble: la liste des types est filtrée par le même moteur que le serveur', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../component-relations.js', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/equipment-port-template\.js'/, 'le formulaire doit réutiliser le moteur commun');
  assert.match(source, /compatibleCableTypes\(source, destination\)/, 'le filtrage doit interroger le moteur, pas une liste écrite à la main');
  assert.match(source, /cable-compat-hint/, 'la raison du filtrage doit être affichée à l’utilisateur');
  assert.match(source, /form\.sourcePortId\.onchange = updateTypes/, 'changer un port doit recalculer les câbles proposés');
  assert.doesNotMatch(source, /const COMPATIBLE_CABLES\s*=/, 'aucune table de compatibilité parallèle ne doit être introduite');
});
