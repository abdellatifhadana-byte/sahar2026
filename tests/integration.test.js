import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeRole } from '../roles.js';
import { normalizePosition, toCanonicalScreen, extractLegacyWallScreens } from '../wall-model.js';

test('historical roles resolve to canonical roles',()=>{
  // `manager` était un ALIAS d'`admin` : toute personne portant ce rôle recevait les
  // pleins pouvoirs — system.restore, users.changeRole, logs.clear — alors qu'elle doit
  // VOIR toute la chaîne sans pouvoir la reconfigurer. C'était une élévation de privilège
  // que personne n'avait accordée : elle découlait d'une ligne d'alias.
  assert.equal(normalizeRole('manager'),'manager');
  assert.equal(normalizeRole('chef'),'chef');
  assert.equal(normalizeRole('responsable'),'responsible');
  assert.equal(normalizeRole('tech'),'technician');
  // Un rôle inconnu reste un visiteur : le défaut le plus fermé.
  assert.equal(normalizeRole('directeur-general'),'visitor');
});

test('wall screen model is canonical and responsive',()=>{
  const screen=toCanonicalScreen({id:'4',nom:'Écran 4',deviceLinked:'12',position:{x:10,y:20,w:30,h:40},status:'offline'},{roomId:2,wallId:'wall-2'});
  assert.equal(screen.name,'Écran 4'); assert.equal(screen.wallId,'wall-2'); assert.equal(screen.equipmentId,12); assert.equal(screen.status,'error');
  assert.deepEqual(normalizePosition(screen),{x:10,y:20,width:30,height:40,unit:'%'});
});

test('legacy wall screens are import-only',()=>{
  const {wall,screens}=extractLegacyWallScreens({id:'w1',roomId:1,nom:'Mur',screens:[{id:7,nom:'A'}]});
  assert.equal(wall.screens,undefined); assert.equal(screens[0].wallId,'w1'); assert.equal(screens[0].roomId,1);
});

test('database and UI include canonical wall contracts',async()=>{
  const db=await readFile(new URL('../db.js',import.meta.url),'utf8');
  const admin=await readFile(new URL('../admin-ui.js',import.meta.url),'utf8');
  const map=await readFile(new URL('../interactive-map.js',import.meta.url),'utf8');
  assert.match(db,/this\.version = 14/); assert.match(db,/ensure\('walls'/); assert.match(db,/setCurrentRoomId/);
  assert.match(admin,/Mur d'images/); assert.match(map,/Dessiner la zone du mur/);
});
