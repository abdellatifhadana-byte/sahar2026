/**
 * @file scripts/equipment-location-audit.mjs — les équipements dont la salle contredit leur baie.
 *
 * L'INVARIANT
 * -----------
 *     Équipement → Baie → Salle → Localisation
 *
 * Quand un équipement appartient à une baie, sa salle canonique est celle de cette baie. Il
 * ne doit jamais exister durablement `equipment.baieId = B` avec `equipment.roomId ≠ B.roomId`.
 * Un équipement sans baie garde son `roomId` direct : c'est légitime, et ce n'est pas ce que
 * ce contrôle regarde.
 *
 * POURQUOI CE N'EST PAS QU'UNE QUESTION D'AFFICHAGE
 * --------------------------------------------------
 * `access-control.js::resolveResourceZones` résout la zone d'un équipement par son `roomId`
 * AVANT de regarder sa baie. Une salle périmée ne fait donc pas seulement afficher un mauvais
 * libellé : elle décide de l'AUTORISATION. Un équipement déplacé avec sa baie reste visible
 * pour qui possédait l'ancienne salle, et devient invisible pour qui possède la nouvelle.
 *
 * CE QUE FAIT CE SCRIPT
 * ---------------------
 *   sans argument      compte et liste les contradictions, ne modifie rien ;
 *   --corriger         réaligne, et UNIQUEMENT quand la baie rend la salle non ambiguë.
 *
 * Une relation incomplète — baie introuvable, baie sans salle, salle inexistante — n'est
 * JAMAIS devinée. Elle est signalée et laissée telle quelle : inventer un rattachement
 * serait fabriquer une vérité que personne n'a écrite.
 *
 * Usage :
 *   DATABASE_URL=… node scripts/equipment-location-audit.mjs
 *   DATABASE_URL=… node scripts/equipment-location-audit.mjs --corriger
 */
import pg from 'pg';

const corriger = process.argv.includes('--corriger');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL est requis.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 4 });

const lignes = async (texte, parametres = []) => (await pool.query(texte, parametres)).rows;

/*
 * La lecture se fait en une seule requête, côté base : les trois magasins vivent dans la même
 * table `platform_records`, et les rapprocher en JavaScript obligerait à tout télécharger.
 *
 * `deleted` est exclu partout : une pierre tombale n'est pas une contradiction.
 */
const REQUETE = `
  SELECT
    e.record_id                              AS equipement,
    e.data->>'name'                          AS nom,
    e.data->>'baieId'                        AS baie_id,
    e.data->>'roomId'                        AS salle_declaree,
    b.data->>'roomId'                        AS salle_de_la_baie,
    b.data->>'name'                          AS baie_nom,
    (b.record_id IS NULL)                    AS baie_absente,
    (b.data->>'roomId' IS NULL)              AS baie_sans_salle,
    (sb.record_id IS NULL AND b.data->>'roomId' IS NOT NULL) AS salle_de_la_baie_absente
  FROM platform_records e
  LEFT JOIN platform_records b
    ON b.store_name = 'baies' AND b.deleted = FALSE AND b.record_id = e.data->>'baieId'
  LEFT JOIN platform_records sb
    ON sb.store_name = 'rooms' AND sb.deleted = FALSE AND sb.record_id = b.data->>'roomId'
  WHERE e.store_name = 'equipments'
    AND e.deleted = FALSE
    AND e.data->>'baieId' IS NOT NULL
    AND e.data->>'baieId' <> ''
    AND COALESCE(e.data->>'roomId', '') IS DISTINCT FROM COALESCE(b.data->>'roomId', '')
  ORDER BY e.record_id
`;

const trouvees = await lignes(REQUETE);

const reparables = trouvees.filter(ligne =>
  !ligne.baie_absente && !ligne.baie_sans_salle && !ligne.salle_de_la_baie_absente);
const ambigues = trouvees.filter(ligne => !reparables.includes(ligne));

console.log('\n╔═══ salle contre baie — équipements en contradiction ═══╗\n');

