import { db } from './db.js';
import { withCatalogEnrichmentGate } from './catalog-enrichment-gate.js';

const item = (id, manufacturer, model, type, category, aliases, extra = {}) => ({
  id, manufacturer, model, family:extra.family || model, type, category,
  verificationStatus:extra.verificationStatus || 'to-confirm', confidence:extra.confidence || 'medium', observed:false,
  summary:extra.summary || `Référence issue de l’inventaire 2M. Le modèle exact et la connectique doivent être confirmés sur site.`,
  sourceNote:extra.sourceNote || `Inventaire Excel 2M : ${aliases.join(' / ')}.`, sourceOrigin:extra.sourceOrigin || 'excel',
  inventoryAliases:aliases, ...(extra.documentationUrl ? { documentationUrl:extra.documentationUrl } : {}), ...(extra.portsNote ? { portsNote:extra.portsNote } : {})
});

export const GAP_EQUIPMENT_CATALOG = Object.freeze([
  item('kb-gap-monitor-it24','À confirmer','Moniteur IT 24 pouces — modèle à confirmer','Moniteur informatique','Affichage / Moniteurs',['Moniteur IT 24"'],{ summary:'Moniteur IT 24 pouces dont le constructeur et le modèle ne sont pas fournis par l’inventaire.' }),
  item('kb-gap-grid72-panel32','À confirmer','Clavier Grille 72 — 32 boutons','Panneau / clavier de routing','Routing / Contrôle',['Clavier Grille 72 – 32 boutons','Clavier Grille 72 - 32 buttons','Clavier Grille 72 - 32 boutons']),
  item('kb-gap-grid72-panel48','À confirmer','Clavier Grille 72 — 48 boutons','Panneau / clavier de routing','Routing / Contrôle',['Clavier Grille 72 – 48 boutons','Clavier Grille 72 - 48 boutons']),
  item('kb-swit-monitor21-family','SWIT Electronics','Moniteur 21/21.5 pouces — modèle à confirmer','Moniteur vidéo broadcast','Affichage / Moniteurs',['SWIT 21"','SWIT  21"'],{ family:'SWIT Studio Monitor', summary:'Moniteur SWIT d’environ 21 pouces. La diagonale ne suffit pas pour déduire la référence exacte; celle-ci doit être lue sur la plaque arrière.' }),
  item('kb-gap-quad-av-matrix','À confirmer','Quad AV Matrix — modèle à confirmer','Multiviewer / matrice AV','Contrôle / Mesure / Monitoring',['Quad AV Matrix','Quad AV matrix']),
  item('kb-gap-sdi-hdmi-converter','À confirmer','Convertisseur SDI vers HDMI — modèle à confirmer','Convertisseur vidéo','Vidéo / Broadcast',['Convertisseur SDI to HDMI','Convertisseur SDI → HDMI']),
  item('kb-gap-gpi-box','À confirmer','Boîtier GPI — modèle à confirmer','Interface GPI / contrôle','Routing / Contrôle',['Boîtier GPI']),
  item('kb-titan-usb8comirm','TITAN Electronics','USB-8COMi-RM','Adaptateur USB vers 8 ports série','Réseau / IT',['Boîtier USB COM (USB-8COMI-RM)','USB-8COMI-RM','USB-8COMi-RM'],{
    family:'USB Industrial Serial Adapter',verificationStatus:'verified',confidence:'high',sourceOrigin:'excel+manufacturer',
    summary:'Adaptateur rackable USB vers huit ports série configurables RS-232/422/485.',
    documentationUrl:'https://www.titan.tw/product/usb-8comi-rm/',
    portsNote:'Documentation constructeur : USB 2.0 Type-B côté hôte et 8 connecteurs DB9 mâles pour RS-232/422/485. Le mode effectivement utilisé par chaque port reste à relever.'
  }),
  item('kb-wohler-amp1a-lp','Wohler Technologies','AMP1A-LP — variante exacte à confirmer','Moniteur audio','Audio / Monitoring',['AMP1A-LP'],{ family:'AMP1A' }),
  item('kb-wohler-lm30-4','Wohler Technologies','LM30-4 — à confirmer sur étiquette','Analyseur / indicateur audio','Audio / Monitoring',['LM30-4'],{ family:'LM Series' }),
  item('kb-gap-sescom-vu','Sescom','VU-mètre — modèle à confirmer','VU-mètre / mesure audio','Audio / Monitoring',['SESCOM']),
  item('kb-gap-selector-panel','À confirmer','Platine clavier sélecteur — modèle à confirmer','Panneau de sélection','Routing / Contrôle',['platine clavier seleteur']),
  item('kb-gap-changeover','À confirmer','Change Over — modèle à confirmer','Commutateur de secours','Synchronisation / Référence',['Change Over']),
  item('kb-gap-splitter-automation','À confirmer','Splitter Automation — modèle à confirmer','Splitter / distribution automation','Routing / Contrôle',['Splitter Automation']),
  item('kb-gap-fibre-mm-sfp','À confirmer','Jarretières fibre multimode + modules SFP — quantité à confirmer','Accessoire fibre / module optique','Câblage / Fibre',['Jarretière Fibre optique MultiMode + Modules SFP -','Jarretière Fibre optique MultiMode + Modules SFP -'],{ summary:'Lot regroupant jarretières fibre multimode et modules SFP. Il reste un accessoire/lot tant que références SFP, longueurs et quantités ne sont pas relevées.' }),
  item('kb-wohler-vm2a','Wohler Technologies','VM-2A — à confirmer sur étiquette','Monitoring audio','Audio / Monitoring',['VM-2A'],{ family:'VM Series' }),
  item('kb-gap-streaming-speaker','À confirmer','Haut-parleur Streaming — modèle à confirmer','Haut-parleur / monitoring','Audio / Monitoring',['haut-parleur Streaming'],{ confidence:'low', summary:'La valeur 21 pouces relevée dans la colonne quantité est traitée comme anomalie de saisie, pas comme caractéristique produit.' })
]);

async function runGapCatalogSeedCore() {
  await db.open();
  for (const source of GAP_EQUIPMENT_CATALOG) {
    const existing = await db.get('docs',source.id).catch(() => null);
    if (existing) continue;
    await db.save('docs',{
      ...source,kind:'equipment_catalog',targetType:'equipment_catalog',targetId:source.id,
      origin:'seed-gap',visibility:'all-non-sensitive',updatedAt:'2026-08-15',
      verifiedAt:source.verificationStatus === 'verified' ? '2026-08-15' : null
    });
  }
  return GAP_EQUIPMENT_CATALOG.length;
}

/*
 * UN SEUL PASSAGE EN COURS (#98) — voir catalog-enrichment-gate.js.
 *
 * Ce module ne remplace jamais un enregistrement existant (`if (existing) continue`),
 * mais deux passages concurrents pouvaient tous deux lire « absent » sur le même id
 * avant que l'un des deux n'ait fini d'écrire, puis tenter chacun sa propre création —
 * la seconde création arrivant sur un enregistrement que la première venait de poser.
 * `equipment-image-coverage-batch6.js` rappelle ce module en plus de son propre
 * déclenchement ci-dessous.
 */
let vol = null;
export function ensureGapCatalogSeed() {
  if (vol) return vol;
  vol = withCatalogEnrichmentGate(runGapCatalogSeedCore).finally(() => { vol = null; });
  return vol;
}

if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  ensureGapCatalogSeed().catch(error => console.warn('Catalogue gap seed non installé:',error));
}
