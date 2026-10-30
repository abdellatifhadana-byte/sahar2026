import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NAVIGATION_CONTRACT_VERSION,
  parseHashRoute,
  buildHashRoute,
  allowedSectionsForRole
} from '../navigation-contract.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const integration = read('role-navigation-integration.js');
const index = read('index.html');
const sw = read('service-worker.js');
const tech = read('techui.js');
const admin = read('admin-ui.js');
const responsible = read('responsible-ui.js');

test('le contrat de navigation parse sections, détails et query sans laisser sortir un rôle de son périmètre', () => {
  assert.equal(NAVIGATION_CONTRACT_VERSION, 1);
  assert.equal(parseHashRoute('#/devices/eq-17?status=faulty', { role:'technician' }).section, 'devices');
  assert.equal(parseHashRoute('#/devices/eq-17?status=faulty', { role:'technician' }).entityId, 'eq-17');
  assert.equal(parseHashRoute('#/devices/eq-17?status=faulty', { role:'technician' }).query.status, 'faulty');
  assert.equal(parseHashRoute('#/users', { role:'technician' }).section, 'dashboard');
  assert.equal(parseHashRoute('#/integrity', { role:'admin', allowedSections:['dashboard','integrity'] }).section, 'integrity');
  assert.equal(parseHashRoute('#/unknown', { role:'responsible' }).section, 'devices');
  assert.ok(allowedSectionsForRole('technician').includes('tickets'));
});

test('le contrat reconstruit un hash canonique encodé et stable', () => {
  assert.equal(buildHashRoute({ section:'devices', segments:['EQ 01'], query:{ status:'maintenance' } }), '#/devices/EQ%2001?status=maintenance');
  assert.equal(parseHashRoute('#/screens/issues/screen-9', { role:'technician' }).entityId, 'screen-9');
});

test('l’intégration remplace le faux hashchange technicien par un vrai rendu de sections', () => {
  assert.match(tech, /window\.addEventListener\('hashchange'[\s\S]*this\.render\(\)/);
  assert.match(integration, /TechUI\.prototype\.bindGlobalActions = function bindCanonicalTechActions/);
  assert.match(integration, /renderTechnicianRoute/);
  assert.match(integration, /new Equipements\(ui\.notifications\)/);
  assert.match(integration, /new Salles\(ui\.notifications\)/);
  assert.match(integration, /new Baies\(ui\.notifications\)/);
  assert.match(integration, /showTicketsPage\('tech-route-content'\)/);
  assert.match(integration, /ui\.screensDiagnostic\.render\(\)/);
  assert.match(integration, /window\.TechOperations\?\.openEquipment360\?\.\(route\.entityId\)/);
});

test('admin et responsable utilisent le même contrat au lieu de variantes incompatibles du hash', () => {
  assert.match(admin, /window\.location\.hash\.substring\(2\)/);
  assert.match(responsible, /window\.location\.hash\.substring\(2\)/);
  assert.match(integration, /AdminUI\.prototype\.openTab/);
  assert.match(integration, /ResponsibleUI\.prototype\.navigateToSection/);
  assert.match(integration, /parseHashRoute\(window\.location\.hash/);
  assert.match(integration, /ticketLink\.addEventListener\('click'/);
});

test('l’intégration de navigation est chargée avant core et disponible hors ligne', () => {
  const integrationIndex = index.indexOf('src="role-navigation-integration.js"');
  const coreIndex = index.indexOf('src="core.js"');
  assert.ok(integrationIndex >= 0 && coreIndex > integrationIndex, 'le patch de navigation doit être installé avant Core');
  assert.match(sw, /\/navigation-contract\.js/);
  assert.match(sw, /\/role-navigation-integration\.js/);
});
