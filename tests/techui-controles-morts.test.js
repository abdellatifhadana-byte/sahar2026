import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * TECHUI-01 — aucun contrôle du technicien ne doit mentir sur sa nature.
 *
 * Ces gardes sont TEXTUELLES et ne remplacent pas l'épreuve de navigateur : la preuve de
 * comportement — trente contrôles cliqués un par un, avec l'entité réellement ouverte —
 * vit dans `scripts/techui-controls-audit.mjs`. Ce qui est vérifié ici, c'est que les
 * décisions du lot ne puissent pas être défaites par inadvertance.
 */
const lire = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const techui = lire('techui.js');

/*
 * CE QUI EST RENDU, ET NON CE QUI EST EXPLIQUÉ.
 *
 * Les commentaires de ce lot CITENT les libellés retirés — « Support Chat — Équipe
 * Technique », « Mes Tâches du Jour » — pour expliquer pourquoi ils l'ont été. Chercher
 * leur absence dans le fichier entier reviendrait à interdire d'expliquer le correctif.
 * On retire donc les commentaires, y compris ceux posés DANS le gabarit HTML, avant de
 * vérifier ce que l'écran affiche.
 */
const rendu = techui
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(ligne => !/^\s*\/\//.test(ligne)).join('\n');
const navigation = lire('navigation-contract.js');
const permissions = lire('permissions.js');

test('P0-1/P0-2 : ni « Profil » ni « Paramètres » ne sont rendus au technicien', () => {
  // Mesuré au navigateur sur la base : les deux boutons étaient rendus et leur clic ne
  // produisait rien. Aucun écran de profil n'existe dans la plateforme, et les paramètres
  // appartiennent à l'administrateur.
  assert.doesNotMatch(rendu, /id="btn-profile"/);
  assert.doesNotMatch(rendu, /id="btn-settings"/);
  // La déconnexion, elle, reste : c'est le seul geste du dépliant qui fait ce qu'il dit.
  assert.match(techui, /id="btn-logout"/);
});

test('P0-2 : le technicien n’a pas reçu de droit sur les paramètres pour l’occasion', () => {
  // Le lot s'interdit d'élargir les droits pour faire fonctionner un bouton. La preuve
  // tient dans la matrice elle-même, inchangée.
  const bloc = permissions.slice(permissions.indexOf('technician'), permissions.indexOf('technician') + 1400);
  assert.match(bloc, /system:\s*\{\s*view:false,\s*configure:false/);
  assert.match(bloc, /logs:\s*\{\s*view:false/);
});

test('P0-3 : plus aucun contrôle n’envoie le technicien vers le journal', () => {
  // `#/logs` n'est pas dans ses sections : la route retombait EN SILENCE sur le tableau
  // de bord. Le bouton « Voir tout » a été retiré faute de destination autorisée.
  assert.doesNotMatch(rendu, /window\.location\.hash\s*=\s*["']#\/logs["']/);
  assert.doesNotMatch(rendu, /data-action="show-all-activities"/);
  const routesTechnicien = navigation.slice(navigation.indexOf('technician:Object.freeze('), navigation.indexOf('technician:Object.freeze(') + 220);
  assert.doesNotMatch(routesTechnicien, /'logs'/);
});

test('P0-4/P0-5 : les cartes ouvrent l’entité exacte par les workflows existants', () => {
  // Aucune fiche n'est réinventée : on appelle les deux workflows canoniques, avec
  // l'identifiant porté par la carte.
  assert.match(techui, /import \{ openTicketModal, showTicketDetails \} from '\.\/tickets\.js';/);
  assert.match(techui, /bindEntityCards\(\)/);
  assert.match(techui, /await db\.get\('tickets', db\.normalizeKey \? db\.normalizeKey\(id\) : id\)/);
  assert.match(techui, /showTicketDetails\(ticket\)/);
  assert.match(techui, /window\.TechOperations\?\.openEquipment360/);
  // L'entité absente du périmètre se DIT, elle ne s'invente pas.
  assert.match(techui, /n’est plus disponible dans votre périmètre/);
  // Et ce que la souris atteint, le clavier l'atteint aussi.
  assert.match(techui, /role="button" tabindex="0" aria-label="Ouvrir la demande/);
  assert.match(techui, /role="button" tabindex="0" aria-label="Ouvrir la fiche de/);
  assert.match(techui, /liste\.onkeydown/);
});

test('P0-6 : le carnet local ne se présente plus comme un canal d’équipe', () => {
  // Les messages vivent dans le stockage local de CE navigateur : personne ne les reçoit.
  assert.doesNotMatch(rendu, /Support Chat/);
  assert.doesNotMatch(rendu, /Chat équipe/);
  assert.match(rendu, /Notes locales/);
  assert.match(rendu, /Conservées uniquement sur cet appareil/);
  // La clé de stockage ne change pas : ce qui a déjà été écrit reste lisible.
  assert.match(techui, /'smart-tech-chat-messages'/);
});

test('P0-7 : les tâches disent qu’elles ne quittent pas l’appareil', () => {
  assert.doesNotMatch(rendu, /Mes Tâches du Jour/);
  assert.match(rendu, /Mes tâches \(sur cet appareil\)/);
  assert.match(rendu, /Conservées uniquement sur cet appareil, sans synchronisation/);
  assert.match(techui, /'maintenance-tasks'/);
});

test('P0-8 : le centre d’aide ne promet ni scanner QR ni réalité augmentée', () => {
  // La DÉFINITION de la méthode, pas son premier appel : `this.setupSmartChat()` est
  // invoqué dès `init()`, bien avant, et découpait une tranche vide.
  const aide = techui.slice(techui.indexOf('  showHelpCenter() {'), techui.indexOf('  setupSmartChat() {}'));
  assert.doesNotMatch(aide, /QR/);
  assert.doesNotMatch(aide, /Réalité Augmentée/i);
  // Et il décrit ce qui existe vraiment ici.
  assert.match(aide, /Recherche/);
  assert.match(aide, /fiche 360°/);
});

test('l’astuce du jour ne promet aucune capacité absente du parcours', () => {
  /*
   * La carte « Astuce du Jour » tire son texte AU SORT. Le centre d'aide avait cessé de
   * promettre le scanner QR et la réalité augmentée, mais deux des sept astuces les
   * remettaient à l'écran au hasard d'un rendu — un rafraîchissement suffisait à les
   * faire réapparaître pendant une démonstration.
   *
   * Le garde-fou porte sur la LISTE ENTIÈRE, et non sur ce qu'un rendu a bien voulu
   * afficher. L'énumération à l'exécution — toutes les valeurs atteignables, forcées une
   * à une dans un vrai navigateur — vit dans `scripts/techui-controls-audit.mjs`.
   */
  const bloc = techui.slice(techui.indexOf('  getQuickTip() {'), techui.indexOf('  // --- التكامل مع نظام الشاشات'));
  assert.ok(bloc.length > 100, 'la liste d’astuces est introuvable');
  const astuces = [...bloc.matchAll(/"([^"]{20,})"/g)].map(item => item[1]);
  assert.ok(astuces.length >= 5, `liste d’astuces suspecte : ${astuces.length}`);
  for (const astuce of astuces) {
    assert.doesNotMatch(astuce, /QR/i, `astuce promettant un scanner QR : ${astuce}`);
    assert.doesNotMatch(astuce, /réalité augmentée/i, `astuce promettant la réalité augmentée : ${astuce}`);
  }
  // Et les deux remplaçantes décrivent des gestes que l'épreuve de navigateur clique.
  assert.ok(astuces.some(item => /demande récente/i.test(item)), 'l’astuce sur les demandes a disparu');
  assert.ok(astuces.some(item => /équipement critique/i.test(item)), 'l’astuce sur les équipements a disparu');
});

test('la coque technicien n’importe plus le module de réalité augmentée', () => {
  /*
   * Un import n'est pas inerte : `ar-support.js` se termine par `new ARSupport()`, dont
   * le constructeur interroge WebXR au chargement. `techui.js` l'importait sans jamais
   * s'en servir — la seule ligne qui l'utilisait était commentée.
   *
   * Le fichier n'est PAS supprimé : il reste en place pour un lot dédié. Ce qui est
   * vérifié ici, c'est que la coque technicien ne le réveille plus.
   */
  assert.doesNotMatch(techui, /from '\.\/ar-support\.js'/);
  assert.doesNotMatch(rendu, /arSupport/);
  // Le module existe toujours : le retirer serait un autre lot.
  assert.ok(fs.existsSync(new URL('../ar-support.js', import.meta.url)),
    'ar-support.js a été supprimé : ce lot ne le demandait pas');
});

test('les libellés visibles du tableau technicien restent en français', () => {
  const rendu = techui.slice(techui.indexOf('render() {'), techui.indexOf('renderStatCard('));
  // Les commentaires d'origine du fichier sont en arabe ; ce qui est RENDU ne doit pas l'être.
  const arabe = rendu.match(/[؀-ۿ]+/g) || [];
  assert.equal(arabe.length, 0, `libellé non français rendu : ${arabe.slice(0, 3).join(', ')}`);
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Les deux contrôles qui s'exécutaient sans se voir.
 *
 * « Mur d'images » peignait bien le mur, puis le tableau de bord revenait par-dessus au
 * bout de deux cents millisecondes. Ajouter une tâche locale l'écrivait bien dans le
 * stockage, mais rien n'apparaissait avant un rechargement. Dans les deux cas le geste
 * était exécuté et invisible : un bouton qui ne ment pas sur son existence, mais sur son
 * effet. Les gardes ci-dessous protègent la mécanique du correctif ; la preuve de
 * comportement — trois secondes de mur tenu, compteur qui suit à l'ajout — vit dans
 * `scripts/techui-controls-audit.mjs`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

test('la coque sait quelle surface elle affiche, et render() s’abstient sinon', () => {
  // L'état est porté par la coque elle-même, pas déduit d'un délai ni d'une inspection du DOM.
  assert.match(techui, /this\.surface\s*=\s*'dashboard'/, 'la surface initiale n’est pas déclarée');
  assert.match(techui, /surfaceOccupee\s*\(\s*\)\s*\{/, 'surfaceOccupee() a disparu');
  // render() peint le TABLEAU DE BORD : il renonce quand une sous-vue occupe l'écran.
  const corpsRender = rendu.slice(rendu.indexOf('\n  render() {'));
  const premiereInstruction = corpsRender.slice(0, corpsRender.indexOf('document.getElementById(\'app\').innerHTML'));
  assert.match(premiereInstruction, /if\s*\(this\.surfaceOccupee\(\)\)\s*return/,
    'render() repeint le tableau de bord sans vérifier la surface occupée');
  // Le rafraîchissement de fond reste branché : c'est la coque qui s'abstient, pas l'événement
  // qui est coupé. Neutraliser dataUpdated arrêterait la plateforme entière.
  assert.match(rendu, /eventSystem\.register\('dataUpdated'/, 'l’écoute de dataUpdated a été retirée');
});

test('la marque de surface est posée sur le contenu, et le retour la rend explicitement', () => {
  /*
   * La marque vit sur le premier enfant de `#app` : elle disparaît donc AVEC le contenu
   * dès qu'une route technicien le remplace. Sans cela, la coque resterait persuadée
   * d'afficher un mur que le routeur a déjà effacé, et ne repeindrait plus jamais.
   */
  assert.match(techui, /getElementById\('app'\)\?\.firstElementChild\?\.setAttribute\('data-tech-surface'/,
    'la marque de surface n’est plus posée sur le contenu de #app');
  // Le mur est marqué AVANT afterRender(), qui est ce qui déclenche dataUpdated.
  // Sur le RENDU : le commentaire du correctif cite « afterRender() » pour l'expliquer, et
  // fausserait la comparaison d'ordre ci-dessous.
  const mur = rendu.slice(rendu.indexOf('async showWall()'), rendu.indexOf('async showScreenDiagnostic'));
  assert.ok(mur.indexOf("marquerSurface('wall')") < mur.indexOf('afterRender()'),
    'le mur est marqué APRÈS afterRender() : la course reste ouverte');
  // Le retour rend la surface au tableau de bord, sinon render() s'abstiendrait pour toujours.
  assert.match(mur, /onBack:\s*\(\)\s*=>\s*\{\s*this\.surface\s*=\s*'dashboard';\s*this\.render\(\)/,
    'le bouton Retour du mur ne rend pas la surface au tableau de bord');
  // Une navigation explicite par l'adresse est elle aussi une sortie de sous-vue.
  assert.match(techui, /addEventListener\('hashchange',\s*\(\)\s*=>\s*\{\s*this\.surface\s*=\s*'dashboard';/,
    'une navigation par l’adresse ne libère plus la surface');
  // Aucun délai : un correctif qui dépendrait d'un setTimeout serait une course déplacée.
  assert.doesNotMatch(mur, /setTimeout/, 'le mur dépend d’un délai plutôt que d’un état');
});

test('les tâches locales passent par une porte d’écriture unique qui met à jour la projection', () => {
  /*
   * Le défaut : `localStorage.setItem(...)` puis `render()`, alors que `state.todayTasks`
   * — ce que le gabarit lit — datait du dernier `loadData()`. Le stockage avançait, l'écran
   * non. La correction met les deux à jour au même endroit.
   */
  assert.match(techui, /ecrireTachesLocales\s*\(/, 'la porte d’écriture unique a disparu');
  const porte = techui.slice(techui.indexOf('ecrireTachesLocales(muter)'));
  const corps = porte.slice(0, porte.indexOf('\n  initTaskList'));
  assert.match(corps, /localStorage\.setItem\('maintenance-tasks'/, 'le stockage n’est plus écrit');
  assert.match(corps, /this\.state\.todayTasks\s*=/, 'la projection affichée n’est pas mise à jour');
  assert.match(corps, /this\.state\.stats\s*=\s*this\.calculateStats/, 'le compteur « Tâches » ne suit pas l’écriture');
  assert.ok(corps.indexOf('this.state.todayTasks') < corps.indexOf('this.render()'),
    'render() est appelé avant la mise à jour de la projection : l’écran resterait en retard');

  // Ajout ET coche empruntent la même porte : aucune écriture directe ne subsiste ailleurs.
  const liste = techui.slice(techui.indexOf('initTaskList() {'), techui.indexOf('\n  initMotivationBackground'));
  assert.match(liste, /ecrireTachesLocales\(taches => \[/, 'l’ajout n’emprunte pas la porte unique');
  assert.match(liste, /ecrireTachesLocales\(taches => taches\.map/, 'la coche n’emprunte pas la porte unique');
  assert.doesNotMatch(liste, /localStorage\.setItem/, 'une écriture directe subsiste dans la liste des tâches');

  // La lecture est centralisée elle aussi, et loadData s'en sert : un JSON corrompu ne doit
  // pas vider le tableau de bord entier.
  assert.match(techui, /lireTachesLocales\s*\(\s*\)\s*\{[\s\S]*?catch\s*\{\s*return \[\];/,
    'la lecture des tâches locales n’est pas protégée');
  const chargement = techui.slice(techui.indexOf('async loadData()'), techui.indexOf('\n  calculateStats('));
  assert.match(chargement, /this\.state\.todayTasks = this\.lireTachesLocales\(\)/,
    'loadData ne lit plus les tâches par le helper');

  // Ce lot ne crée aucun aller-retour serveur : les tâches restent locales et annoncées comme telles.
  assert.doesNotMatch(corps, /fetch\(|db\.(save|add|update)/, 'la tâche locale a été branchée au serveur');
});
