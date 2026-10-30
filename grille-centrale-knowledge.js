import { db } from './db.js';
import { ensureEquipmentImageCoverageBatch8 } from './equipment-image-coverage-batch8.js';
import { loadGrilleCentraleDataset } from './grille-centrale-dataset.js';
import { recordsExactlyEqual } from './snapshot-store-plan.js';
import {
  GRILLE_CENTRALE_CATALOG_ID,
  GRILLE_CENTRALE_PUBLIC_IDENTITY_FIELDS,
  GRILLE_CENTRALE_PUBLIC_INVENTORY_FIELDS,
  normalizeGrilleLabel,
  matchesPublicGrilleIdentity,
  declaresForeignCatalogIdentity
} from './grille-centrale-public-identity.js';

/*
 * LES FAITS ET LES PORTS ONT QUITTÉ CE MODULE (#137).
 *
 * `GRILLE_CENTRALE_FACTS` énonçait l'implantation en baie, la numérotation des câbles, les
 * postes de contrôle et les familles de destinations réelles ; `GRILLE_CENTRALE_PORTS`
 * portait les repères de câbles et les sorties monitoring. Servis en clair, ils décrivaient l'installation à qui savait ouvrir un
 * fichier .js. Ils arrivent maintenant par l'endpoint protégé.
 *
 * `CATALOG_ID` reste public : c'est la clé qui relie une fiche d'équipement à son modèle,
 * et c'est elle que le serveur utilise pour résoudre le périmètre.
 */
export const GRILLE_CENTRALE_KNOWLEDGE_VERSION = 2;
export { GRILLE_CENTRALE_CATALOG_ID };
const CATALOG_ID = GRILLE_CENTRALE_CATALOG_ID;
const REVIEWED_AT = '2026-08-16';

/*
 * LE NOM, ET RIEN QUE LE NOM.
 *
 * La liste publique portait le nom suivi de la capacité de la matrice.
 * Ne restent ici que les formes du nom sous lesquelles l'inventaire désigne l'appareil :
 * qui voit la fiche d'équipement voit déjà ce nom. La liste complète, capacités comprises,
 * arrive avec le jeu de données autorisé et sert au rapprochement fin.
 */
export const GRILLE_CENTRALE_ALIASES = Object.freeze(['GRILLE CENTRALE', 'Grille Centrale']);

const asArray = value => Array.isArray(value) ? value : [];
const normalize = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,' ')
  .trim()
  .replace(/\s+/g,' ');

function mergeById(current, incoming) {
  const merged = new Map();
  for (const item of [...asArray(current), ...asArray(incoming)]) {
    const key = String(item?.id || item?.number || item?.label || '').trim();
    if (!key) continue;
    merged.set(key, { ...(merged.get(key) || {}), ...item });
  }
  return [...merged.values()];
}

/*
 * Les preuves terrain se recoupent sur `assetId` + `zone`, PAS sur `id`.
 *
 * `mergeById` ne connaît que `id`/`number`/`label` : appliqué ici, il aurait vu une clé vide
 * pour chaque preuve et les aurait toutes écartées en silence — l'hydratation autorisée
 * n'aurait rien rendu. Une même photo peut documenter deux zones ; la paire les distingue.
 */
function mergeFieldEvidence(current, incoming) {
  const merged = new Map();
  for (const item of [...asArray(current), ...asArray(incoming)]) {
    const key = `${item?.assetId ?? ''}|${item?.zone ?? ''}`;
    if (key === '|') continue;
    merged.set(key, { ...(merged.get(key) || {}), ...item });
  }
  return [...merged.values()];
}

function mergeAliases(current, incoming) {
  const values = new Map();
  for (const value of [...asArray(current), ...asArray(incoming)]) {
    const key = normalize(value);
    if (!key || values.has(key)) continue;
    values.set(key, String(value).trim());
  }
  return [...values.values()];
}

function mergeImages(current, incoming) {
  const merged = new Map();
  for (const image of [...asArray(current), ...asArray(incoming)]) {
    const key = String(image?.url || '').trim();
    if (!key) continue;
    merged.set(key, { ...(merged.get(key) || {}), ...image });
  }
  return [...merged.values()];
}

/**
 * Cette fiche EST-ELLE la Grille ? — CE MODULE POSE LE LIEN CANONIQUE CÔTÉ CLIENT (#166).
 *
 * C'est lui qui écrit `catalogId` sur une fiche d'inventaire reconnue : sa réponse décide
 * donc de ce que les quatre panneaux verront ensuite. Il portait sa PROPRE liste de champs,
 * et c'était exactement celle de `grille-centrale-topology.js` avant la revue 4 — sept
 * valeurs, sans `reference` racine. Une cinquième copie de la même règle, déjà divergente.
 *
 * Le contrat public répond d'abord — la fonction même des quatre panneaux et du serveur.
 * Ce module en sait ensuite PLUS qu'eux, et c'est délibéré : le jeu de données AUTORISÉ lui
 * remet les libellés documentés, capacité comprise, qui ne peuvent pas vivre dans un actif
 * servi sans session (#137). Il les ajoute donc — mais sur LA MÊME liste de champs et LA
 * MÊME normalisation. Ce sont les listes qui divergeaient, pas l'étendue des alias.
 */
