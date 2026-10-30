// Vérification STRUCTURELLE : imports, exports, appels, écouteurs, magasins, routes.
// On ne lit pas le code — on construit le graphe et on cherche ce qui pend dans le vide.
import fs from 'node:fs';
import path from 'node:path';

// Les commentaires de ce dépôt CITENT abondamment ce qu'ils expliquent : deux commentaires
// disant « ce magasin `rapports` n'a jamais existé » suffisaient à faire signaler un magasin
// `rapports` manquant. Un contrôle qui accuse le commentaire qui documente le correctif est
// pire qu'inutile. On analyse donc le code seul.
const sansCommentaires = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(ligne => /^\s*(\/\/|\*)/.test(ligne) ? '' : ligne)
  .join('\n');

const lire = fichier => sansCommentaires(fs.readFileSync(fichier, 'utf8'));

const html = fs.readFileSync('index.html', 'utf8');
const entrees = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map(m => m[1]);

const actifs = new Set();
const file = [...entrees];
while (file.length) {
  const rel = file.shift().replace(/^\.\//, '').split('?')[0];
  if (actifs.has(rel) || !fs.existsSync(rel)) continue;
  actifs.add(rel);
  const source = lire(rel);
  const dir = path.dirname(rel);
  for (const m of source.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
    let cible = path.normalize(path.join(dir, m[1]));
    if (!fs.existsSync(cible) && fs.existsSync(cible + '.js')) cible += '.js';
    file.push(cible);
  }
  for (const m of source.matchAll(/import\(\s*['"](\.?\/?[^'"]+)['"]/g)) {
    const brut = m[1].replace(/^\//, '');
    file.push(fs.existsSync(brut) ? brut : path.normalize(path.join(dir, m[1])));
  }
}

const sources = new Map([...actifs].filter(f => /\.js$/.test(f)).map(f => [f, lire(f)]));
const probs = { importsCasses: [], exportsManquants: [], magasinsInconnus: [], evenementsOrphelins: [], routesOrphelines: [], justificationsPerimees: [] };

// 1. Chaque import nommé existe-t-il vraiment dans le module cible ?
const exportsDe = source => {
  const set = new Set();
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const nom = part.trim().split(/\s+as\s+/).pop().trim();
      if (nom) set.add(nom);
    }
  }
  if (/export\s+default/.test(source)) set.add('default');
  return set;
};
const cacheExports = new Map();
for (const [fichier, source] of sources) {
  const dir = path.dirname(fichier);
  for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    let cible = path.normalize(path.join(dir, m[2]));
    if (!fs.existsSync(cible) && fs.existsSync(cible + '.js')) cible += '.js';
    if (!fs.existsSync(cible)) { probs.importsCasses.push(`${fichier} → ${m[2]}`); continue; }
    if (!cacheExports.has(cible)) cacheExports.set(cible, exportsDe(fs.readFileSync(cible, 'utf8')));
    const dispo = cacheExports.get(cible);
    for (const part of m[1].split(',')) {
      const nom = part.trim().split(/\s+as\s+/)[0].trim();
      if (nom && !dispo.has(nom)) probs.exportsManquants.push(`${fichier} importe « ${nom} » de ${path.basename(cible)} — absent`);
    }
  }
}

