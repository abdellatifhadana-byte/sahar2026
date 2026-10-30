import { db } from './db.js';

const CATALOG_KIND = 'equipment_catalog';
const ARTICLE_KIND = 'knowledge_article';

const ROUTING_KNOWLEDGE = [
  {
    id: 'kb-imagine-magellan-rcp64pb-oled',
    kind: CATALOG_KIND,
    targetType: CATALOG_KIND,
    targetId: 'kb-imagine-magellan-rcp64pb-oled',
    manufacturer: 'Imagine Communications / Harris',
    model: 'Magellan RCP-64PB-OLED — à confirmer sur étiquette',
    family: 'Magellan RCP',
    type: 'Panneau de contrôle de routage',
    category: 'Routing / Contrôle',
    verificationStatus: 'to-confirm',
    confidence: 'high',
    observed: true,
    summary: 'Panneau de contrôle 2RU de la famille Magellan utilisé pour sélectionner des destinations et des sources puis exécuter un crosspoint. La façade observée correspond fortement à l’architecture RCP-64PB-OLED (deux afficheurs, deux molettes et matrice de boutons programmables), mais le modèle exact doit être confirmé sur l’étiquette arrière ou latérale.',
    portsNote: 'Les panneaux Magellan communiquent avec le système de routage par le réseau de contrôle et/ou les interfaces prévues par la variante. Relever sur l’instance les connexions réellement utilisées avant de documenter le câblage.',
    sourceNote: 'Observation photo terrain + documentation constructeur Magellan. Ne pas confondre le panneau de commande avec la matrice/router qui effectue physiquement le routage.',
    documentationUrl: 'https://imaginecommunications.com/make-tv/products/production-infrastructure/magellan-control-system/',
    sourceOrigin: 'photo+constructeur',
    origin: 'seed-routing',
    visibility: 'all-non-sensitive',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'kb-article-routing-destination-source-take',
    kind: ARTICLE_KIND,
    targetType: 'routing_principle',
    targetId: 'routing-destination-source-take',
    title: 'Grille / routage logique — Destination → Source → TAKE',
    category: 'Procédure exploitation',
    verificationStatus: 'verified-family',
    confidence: 'high',
    summary: 'Principe opérationnel de routage : sélectionner d’abord la destination à alimenter, puis la source à envoyer vers cette destination, et valider le crosspoint avec TAKE. Les libellés locaux et les index numériques dépendent de la base logique configurée sur le site.',
    procedure: [
      'Passer le panneau en mode DEST / Destination.',
      'Choisir la catégorie de destination puis son index logique.',
      'Valider la destination si la configuration du panneau exige TAKE.',
      'Passer en sélection de source / SRC.',
      'Choisir la catégorie source puis son index logique.',
      'Appuyer sur TAKE pour exécuter le crosspoint.',
      'Vérifier le statut affiché sur le panneau ou le monitoring avant de considérer l’opération terminée.'
    ],
    safetyNote: 'Cette fiche documente le principe de fonctionnement uniquement. La plateforme 2M TECH ne doit pas envoyer de commande réelle vers la grille sans intégration dédiée, contrôle d’accès, confirmation explicite, audit et mécanisme de simulation/lecture seule.',
    sourceNote: 'Principe confirmé par la documentation du système de contrôle Magellan ; les noms internes, catégories et index doivent être saisis dans PostgreSQL par un administrateur et ne doivent pas être codés en dur dans le dépôt public.',
    documentationUrl: 'https://imaginecommunications.com/make-tv/products/production-infrastructure/magellan-control-system/',
    sourceOrigin: 'constructeur+procedure-terrain',
    origin: 'seed-routing',
    visibility: 'all-non-sensitive',
    updatedAt: new Date().toISOString()
  }
];

async function seedRoutingKnowledge() {
  const existing = await db.getAll('docs').catch(() => []);
  const byId = new Map(existing.map(item => [String(item.id), item]));
  for (const item of ROUTING_KNOWLEDGE) {
    const current = byId.get(String(item.id));
    if (current) continue; // Ne jamais écraser une validation ou une correction faite par l’admin.
    await db.save('docs', item);
  }
}

seedRoutingKnowledge().catch(error => console.error('Connaissance routage non initialisée', error));

if (typeof window !== 'undefined') {
  window.addEventListener('central-sync-status', event => {
    if (event.detail?.state === 'synced') seedRoutingKnowledge().catch(() => {});
  });
  window.RoutingKnowledge = Object.freeze({ seed: seedRoutingKnowledge });
}

export { ROUTING_KNOWLEDGE, seedRoutingKnowledge };