function exactGridMatch(equipment = {}, extraAliases = []) {
  if (matchesPublicGrilleIdentity(equipment)) return true;
  /*
   * La préséance du contrat public vaut AUSSI pour les libellés documentés : une fiche qui
   * revendique un autre modèle de catalogue n'est pas la Grille, quel que soit son libellé.
   * Sans ce verrou, ce module poserait les faits et les ports de la Grille sur l'appareil de
   * quelqu'un d'autre (#166).
   */
  if (declaresForeignCatalogIdentity(equipment)) return false;
  const source = equipment?.inventorySource;
  const values = [
    ...GRILLE_CENTRALE_PUBLIC_IDENTITY_FIELDS.map(champ => equipment?.[champ]),
    ...GRILLE_CENTRALE_PUBLIC_INVENTORY_FIELDS.map(champ => source?.[champ])
  ].map(normalizeGrilleLabel).filter(Boolean);
  const aliases = new Set(asArray(extraAliases).map(normalizeGrilleLabel));
  return values.some(value => aliases.has(value));
}

function adminLocked(record) {
  return record?.origin === 'admin'
    || record?.imageResearch?.origin === 'admin'
    || record?.imageResearch?.locked === true;
}

/**
 * Enrichit le catalogue et les fiches d'équipement — seulement si le jeu de données est dû.
 *
 * Sans autorisation, aucune écriture : ni catalogue, ni équipement. Le module reste chargé,
 * il ne fait simplement rien.
 */