// 2. Chaque magasin lu/écrit existe-t-il dans le schéma ?
const dbSource = fs.readFileSync('db.js', 'utf8') + [...actifs].filter(f => /migration/.test(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n');
const magasins = new Set([...dbSource.matchAll(/ensure\('([^']+)'|createObjectStore\('([^']+)'/g)].map(m => m[1] || m[2]));
// Certains magasins sont créés dans une boucle : `for (const name of ['notes','docs','faq']) ensure(name, …)`
for (const m of dbSource.matchAll(/for \(const \w+ of \[([^\]]+)\]\)\s*ensure\(/g)) {
  for (const nom of m[1].split(',')) magasins.add(nom.trim().replace(/['"]/g, ''));
}
const utilises = new Set();
for (const [, source] of sources) {
  for (const m of source.matchAll(/db\.(?:save|get|getAll|delete|saveLocalOnly|_getRaw|_deleteRaw)\(\s*['"]([a-z_]+)['"]/g)) utilises.add(m[1]);
}
for (const nom of utilises) if (!magasins.has(nom)) probs.magasinsInconnus.push(nom);

// 3. Événements : chaque `dispatch` a-t-il un auditeur, et inversement ?
const emis = new Set(); const ecoutes = new Set();
for (const [, source] of sources) {
  for (const m of source.matchAll(/eventSystem\.dispatch\(\s*['"]([^'"]+)['"]/g)) emis.add(m[1]);
  // `this.register(...)` : à l'intérieur de la classe EventSystem, l'enregistrement ne passe
  // pas par la variable `eventSystem`. Le manquer faisait passer `show-notification` pour
  // orphelin alors que son gestionnaire est juste au-dessus, dans le même fichier.
  for (const m of source.matchAll(/(?:eventSystem|this)\.register\(\s*['"]([^'"]+)['"]/g)) ecoutes.add(m[1]);
  for (const m of source.matchAll(/new CustomEvent\(\s*['"]([^'"]+)['"]/g)) emis.add(m[1]);
  for (const m of source.matchAll(/addEventListener\(\s*['"]([a-z-]+[a-z0-9-]*)['"]/g)) ecoutes.add(m[1]);
}
const natifs = new Set(['click','change','input','submit','keydown','keyup','mousedown','mouseup','mousemove','online','offline','focus','blur','resize','load','error','scroll','visibilitychange','contextmenu','dragstart','drop','dragover','touchstart','touchmove','touchend','wheel','paste','beforeunload','pageshow','pagehide','popstate','hashchange','message','DOMContentLoaded','transitionend','animationend']);

// ANNONCES VÉRIFIÉES
//
// Un événement sans auditeur n'est un défaut que si RIEN d'autre ne porte l'information
// jusqu'à l'écran. Chacune des annonces ci-dessous a été ouverte et vérifiée : elle est
// émise juste après une mise à jour d'affichage, ou juste avant que la même donnée soit
// retournée à l'appelant qui l'affiche. Le travail n'est donc pas perdu.
//
// Le contre-exemple est instructif : `backup-created` et `auto-backup-completed` partent
// d'une MINUTERIE, sans appelant et sans rendu — la plateforme sauvegardait sans jamais
// le montrer. Ils ont désormais un gestionnaire dans system-settings.js.
//
// Cette liste n'endort pas le contrôle : un événement nouveau reste signalé, et une
// justification devenue périmée — événement disparu, ou pourvu d'un auditeur — l'est aussi.
const ANNONCES_VERIFIEES = new Map([
  // `central-catalog-installed` a QUITTÉ cette liste : `signal-spine.js` l'écoute désormais
  // pour recompter la chaîne du signal après l'installation du catalogue. La justification
  // « le miroir est déjà à jour » n'avait plus lieu d'être, et le contrôle l'a signalé.
  ['platform-data-visible', 'émis après ui.loadData() puis render() : l’écran vient d’être refait'],
  ['platform-canonical-data-changed', 'émis après MapDigitalTwin.refresh()'],
  ['equipment-record-normalized', 'émis après l’écriture, et relayé en CustomEvent sur window'],
  ['kb-port-template-empty', 'le message d’explication est posé dans le DOM juste après'],
  ['grille-centrale-topology-updated', 'émis juste avant le `return` du même instantané'],
  ['screen-diagnosis-completed', 'suivi de showNotification() puis refreshView()'],
  ['screen-quick-action-requested', 'action enregistrée en base, journalisée, puis notifiée'],
  ['wall-data-changed', 'chaque appelant enchaîne notify() puis renderCurrentWall() ; les vues dérivées passent par refreshOpenDerivedViews'],
  ['grille-centrale-field-verification-updated', 'émis juste avant le `return` du même instantané'],
  ['field-evidence-intake-updated', 'émis juste après db.save(), avant le `return` du même enregistrement'],
  ['regie-car-phase16-updated', 'émis juste avant le `return` du même résultat'],
  ['regie-car-prephoto-ready', 'émis juste avant le `return` du même résultat'],
  ['data-integrity-checked', 'le rapport est retourné à l’appelant, qui l’affiche']
]);

for (const nom of emis) {
  if (ecoutes.has(nom) || natifs.has(nom) || ANNONCES_VERIFIEES.has(nom)) continue;
  probs.evenementsOrphelins.push(nom);
}
for (const [nom] of ANNONCES_VERIFIEES) {
  if (!emis.has(nom)) probs.justificationsPerimees.push(`${nom} — n’est plus émis`);
  else if (ecoutes.has(nom)) probs.justificationsPerimees.push(`${nom} — a désormais un auditeur`);
}

// 4. Routes déclarées vs sections réellement fournies
//
// La version précédente moissonnait TOUTE chaîne entre apostrophes de navigation-contract.js
// et signalait six routes orphelines — dont `string`, venu d'un `typeof x === 'string'`, et
// `issues`, qui est un segment d'URL (`screens/issues`) et non une section. Six fausses
// alertes sur cette question précise rendaient le contrôle inutilisable : on finissait par
// l'ignorer, et une vraie divergence serait passée avec.
//
// On lit désormais les listes par rôle dans ROLE_ROUTES, et on les compare aux sections
// telles qu'elles s'enregistrent : toute section est un `{ title, icon, component }`.
if (fs.existsSync('navigation-contract.js')) {
  const nav = lire('navigation-contract.js');
  const listeDeRole = role => {
    const bloc = nav.match(new RegExp(`${role}\\s*:\\s*Object\\.freeze\\(\\[([^\\]]*)\\]`));
    return bloc ? [...bloc[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
  };
  const motifsSection = [
    /([A-Za-z][A-Za-z0-9]*)\s*:\s*\{\s*title\s*:[^}]{0,140}?icon\s*:/g,
    /\.([A-Za-z][A-Za-z0-9]*)\s*=\s*\{\s*title\s*:[^}]{0,180}?icon\s*:/g
  ];
  const sectionsDe = predicat => {
    const trouvees = new Set();
    for (const [fichier, source] of sources) {
      if (!predicat(fichier)) continue;
      for (const motif of motifsSection) for (const m of source.matchAll(motif)) trouvees.add(m[1]);
    }
    return trouvees;
  };

  const admin = sectionsDe(f => !/responsible-ui\.js$/.test(f));
  for (const route of listeDeRole('admin')) if (!admin.has(route)) probs.routesOrphelines.push(`admin/${route}`);
  for (const section of admin) if (!listeDeRole('admin').includes(section)) probs.routesOrphelines.push(`admin/${section} (fournie, non déclarée)`);

  // Le responsable se voit retirer `users` et ajouter `zoneAccess` par zone-access-integration.
  //
  // Son registre ne tient PAS dans `responsible-ui.js` : quatre modules posent une section
  // de plus sur `ResponsibleUI.prototype.renderBaseLayout` après coup — exactement comme
  // huit modules le font pour l'administrateur. Ne lire que la coque revenait à comparer le
  // contrat à la moitié du registre, et à signaler comme orphelines quatre routes que le
  // menu affiche réellement.
  const responsable = sectionsDe(f => /responsible-ui\.js$/.test(f));
  for (const [fichier, source] of sources) {
    if (/responsible-ui\.js$/.test(fichier)) continue;
    for (const bloc of source.matchAll(/ResponsibleUI\.prototype\.renderBaseLayout\s*=\s*function[\s\S]{0,1200}?\n\s*\};/g)) {
      for (const motif of motifsSection) for (const m of bloc[0].matchAll(motif)) responsable.add(m[1]);
    }
  }
  responsable.delete('users');
  responsable.add('zoneAccess');
  for (const route of listeDeRole('responsible')) if (!responsable.has(route)) probs.routesOrphelines.push(`responsable/${route}`);
  for (const section of responsable) if (!listeDeRole('responsible').includes(section)) probs.routesOrphelines.push(`responsable/${section} (fournie, non déclarée)`);

  // Le technicien n'a pas de registre : ses routes sont traitées à la main dans le module de
  // navigation. C'est le seul rôle où une route déclarée sans traitement casse à l'usage.
  const navigationRoles = sources.get('role-navigation-integration.js') || '';
  const traitees = new Set([
    ...[...navigationRoles.matchAll(/route\.section === '([A-Za-z][A-Za-z0-9]*)'/g)].map(m => m[1]),
    ...[...(navigationRoles.match(/technicianComponents\.set\(ui, \{[\s\S]*?\}\)/)?.[0] || '')
      .matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*new /g)].map(m => m[1])
  ]);
  for (const route of listeDeRole('technician')) if (!traitees.has(route)) probs.routesOrphelines.push(`technicien/${route}`);
}

console.log(`\n=== GRAPHE : ${actifs.size} fichiers actifs, ${sources.size} modules JS ===\n`);
const bilan = [
  ['imports vers un fichier inexistant', probs.importsCasses],
  ['symboles importés mais non exportés', probs.exportsManquants],
  ['magasins utilisés mais jamais créés', probs.magasinsInconnus],
  ['événements émis sans auditeur', probs.evenementsOrphelins],
  ['routes déclarées sans section', probs.routesOrphelines],
  ['justifications d’annonce périmées', probs.justificationsPerimees]
];
for (const [titre, liste] of bilan) {
  console.log(`${liste.length === 0 ? '✓' : '⚠'} ${titre} : ${liste.length}`);
  for (const item of liste) console.log(`     ${item}`);
}
console.log(`\nmagasins déclarés : ${[...magasins].sort().join(', ')}`);