const totalEquipements = (await lignes(
  "SELECT count(*)::int AS n FROM platform_records WHERE store_name = 'equipments' AND deleted = FALSE"
))[0].n;
const avecBaie = (await lignes(
  "SELECT count(*)::int AS n FROM platform_records WHERE store_name = 'equipments' AND deleted = FALSE"
  + " AND data->>'baieId' IS NOT NULL AND data->>'baieId' <> ''"
))[0].n;

console.log(`équipements vivants           : ${totalEquipements}`);
console.log(`  dont rattachés à une baie   : ${avecBaie}`);
console.log(`  en contradiction            : ${trouvees.length}`);
console.log(`     réalignables sans doute  : ${reparables.length}`);
console.log(`     relation incomplète      : ${ambigues.length}`);

if (trouvees.length) {
  console.log('\n┌─ le détail ──────────────────────────────────────────────────────────────┐\n');
  console.log(
    'équipement'.padEnd(22) + 'baie'.padEnd(18) + 'salle déclarée'.padEnd(18)
    + 'salle de la baie'.padEnd(18) + 'verdict'
  );
  console.log('─'.repeat(96));
  for (const ligne of trouvees) {
    const verdict = ligne.baie_absente ? 'baie introuvable'
      : ligne.baie_sans_salle ? 'baie sans salle'
      : ligne.salle_de_la_baie_absente ? 'salle de la baie introuvable'
      : 'réalignable';
    console.log(
      String(ligne.equipement).padEnd(22)
      + String(ligne.baie_id ?? '—').padEnd(18)
      + String(ligne.salle_declaree ?? '—').padEnd(18)
      + String(ligne.salle_de_la_baie ?? '—').padEnd(18)
      + verdict
    );
  }
  console.log('\n└──────────────────────────────────────────────────────────────────────────┘');
}

if (!corriger) {
  console.log(trouvees.length
    ? '\nAucune correction appliquée. Relancer avec `--corriger` pour réaligner les cas non ambigus.\n'
    : '\n╚═══ ✅ aucune contradiction ═══╝\n');
  await pool.end();
  process.exit(0);
}

/*
 * LA CORRECTION AVANCE LA RÉVISION, comme n'importe quelle écriture.
 *
 * Sans cela, une session restée ouverte sur l'ancienne version pourrait réécrire la salle
 * périmée sans être refusée : la migration aurait défait ce qu'elle vient de faire. Le
 * compteur `_revision` est celui de Batch B, et il vaut ici comme partout ailleurs.
 */
let corrigees = 0;
for (const ligne of reparables) {
  const resultat = await pool.query(
    `UPDATE platform_records
        SET data = jsonb_set(
              jsonb_set(data, '{roomId}', to_jsonb($2::text), true),
              '{_revision}', to_jsonb(COALESCE((data->>'_revision')::int, 0) + 1), true
            ),
            updated_at = now()
      WHERE store_name = 'equipments' AND deleted = FALSE AND record_id = $1
        AND COALESCE(data->>'roomId', '') IS DISTINCT FROM $2::text`,
    [String(ligne.equipement), String(ligne.salle_de_la_baie)]
  );
  corrigees += resultat.rowCount;
}

console.log(`\n${corrigees} équipement(s) réaligné(s) sur la salle de leur baie.`);
if (ambigues.length) {
  console.log(`${ambigues.length} laissé(s) en l’état : la relation est incomplète, et rien ne doit être inventé.`);
}

const restantes = await lignes(REQUETE);
const restantesReparables = restantes.filter(ligne =>
  !ligne.baie_absente && !ligne.baie_sans_salle && !ligne.salle_de_la_baie_absente);
console.log(restantesReparables.length
  ? `\n╚═══ ❌ ${restantesReparables.length} contradiction(s) réalignable(s) subsistent ═══╝\n`
  : '\n╚═══ ✅ plus aucune contradiction réalignable ═══╝\n');

await pool.end();
process.exit(restantesReparables.length ? 1 : 0);