export async function ensureGrilleCentraleKnowledge({ revalidate = false, ouverture = null } = {}) {
  const dataset = await loadGrilleCentraleDataset({ revalidate, ouverture });
  if (!dataset) return { authorized:false, version:GRILLE_CENTRALE_KNOWLEDGE_VERSION, catalogUpdated:false, equipmentUpdated:0 };
  const seed = dataset.knowledgeSeed;
  await ensureEquipmentImageCoverageBatch8();
  await db.open();

  const catalog = await db.get('docs', CATALOG_ID).catch(() => null);
  let catalogUpdated = false;
  if (catalog && !adminLocked(catalog)) {
    /*
     * LA PREUVE TERRAIN A PRÉSÉANCE SUR L'HYPOTHÈSE DOCUMENTAIRE (#166).
     *
     * Deux producteurs écrivent les MÊMES champs de cette fiche, avec deux forces
     * différentes, et chacun défaisait l'autre à chaque consultation :
     *
     *   `field-evidence-integration.js`  hardwareFamilyCandidateStatus: field-photo-confirmed
     *   `grille-centrale-knowledge.js`   hardwareFamilyCandidateStatus: capacity-compatible-hypothesis
     *
     * Mesuré sur la vraie fiche 360 de la Grille, 10 ouvertures, aucun geste utilisateur :
     * 154 écritures locales, dont 78 sur ce seul aller-retour — le même défaut de
     * précédence que #98 a corrigé trois fois ailleurs. Il ne pouvait pas se voir tant que
     * le jeu de données n'était autorisé pour personne : les deux producteurs rendaient la
     * main avant d'écrire.
     *
     * L'ORDRE EST CELUI DE LA PREUVE, PAS CELUI DU CODE. La photo terrain `2m-field-06`
     * lit « PLATINUM | Harris » sur la façade : elle CONFIRME ce que le synoptique ne
     * faisait qu'avancer. Réaffirmer l'hypothèse par-dessus la confirmation, c'est perdre
     * une preuve. Le seed documentaire pose donc la base, et s'efface ensuite.
     *
     * Les champs concernés ne sont pas recopiés ici : ils sont DÉDUITS du jeu de données
     * autorisé lui-même (`fieldPhotoConfirmation`), pour qu'une évolution de celui-ci n'ait
     * pas à être répercutée à la main dans ce module.
     */
    const confirmation = seed.fieldPhotoConfirmation || null;
    const dejaConfirme = Boolean(confirmation && catalog.fieldHardwareConfirmation);
    const champsConfirmes = dejaConfirme
      ? Object.fromEntries(Object.keys(confirmation.catalogFields)
          .filter(cle => cle !== 'imageResearchReason' && cle in catalog)
          .map(cle => [cle, catalog[cle]]))
      : {};
    const next = {
      ...catalog,
      inventoryAliases:mergeAliases(catalog.inventoryAliases, seed.aliases),
      /*
       * LA FICHE CATALOGUE SE COMPLÈTE ICI, PAS DANS LE SEED PUBLIC (#142).
       *
       * `catalogSeed` porte la capacité, l'implantation, les plages non documentées et la
       * zone ; `projectEvidence` et `identificationChecklist` portent ce que la fiche 360
       * affichait depuis un module public. Rien de tout cela n'existe avant cette ligne :
       * sans jeu de données autorisé, `ensureGrilleCentraleKnowledge` a déjà rendu la main.
       */
      ...(seed.catalogSeed || {}),
      ...(seed.projectEvidence ? { projectEvidence:seed.projectEvidence } : {}),
      ...(seed.identificationChecklist ? { identificationChecklist:seed.identificationChecklist } : {}),
      ...seed.catalogFields,
      // Ce qui a été confirmé sur le terrain reprend sa place, après le seed documentaire.
      ...champsConfirmes,
      technicalFacts:mergeById(
        mergeById(catalog.technicalFacts, seed.facts),
        dejaConfirme ? confirmation.catalogFacts : []
      ),
      ports:mergeById(catalog.ports, seed.ports),
      candidateImages:mergeImages(catalog.candidateImages, seed.candidateImages),
      evidenceImageRefs:seed.evidenceImageRefs,
      imageResearch:{
        ...(catalog.imageResearch || {}),
        status:catalog.officialImage?.url ? catalog.imageResearch?.status : 'model-required',
        modelRequired:!catalog.officialImage?.url,
        reason:dejaConfirme ? confirmation.catalogFields.imageResearchReason : seed.catalogFields.imageResearchReason,
        candidateSourceTrust:'trusted-broadcast-reseller',
        candidateModelMatch:'capacity-compatible-family-example',
        candidateRequiresFieldConfirmation:true,
        candidateMatchNote:seed.candidateImages[0]?.matchNote,
        evidenceImageRefs:seed.evidenceImageRefs,
        reviewedAt:REVIEWED_AT
      },
      grilleCentraleKnowledgeVersion:GRILLE_CENTRALE_KNOWLEDGE_VERSION,
      grilleCentraleKnowledgeUpdatedAt:REVIEWED_AT
    };
    if (!recordsExactlyEqual(next, catalog)) {
      await db.save('docs', next);
      catalogUpdated = true;
    }
  }

  /*
   * Les fiches LIÉES reçoivent leurs preuves d'implantation par la même porte.
   *
   * `kb-imagine-platinum-vx` en portait une en clair dans le bundle public. Elle est écrite
   * ici, avec le même jeu de données autorisé, plutôt que d'être répartie dans un second
   * producteur : une seule autorisation, un seul chemin.
   */
  let relatedUpdated = 0;
  for (const [relatedId, evidence] of Object.entries(seed.relatedCatalogEvidence || {})) {
    const related = await db.get('docs', relatedId).catch(() => null);
    if (!related || adminLocked(related)) continue;
    const next = { ...related, projectEvidence:evidence, grilleCentraleKnowledgeVersion:GRILLE_CENTRALE_KNOWLEDGE_VERSION };
    if (recordsExactlyEqual(next, related)) continue;
    await db.save('docs', next);
    relatedUpdated += 1;
  }

  /*
   * Les preuves TERRAIN propres à la Grille rejoignent leurs fiches (#142).
   *
   * `equipment-field-evidence.js` les portait en clair — alias de capacité, implantation des
   * baies d'entrée, de sortie et de contrôle — dans un module servi à la racine, qu'aucune
   * garde n'atteignait. Elles reviennent ici, par la même autorisation que le reste, et
   * jamais avant elle. Un commentaire se télécharge comme le code : celui-ci ne nomme donc
   * aucune des valeurs qu'il déplace.
   */
  let fieldEvidenceUpdated = 0;
  for (const [catalogId, patch] of Object.entries(seed.fieldEvidencePatches || {})) {
    const target = await db.get('docs', catalogId).catch(() => null);
    if (!target || adminLocked(target)) continue;
    const next = {
      ...target,
      ...(patch.inventoryAliases ? { inventoryAliases:mergeAliases(target.inventoryAliases, patch.inventoryAliases) } : {}),
      ...(patch.fieldEvidenceImages ? { fieldEvidenceImages:mergeFieldEvidence(target.fieldEvidenceImages, patch.fieldEvidenceImages) } : {}),
      grilleCentraleKnowledgeVersion:GRILLE_CENTRALE_KNOWLEDGE_VERSION
    };
    if (recordsExactlyEqual(next, target)) continue;
    await db.save('docs', next);
    fieldEvidenceUpdated += 1;
  }

  const equipments = await db.getAll('equipments');
  let equipmentUpdated = 0;
  for (const equipment of equipments) {
    if (String(equipment.catalogId || '') !== CATALOG_ID && !exactGridMatch(equipment, seed.aliases)) continue;
    /*
     * LES FAITS ET LES PORTS DOCUMENTÉS DE LA GRILLE NE SONT PAS CEUX DE LA FICHE (#166).
     *
     * Deux champs de l'équipement sont SOUS CONTRAT, et le seed de la Grille parle une
     * autre langue dans les deux cas. Le serveur rejetait donc l'écriture entière — deux
     * fois, pour deux raisons distinctes, mesurées l'une après l'autre.
     *
     * `technicalFacts` est un champ SOUS CONTRAT : `equipment-knowledge-contract.js` n'y
     * accepte qu'une entrée portant une `key` appartenant aux profils déclarés
     * (`installedMatrix`, `rackPosition`, `syncReferences`, …). Les faits de la Grille sont
     * d'une autre forme — `{ id, label, value, verificationStatus, source }` — et n'ont
     * jamais porté de `key`. Le serveur les rejetait donc TOUS, et rejetait l'écriture avec
     * eux.
     *
     * Ce défaut ne pouvait pas se voir tant qu'aucun équipement Grille n'existait : la
     * boucle ne trouvait personne à enrichir. Mesuré dès que la fiche canonique existe,
     * base neuve, session administrateur, sans le moindre geste utilisateur :
     *
     *     PUT /api/data/equipments/‹fiche canonique› → 400 INVALID_EQUIPMENT_KNOWLEDGE
     *     « Une donnée technique contient une clé, une source ou une valeur non autorisée »
     *     17 entrées `failed` empilées dans `syncQueue`, rejouées sans fin.
     *
     *     validateEquipmentKnowledge({ technicalFacts: seed.facts }) → 0 fait retenu / 16.
     *
     * Le correctif posé, un SECOND rejet est apparu, de même nature :
     *
     *     PUT … → 400 « Direction invalide pour le port « SYNCH 4 ». »
     *
     * `connectivity-contract.js` n'admet que `IN`, `OUT`, `IN/OUT` ; les ports de la Grille
     * portent le vocabulaire de la TOPOLOGIE — `INPUT`, `OUTPUT`, `INTERNAL` pour le TDM
     * SYNC, `CONTROL` pour XY/ENET/SERIAL. Ce ne sont pas des ports de brassage, ce sont
     * des interfaces documentées.
     *
     * Rien n'est perdu dans les deux cas — ni les faits ni les ports n'étaient JAMAIS
     * arrivés dans les champs sous contrat : l'un les écartait un par un, l'autre refusait
     * l'écriture entière. Ils rejoignent ici les champs que la Grille possède déjà, à côté
     * de sa version ; la fiche 360 les lit du jeu de données autorisé, pas de cette copie.
     * Aucune clé ni direction de contrat n'est inventée pour les y faire entrer : donner
     * `rackPosition` à une implantation ou `IN/OUT` à un port de contrôle serait un choix
     * de mapping, pas une preuve, et #166 n'en demande aucun.
     */
    const next = {
      ...equipment,
      catalogId:equipment.catalogId || CATALOG_ID,
      grilleCentraleFacts:mergeById(equipment.grilleCentraleFacts, seed.facts),
      grilleCentralePorts:mergeById(equipment.grilleCentralePorts, seed.ports),
      grilleCentraleKnowledgeVersion:GRILLE_CENTRALE_KNOWLEDGE_VERSION,
      grilleCentraleKnowledgeUpdatedAt:REVIEWED_AT
    };
    if (recordsExactlyEqual(next, equipment)) continue;
    await db.save('equipments', next);
    equipmentUpdated += 1;
  }

  if (equipmentUpdated && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('equipment-media-linkage-updated', { detail:{ equipmentLinked:equipmentUpdated, source:'grille-centrale-knowledge' } }));
  }
  return { version:GRILLE_CENTRALE_KNOWLEDGE_VERSION, catalogUpdated, equipmentUpdated, relatedUpdated, fieldEvidenceUpdated, catalogFound:Boolean(catalog) };
}

let timer = null;
function schedule(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(() => ensureGrilleCentraleKnowledge().catch(error => console.warn('Connaissance Grille Centrale indisponible', error)), delay);
}

if (typeof window !== 'undefined') {
  window.GrilleCentraleKnowledge = Object.freeze({
    version:GRILLE_CENTRALE_KNOWLEDGE_VERSION,
    ensure:ensureGrilleCentraleKnowledge
  });
  window.addEventListener('inventory-master-imported', () => schedule());
  window.addEventListener('central-sync-status', event => { if (event.detail?.state === 'synced') schedule(); });
  await ensureGrilleCentraleKnowledge().catch(error => console.warn('Connaissance Grille Centrale non installée', error));
  schedule(1500);
}
