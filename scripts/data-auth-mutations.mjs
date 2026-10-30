/**
 * @file scripts/data-auth-mutations.mjs — la batterie de mutations de DATA-AUTH-01.
 *
 * POURQUOI
 * --------
 * Une garde qu'aucun test ne tue quand on la retire ne garde rien. Chaque mutation
 * ci-dessous rouvre l'un des chemins par lesquels la contradiction `Équipement → Baie →
 * Salle` revenait — ou l'un des contournements qu'on refuse.
 *
 * Usage :  node scripts/data-auth-mutations.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chemin = relatif => path.join(racine, relatif);
const CIBLES = ['tests/equipement-salle-baie.test.js'];

const MUTATIONS = [
  {
    nom: 'D1 · déplacer une baie ne réaligne plus ses équipements',
    pourquoi: 'Le défaut d’origine : la baie déménage, ses équipements gardent l’ancienne salle, et l’autorisation se décide sur une salle où ils ne sont plus.',
    fichier: 'scripts/serve.js',
    de: `            const realignement = await realignEquipmentRoomsForBaie(client, {
              baieId: recordId, roomId: record?.roomId
            });`,
    vers: '            const realignement = { ids: [] };'
  },
  {
    nom: 'D2 · le réalignement sort de la transaction de la baie',
    pourquoi: 'Une panne au milieu laisserait la baie déménagée et une partie de ses équipements dans l’ancienne salle : exactement l’état partiel que le client produisait déjà.',
    fichier: 'scripts/serve.js',
    de: '            const realignement = await realignEquipmentRoomsForBaie(client, {',
    vers: '            const realignement = await realignEquipmentRoomsForBaie(pool, {'
  },
  {
    nom: 'D3 · le réalignement cesse de faire avancer la révision',
    pourquoi: 'Une session restée ouverte sur l’ancienne version réécrirait la salle périmée sans être refusée, et Batch C ne verrait pas passer le changement : l’écran garderait l’ancienne salle.',
    fichier: 'scripts/revision-store.js',
    de: "           to_jsonb(COALESCE((data->>'${REVISION_FIELD}')::int, 0) + 1),",
    vers: "           to_jsonb(COALESCE((data->>'${REVISION_FIELD}')::int, 0)),"
  },
  {
    nom: 'D4 · une baie sans salle réaligne quand même',
    pourquoi: 'Inventer un rattachement fabriquerait une vérité que personne n’a écrite — et effacerait la salle directe d’équipements qu’aucune baie ne situe.',
    fichier: 'scripts/revision-store.js',
    de: "  if (roomId === null || roomId === undefined || roomId === '') return { ok: true, count: 0, ids: [] };",
    vers: '  // garde retirée par la mutation D4'
  },
  {
    nom: 'D5 · le réalignement touche aussi les équipements des autres baies',
    pourquoi: 'Déplacer une baie déplacerait tout l’inventaire : une seule modification suffirait à réécrire la salle de chaque équipement de la plateforme.',
    fichier: 'scripts/revision-store.js',
    de: "     AND data->>'baieId' = $1",
    vers: "     AND ($1 IS NOT NULL)"
  },
  {
    nom: 'D6 · le réalignement ressuscite les fiches supprimées',
    pourquoi: 'Une pierre tombale n’a pas de salle à corriger. La réécrire la ferait remonter dans les instantanés comme une fiche vivante.',
    fichier: 'scripts/revision-store.js',
    de: `   WHERE store_name = 'equipments'
     AND deleted = FALSE`,
    vers: "   WHERE store_name = 'equipments'"
  },
  {
    nom: 'D7 · l’import cesse de dériver la salle de la baie',
    pourquoi: 'Restaurer une sauvegarde ancienne redeviendrait un moyen de réintroduire en une requête toutes les contradictions que l’écriture unitaire refuse.',
    fichier: 'scripts/serve.js',
    de: '          body.data.equipments[index] = applyBaieLocation(record, baie);',
    vers: '          body.data.equipments[index] = record;'
  },
  {
    nom: 'D8 · l’import cesse de vérifier la localisation',
    pourquoi: 'Une baie ou une salle inexistante entrerait sans un mot, et l’équipement disparaîtrait de sa salle, de la carte et du parcours visiteur.',
    fichier: 'scripts/serve.js',
    de: '        for (const record of body.data.equipments) await assertEquipmentLocationExists(record, bootstrapResourceLookup);',
    vers: '        void assertEquipmentLocationExists;'
  },
  {
    nom: 'D9 · l’autorisation retombe sur le `roomId` stocké',
    pourquoi: 'C’est la conséquence qui dépasse l’affichage : une salle périmée accorde l’accès à qui possède l’ANCIENNE salle et le refuse à qui possède la nouvelle.',
    fichier: 'scripts/access-control.js',
    de: `    if (storeName === 'equipments' && record.baieId != null) {
      const baie = await get('baies', record.baieId, client);
      if (baie) return resolveResourceZones('baies', baie, client, depth + 1);
    }

    if (record.roomId !== undefined && record.roomId !== null) return zonesForRoom(record.roomId, client);`,
    vers: `    if (record.roomId !== undefined && record.roomId !== null) return zonesForRoom(record.roomId, client);

    if (storeName === 'equipments' && record.baieId != null) {
      const baie = await get('baies', record.baieId, client);
      if (baie) return resolveResourceZones('baies', baie, client, depth + 1);
    }`
  },
  {
    nom: 'D10 · la dérivation canonique ignore la baie',
    pourquoi: 'La règle « la salle d’un équipement en baie est celle de sa baie » cesserait d’exister, et chaque écrivain retrouverait sa propre vérité.',
    fichier: 'equipment-write-contract.js',
    de: '  if (roomId != null) next.roomId = roomId;',
    vers: '  // dérivation retirée par la mutation D10'
  },
  {
    nom: 'D11 · la dérivation s’applique même à une autre baie',
    pourquoi: 'Un équipement prendrait la salle d’une baie qui n’est pas la sienne : une contradiction remplacée par une autre, plus difficile à voir.',
    fichier: 'equipment-write-contract.js',
    de: "  if (!baie || String(baie.id) !== String(next.baieId)) return next;",
    vers: '  if (!baie) return next;'
  },
  {
    nom: 'D13 · l’écran repousse de nouveau chaque équipement vers le serveur',
    pourquoi: 'Une tempête d’écritures proportionnelle à la taille de la baie, et un 409 par équipement : le serveur vient d’avancer leur révision, et l’écran tient une copie d’avant le déplacement.',
    fichier: 'baies.js',
    de: "            await db.saveLocalOnly('equipments', { ...equipment, roomId: nextRoomId });",
    vers: "            await db.save('equipments', { ...equipment, roomId: nextRoomId, updatedAt: new Date() });"
  },
  {
    nom: 'D12 · un équipement sans baie se fait quand même déplacer',
    pourquoi: 'La salle directe d’un équipement hors baie est légitime. L’écraser effacerait un rattachement que personne n’a demandé de changer.',
    fichier: 'equipment-write-contract.js',
    de: '  if (next.baieId == null) return next;',
    vers: '  if (false) return next;'
  }
];

const lire = fichier => fs.readFileSync(chemin(fichier), 'utf8');
const ecrire = (fichier, contenu) => fs.writeFileSync(chemin(fichier), contenu);

function lancerTests() {
  try {
    execFileSync('node', ['--test', ...CIBLES], { cwd: racine, stdio: 'pipe', timeout: 180000 });
    return { vert: true, sortie: '' };
  } catch (erreur) {
    return { vert: false, sortie: String(erreur.stdout || '') };
  }
}

const tuePar = sortie => (sortie.match(/^not ok \d+ - (.+)$/gm) || [])
  .map(ligne => ligne.replace(/^not ok \d+ - /, ''));

console.log('\n╔═══ mutations DATA-AUTH-01 ═══╗\n');

const reference = lancerTests();
if (!reference.vert) {
  console.log('❌ la suite n’est pas verte AVANT mutation : rien de ce qui suit n’aurait de sens.');
  console.log(tuePar(reference.sortie).join('\n'));
  process.exit(1);
}
console.log('✅ référence verte avant toute mutation\n');

const survivantes = [];
for (const mutation of MUTATIONS) {
  const original = lire(mutation.fichier);
  const occurrences = original.split(mutation.de).length - 1;
  if (occurrences !== 1) {
    console.log(`⚠️  ${mutation.nom} — motif trouvé ${occurrences} fois dans ${mutation.fichier}`);
    survivantes.push({ ...mutation, raison: 'motif ambigu ou absent' });
    continue;
  }
  ecrire(mutation.fichier, original.replace(mutation.de, mutation.vers));
  let resultat;
  try { resultat = lancerTests(); }
  finally { ecrire(mutation.fichier, original); }

  if (resultat.vert) {
    console.log(`❌ SURVIVANTE — ${mutation.nom}`);
    console.log(`   ${mutation.pourquoi}`);
    survivantes.push({ ...mutation, raison: 'aucun test ne la tue' });
  } else {
    const morts = tuePar(resultat.sortie);
    console.log(`✅ tuée — ${mutation.nom}`);
    console.log(`   par ${morts.length} test(s), dont : ${morts.slice(0, 2).join(' · ') || '(échec au chargement)'}`);
  }
}

console.log(`\n╚═══ ${survivantes.length === 0 ? '✅ AUCUNE SURVIVANTE' : `❌ ${survivantes.length} SURVIVANTE(S)`} ═══╝\n`);
process.exit(survivantes.length === 0 ? 0 : 1);
