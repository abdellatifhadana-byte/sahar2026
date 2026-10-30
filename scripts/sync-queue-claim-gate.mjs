/**
 * @file scripts/sync-queue-claim-gate.mjs — SYNC-QUEUE-DOUBLE-PUSH-01 (#127).
 *
 * CE QUI SE PASSAIT
 * -----------------
 * Une seule modification hors ligne, une seule entrée dans la file — et DEUX PUT sur le
 * serveur. Mesuré sur `main@1236fc5f` : `[200, 409]`. Le premier rejeu passe, le second
 * repart avec la même charge et la même révision, désormais périmée, et se fait refuser en
 * STALE_WRITE : un conflit sans deuxième auteur, une alerte « cette donnée a été modifiée
 * par un autre utilisateur » pour une écriture qui vient de réussir, et l'entrée réglée
 * RESSUSCITÉE en file avec le statut `conflict` — terminal, donc là pour toujours.
 *
 * LA CAUSE, MESURÉE
 * -----------------
 * L'événement `online` a DEUX abonnés qui mènent tous deux à la file :
 *
 *     db.js:137            addEventListener('online', () => this.processSyncQueue())
 *     central-sync.js      addEventListener('online', () => db.enableCentralSync(…))
 *                              └─ enableCentralSync → await db.processSyncQueue()
 *
 * `enableCentralSync` se protégeait déjà par une promesse unique. `processSyncQueue`, non.
 * Elle SÉLECTIONNAIT les entrées `pending` d'un côté et les SUPPRIMAIT de l'autre, avec un
 * aller-retour réseau complet entre les deux : pendant tout ce temps l'entrée restait
 * `pending`, donc offerte à qui passait.
 *
 *     t=  1ms  online → db.js               → processSyncQueue #1 · lit la file
 *     t=  2ms  online → central-sync.js     → GET /api/sync
 *     t=  7ms  #1 → PUT settings/global rev=13
 *     t=139ms  enableCentralSync            → processSyncQueue #2 · relit la MÊME entrée
 *     t=140ms  #2 → PUT settings/global rev=13      ← le doublon
 *     t=164ms  ← 200      t=294ms  ← 409 STALE_WRITE
 *
 * La course n'est pas théorique et ne dépend pas d'un onglet : deux ONGLETS de la même
 * session partagent la file sans partager leurs variables, et rejouaient eux aussi la même
 * entrée. Un verrou en mémoire n'aurait donc rien prouvé.
 *
 * CE QUE CETTE ÉPREUVE VÉRIFIE
 * ----------------------------
 * Qu'une opération logique présente UNE FOIS dans la file n'atteint le serveur qu'UNE FOIS,
 * y compris entre onglets ; et tout ce que ce verrouillage n'a pas le droit de casser : un
 * vrai 409 reste un 409, une panne réseau laisse l'entrée rejouable, une réclamation
 * abandonnée est reprise, une saisie postérieure survit, et rien ne se sérialise qui n'ait
 * besoin de l'être.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const REPO = process.env.REPO_DIR || new URL('..', import.meta.url).pathname;
const { BASE, COMPTES, motDePasseDe } = await import(`file://${REPO}/scripts/ui-polish-decor.mjs`);
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sql = requete => execSync(`psql "${process.env.DATABASE_URL}" -tAc "${requete}"`).toString().trim();
const revServeur = (magasin, id) =>
  sql(`select coalesce(data->>'_revision','ABSENT') from platform_records where store_name='${magasin}' and record_id='${id}' and not deleted`);

/* La latence du lien. Zéro n'existe qu'en boucle locale ; un lien réel — mobile, VPN,
 * liaison de régie — se compte en dizaines de millisecondes, et c'est cette durée qui ouvre
 * la fenêtre entre la sélection et la suppression. La course est mesurée, pas fabriquée. */
const LATENCE = Number(process.env.GATE_LATENCE_MS || 150);

let echecs = 0, verifs = 0;
const dit = (condition, message, detail = '') => {
  verifs += 1;
  console.log(`  ${condition ? '✅' : '❌'} ${message}${detail ? ` → ${detail}` : ''}`);
  if (!condition) echecs += 1;
};
const titre = texte => console.log(`\n━━━ ${texte} ━━━`);

/* La sonde compte les requêtes de données et les cycles de file, sans rien modifier au produit. */
const SONDE = () => {
  window.__t0 = Date.now();
  window.__net = [];
  window.__cycles = [];
  window.__erreurs = [];
  window.addEventListener('error', e => window.__erreurs.push(String(e?.message || e).slice(0, 120)));
  window.addEventListener('unhandledrejection', e => window.__erreurs.push(String(e?.reason?.message || e?.reason).slice(0, 120)));
  const origFetch = window.fetch;
  window.fetch = async function (cible, options = {}) {
    const url = typeof cible === 'string' ? cible : cible?.url || String(cible);
    const methode = (options.method || (typeof cible === 'object' && cible?.method) || 'GET').toUpperCase();
    const chemin = new URL(url, location.origin).pathname;
    if (!/\/api\/data\//.test(chemin) || methode === 'GET') return origFetch.call(window, cible, options);
    let rev = null;
    if (typeof options.body === 'string') { try { rev = JSON.parse(options.body)?._revision ?? '∅'; } catch {} }
    const trace = { t: Date.now() - window.__t0, methode, chemin, rev };
    window.__net.push(trace);
    try { const r = await origFetch.call(window, cible, options); trace.statut = r.status; trace.tFin = Date.now() - window.__t0; return r; }
    catch (e) { trace.statut = 'ÉCHEC'; trace.tFin = Date.now() - window.__t0; throw e; }
  };
};

/* Compte les DEMANDES de reprise et les cycles réellement ouverts : la distinction est tout
 * le contrat de la phase 14 — plusieurs déclencheurs, un seul envoi. */
const SONDE_FILE = async () => {
  const { db } = await import('/db.js');
  const origine = db.processSyncQueue.bind(db);
  db.processSyncQueue = function comptee() {
    const demande = { t: Date.now() - window.__t0 };
    window.__cycles.push(demande);
    const promesse = origine();
    demande.promesse = promesse;
    // Deux demandes qui rendent la MÊME promesse ont rejoint le même cycle.
    return promesse;
  };
};

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });

const ouvrir = async (cle = 'admin', { sonderFile = true } = {}) => {
  const compte = COMPTES[cle];
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 } });
  await contexte.addInitScript(SONDE);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 60000 });
  await page.fill('#login-username', compte.username);
  await page.fill('#login-password', motDePasseDe(compte));
  await page.click('#login-submit');
  await page.waitForSelector('#login-form', { state: 'detached', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(9000);
  const cdp = await contexte.newCDPSession(page);
  const reseau = offline => cdp.send('Network.emulateNetworkConditions', { offline, latency: LATENCE, downloadThroughput: -1, uploadThroughput: -1 });
  await reseau(false);
  if (sonderFile) await page.evaluate(SONDE_FILE);
  return { contexte, page, reseau };
};

const remise = page => page.evaluate(() => { window.__net.length = 0; window.__cycles.length = 0; window.__t0 = Date.now(); });
const mutations = (page, motif) => page.evaluate(m => window.__net.filter(r => new RegExp(m).test(r.chemin)), motif);
const fileDe = page => page.evaluate(async () => (await (await import('/db.js')).db.getAll('syncQueue'))
  .map(e => ({ id: e.id, store: e.storeName, entityId: String(e.entityId), statut: e.status ?? 'pending', code: e.lastErrorCode || null, tentatives: e.attempts ?? 0 })));

console.log(`\n╔═══ SYNC-QUEUE-DOUBLE-PUSH-01 · une opération, un seul envoi — ${BASE} · latence ${LATENCE} ms ═══╗`);

/* ═════ 1 · LE DÉFAUT : une séance hors ligne, un envoi par opération ═════ */
titre('1 · Rejeu hors ligne — une opération logique, un seul PUT');
{
  const { contexte, page, reseau } = await ouvrir('admin');
  // Une fiche libre, posée en ligne : les ensemencements réécrivent `docs` et `notes` au
  // démarrage, et mesurer sur l'une des leurs reviendrait à mesurer leur va-et-vient.
  await page.evaluate(async () => {
    const { db } = await import('/db.js');
    await db.save('notes', { id: 'sq127-red-note', title: 'SQ127', content: 'origine', targetType: 'platform' }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  });
  await reseau(true);
  await page.waitForTimeout(300);
  /*
   * QUATRE GESTES, QUATRE ENTRÉES — une séance hors ligne ordinaire.
   *
   * Le nombre n'est pas décoratif : le rejeu parcourt la file entrée par entrée, donc il dure
   * autant d'allers-retours qu'il y a d'entrées, tandis que la seconde reprise, elle, n'attend
   * qu'un instantané. C'est cet écart qui ouvre la fenêtre — et avec une seule entrée sur une
   * liaison rapide, il arrive qu'elle se referme avant d'être vue. Une modification isolée
   * n'est pas moins exposée pour autant : elle l'est dès que le lien est lent, ce que le
   * relevé de l'issue #127 a mesuré, et dès qu'un second onglet existe (épreuve 2).
   */
  const depart = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const marque = `SQ127-red-${Date.now()}`;
    const faits = [];
    const reglages = await db._getRaw('settings', 'global');
    await db.save('settings', { ...reglages, autoLogout: 133 }).catch(() => {}); faits.push(['settings', 'global']);
    const salle = (await db.getAll('rooms')).find(r => String(r.id) === 'ui-polish-salle-libre');
    if (salle) { await db.save('rooms', { ...salle, description: marque }).catch(() => {}); faits.push(['rooms', String(salle.id)]); }
    const equip = (await db.getAll('equipments')).find(e => String(e.roomId) === 'ui-polish-salle-libre');
    if (equip) { await db.save('equipments', { ...equip, notes: marque }).catch(() => {}); faits.push(['equipments', String(equip.id)]); }
    const note = await db._getRaw('notes', 'sq127-red-note');
    if (note) { await db.save('notes', { ...note, content: marque }).catch(() => {}); faits.push(['notes', 'sq127-red-note']); }
    await new Promise(r => setTimeout(r, 1500));
    const file = (await db.getAll('syncQueue')).filter(e => (e.status ?? 'pending') === 'pending');
    return { faits, parCible: faits.map(([m, id]) => file.filter(e => e.storeName === m && String(e.entityId) === id).length) };
  });
  dit(depart.faits.length === 4, 'les quatre gestes hors ligne sont en file', depart.faits.map(f => f[0]).join(', '));
  dit(depart.parCible.every(n => n === 1), 'chaque geste tient en UNE seule opération logique', JSON.stringify(depart.parCible));

  /*
   * L'onglet passe en arrière-plan — téléphone verrouillé, autre application. La relance des
   * vingt secondes ne s'exécute QUE si l'onglet est visible : `remoteReady` reste donc vrai
   * pendant toute la coupure, aussi longue soit-elle. C'est l'état ordinaire d'une reprise.
   */
  const secondOnglet = await contexte.newPage();
  await secondOnglet.goto('about:blank');
  await page.waitForTimeout(23000);
  const pret = await page.evaluate(async () => (await import('/db.js')).db.isCentralSyncReady());
  dit(pret === true, 'la reprise part bien de l’état où le défaut se produit (remoteReady)', String(pret));

  await remise(page);
  await reseau(false);
  await page.bringToFront();
  await page.waitForTimeout(12000);

  const envois = await page.evaluate(() => window.__net.filter(r => typeof r.statut === 'number'));
  const cycles = await page.evaluate(() => window.__cycles.length);
  dit(cycles >= 2, 'plusieurs déclencheurs ont bien demandé une reprise', `${cycles} demande(s)`);
  let doubles = 0;
  for (const [magasin, id] of depart.faits) {
    const pour = envois.filter(r => r.chemin === `/api/data/${magasin}/${encodeURIComponent(id)}`);
    if (pour.length > 1) doubles += 1;
    dit(pour.length === 1, `${magasin} : une opération logique = exactement UN PUT`, `${pour.length} → [${pour.map(p => p.statut).join(',')}]`);
  }
  dit(doubles === 0 && envois.every(r => r.statut === 200), 'aucun 409 illégitime au rejeu', envois.map(r => r.statut).join(',') || 'aucun');

  const apres = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const fiche = await db._getRaw('settings', 'global');
    return { autoLogout: fiche?.autoLogout, rev: fiche?._revision, file: (await db.getAll('syncQueue')).filter(e => ['pending', 'processing'].includes(e.status ?? 'pending')).length };
  });
  dit(apres.autoLogout === 133, 'le contenu saisi hors ligne est conservé', String(apres.autoLogout));
  dit(String(apres.rev) === revServeur('settings', 'global'), 'la révision locale rejoint celle du serveur', `${apres.rev} vs ${revServeur('settings', 'global')}`);
  dit(apres.file === 0, 'la file est vidée : aucune entrée réglée n’est ressuscitée', String(apres.file));
  await secondOnglet.close();
  await contexte.close();
}

/* ═════ 2 · DEUX ONGLETS — la file est partagée, les variables ne le sont pas ═════ */
titre('2 · Deux onglets de la même session — une entrée, un seul envoi');
{
  const { contexte, page, reseau } = await ouvrir('admin');
  const pageB = await contexte.newPage();
  await pageB.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(9000);
  const cdpB = await contexte.newCDPSession(pageB);
  const reseauB = offline => cdpB.send('Network.emulateNetworkConditions', { offline, latency: LATENCE, downloadThroughput: -1, uploadThroughput: -1 });
  await pageB.evaluate(SONDE_FILE);
  dit(await pageB.evaluate(async () => (await import('/db.js')).db.isCentralSyncReady()), 'le second onglet est bien une reprise à part entière');

  await Promise.all([reseau(true), reseauB(true)]);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const reglages = await db._getRaw('settings', 'global');
    await db.save('settings', { ...reglages, autoLogout: 144 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
  });
  await remise(page); await remise(pageB);
  await Promise.all([reseau(false), reseauB(false)]);
  await page.waitForTimeout(9000);

  const putsA = await mutations(page, 'settings/global');
  const putsB = await mutations(pageB, 'settings/global');
  const total = [...putsA, ...putsB];
  dit(total.length === 1, 'l’entrée partagée n’est envoyée qu’une fois, tous onglets confondus', `A=${putsA.length} B=${putsB.length} → [${total.map(p => p.statut).join(',')}]`);
  dit(total.every(p => p.statut === 200), 'et elle est acceptée', total.map(p => p.statut).join(',') || 'aucun');
  const reste = (await fileDe(page)).filter(e => e.store === 'settings');
  dit(reste.length === 0, 'aucune entrée `settings` ne survit au rejeu croisé', JSON.stringify(reste));
  await contexte.close();
}

/* ═════ 3 · QUATRE DÉCLENCHEURS QUASI SIMULTANÉS ═════ */
titre('3 · online + focus + visibilitychange + relance — un seul envoi, zéro exception');
{
  const { contexte, page, reseau } = await ouvrir('admin');
  await reseau(true);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const reglages = await db._getRaw('settings', 'global');
    await db.save('settings', { ...reglages, autoLogout: 155 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
  });
  await remise(page);
  await reseau(false);
  // Les quatre chemins de reprise, déclenchés à la main dans la même poignée de millisecondes.
  await page.evaluate(async () => {
    const { db } = await import('/db.js');
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    db.enableCentralSync({ bootstrapLocal: false }).catch(() => {});
    db.processSyncQueue().catch(() => {});
  });
  await page.waitForTimeout(9000);
  const puts = await mutations(page, 'settings/global');
  const cycles = await page.evaluate(() => window.__cycles.length);
  const erreurs = await page.evaluate(() => window.__erreurs);
  dit(cycles >= 2, 'plusieurs reprises ont été demandées', `${cycles}`);
  dit(puts.length === 1, 'une seule requête part malgré les déclencheurs empilés', `${puts.length} → [${puts.map(p => p.statut).join(',')}]`);
  dit(erreurs.length === 0, 'aucune exception', erreurs.join(' | ') || 'aucune');
  await contexte.close();
}

/* ═════ 4 · CINQ MAGASINS RÉVISIONNÉS ═════ */
titre('4 · Cinq magasins révisionnés — settings, rooms, equipments, docs, notes');
{
  const { contexte, page, reseau } = await ouvrir('admin');
  /*
   * Les deux fiches libres sont posées EN LIGNE d'abord : les ensemencements de la régie
   * réécrivent `docs` à chaque démarrage, et mesurer sur l'une des leurs reviendrait à
   * mesurer leur va-et-vient plutôt que le rejeu.
   */
  await page.evaluate(async () => {
    const { db } = await import('/db.js');
    await db.save('docs', { id: 'sq127-doc', title: 'SQ127', content: 'origine', targetType: 'platform', name: 'SQ127', location: 'Casablanca' }).catch(() => {});
    await db.save('notes', { id: 'sq127-note', title: 'SQ127', content: 'origine', targetType: 'platform' }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  });
  await reseau(true);
  await page.waitForTimeout(300);
  const cibles = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const marque = `SQ127-${Date.now()}`;
    const faits = [];
    const reglages = await db._getRaw('settings', 'global');
    await db.save('settings', { ...reglages, autoLogout: 166 }).catch(() => {}); faits.push(['settings', 'global']);
    const salle = (await db.getAll('rooms')).find(r => String(r.id) === 'ui-polish-salle-libre');
    if (salle) { await db.save('rooms', { ...salle, description: marque }).catch(() => {}); faits.push(['rooms', String(salle.id)]); }
    const equip = (await db.getAll('equipments')).find(e => String(e.roomId) === 'ui-polish-salle-libre');
    if (equip) { await db.save('equipments', { ...equip, notes: marque }).catch(() => {}); faits.push(['equipments', String(equip.id)]); }
    for (const magasin of ['docs', 'notes']) {
      const fiche = await db._getRaw(magasin, `sq127-${magasin === 'docs' ? 'doc' : 'note'}`);
      if (fiche) { await db.save(magasin, { ...fiche, content: marque }).catch(() => {}); faits.push([magasin, String(fiche.id)]); }
    }
    await new Promise(r => setTimeout(r, 1500));
    return faits;
  });
  dit(cibles.length === 5, 'les cinq magasins sont bien en file', cibles.map(c => c[0]).join(', '));
  await remise(page);
  await reseau(false);
  await page.waitForTimeout(12000);
  const envois = await page.evaluate(() => window.__net);
  for (const [magasin, id] of cibles) {
    const pour = envois.filter(r => r.chemin === `/api/data/${magasin}/${encodeURIComponent(id)}`);
    dit(pour.length === 1, `${magasin} : un rejeu = un PUT`, `${pour.length} → [${pour.map(p => p.statut).join(',')}]`);
  }
  const restant = (await fileDe(page)).filter(e => e.statut === 'pending' || e.statut === 'processing');
  dit(restant.length === 0, 'la file ne garde aucune entrée en suspens', JSON.stringify(restant));
  await contexte.close();
}

/* ═════ 5 · UNE ENTRÉE REFUSÉE N'EMPORTE PAS LES AUTRES ═════ */
titre('5 · A · B refusée · C — l’échec est isolé, la file continue');
{
  const { contexte, page, reseau } = await ouvrir('admin');
  await reseau(true);
  await page.waitForTimeout(300);
  const ids = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const marque = `SQ127-iso-${Date.now()}`;
    const reglages = await db._getRaw('settings', 'global');
    await db.save('settings', { ...reglages, autoLogout: 177 }).catch(() => {});
    /*
     * B : une demande écrite en direct. Le serveur la refuse — les tickets ont leur propre
     * point d'entrée, qui valide auteur et destination — et ce refus n'est PAS un conflit de
     * version : c'est exactement le refus 4xx propre que cette épreuve veut isoler.
     */
    const billet = await db.save('tickets', { type: 'screen', status: 'open', title: marque, createdBy: 'gate-127', createdAt: new Date().toISOString() }).catch(() => null);
    const salle = (await db.getAll('rooms')).find(r => String(r.id) === 'ui-polish-salle-libre');
    await db.save('rooms', { ...salle, description: marque }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    return { billet: String(billet), salle: String(salle.id) };
  });
  await remise(page);
  await reseau(false);
  await page.waitForTimeout(11000);
  const envois = await page.evaluate(() => window.__net);
  const file = await fileDe(page);
  const pourA = envois.filter(r => /settings\/global/.test(r.chemin));
  const pourC = envois.filter(r => r.chemin === `/api/data/rooms/${ids.salle}`);
  const entreeB = file.find(e => e.store === 'tickets' && e.entityId === ids.billet);
  dit(pourA.length === 1 && pourA[0].statut === 200, 'A est validée', `${pourA.length} → ${pourA.map(p => p.statut)}`);
  dit(!!entreeB && entreeB.statut === 'failed', 'B garde son état d’erreur propre, et ne repart pas', JSON.stringify(entreeB || file));
  dit(pourC.length === 1 && pourC[0].statut === 200, 'C suit et aboutit', `${pourC.length} → ${pourC.map(p => p.statut)}`);
  await contexte.close();
}

/* ═════ 6 · UN VRAI CONFLIT RESTE UN 409 ═════ */
titre('6 · Deux sessions — une révision réellement périmée reste refusée');
{
  const { contexte, page, reseau } = await ouvrir('admin');
  await reseau(true);
  await page.waitForTimeout(300);
  const salle = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const s = (await db.getAll('rooms')).find(r => String(r.id) === 'ui-polish-salle-libre');
    await db.save('rooms', { ...s, description: `SQ127-perime-${Date.now()}` }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    return String(s.id);
  });
  // Pendant la coupure, un AUTRE auteur fait avancer la fiche : la file porte désormais une
  // révision réellement dépassée.
  const cookie = execSync(
    `curl -s -i -X POST ${BASE}/api/auth/login -H 'content-type: application/json' ` +
    `-d '{"username":"${process.env.PLATFORM_ADMIN_USERNAME}","password":"${process.env.PLATFORM_ADMIN_PASSWORD}"}' | ` +
    `grep -i '^set-cookie' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1`).toString().trim();
  /*
   * Le serveur n'expose pas de lecture unitaire : la fiche est lue en base, mais l'ÉCRITURE
   * passe par l'API — l'invariant veut que toute mutation traverse le magasin de révisions,
   * et une épreuve qui s'en dispenserait ouvrirait la porte dérobée qu'elle surveille.
   */
  const fiche = JSON.parse(sql(`select data from platform_records where store_name='rooms' and record_id='${salle}' and not deleted`));
  const charge = `${REPO}/.sq127-autre-auteur.json`;
  execSync(`cat > ${charge} <<'CHARGE'\n${JSON.stringify({ ...fiche, description: 'ecrit-par-un-autre' })}\nCHARGE`);
  execSync(`curl -s -o /dev/null -X PUT ${BASE}/api/data/rooms/${salle} -H "cookie: ${cookie}" -H 'content-type: application/json' --data-binary @${charge}`);
  execSync(`rm -f ${charge}`);
  const revAvant = revServeur('rooms', salle);

  await remise(page);
  await reseau(false);
  await page.waitForTimeout(10000);
  const puts = await mutations(page, `rooms/${salle}`);
  const entree = (await fileDe(page)).find(e => e.store === 'rooms' && e.entityId === salle);
  dit(puts.length === 1, 'la file ne s’acharne pas : un seul essai', `${puts.length} → [${puts.map(p => p.statut).join(',')}]`);
  dit(puts.some(p => p.statut === 409), 'une écriture réellement périmée reste refusée en 409', puts.map(p => p.statut).join(','));
  dit(!!entree && entree.statut === 'conflict' && entree.code === 'STALE_WRITE', 'l’entrée est nommée conflit, pas succès', JSON.stringify(entree));
  dit(revServeur('rooms', salle) === revAvant, 'le serveur n’a pas bougé sous le refus', `${revAvant} → ${revServeur('rooms', salle)}`);
  await contexte.close();
}

/* ═════ 7 · PANNE RÉSEAU PENDANT LE REJEU ═════ */
titre('7 · Le serveur ne répond pas — l’entrée reste rejouable, jamais retirée');
{
  const { contexte, page, reseau } = await ouvrir('admin');
  await reseau(true);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const reglages = await db._getRaw('settings', 'global');
    await db.save('settings', { ...reglages, autoLogout: 188 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
  });
  // Le rejeu part, mais le PUT échoue avant toute réponse : cas ambigu par nature.
  const bilan = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const origine = window.fetch;
    window.fetch = async (cible, options = {}) => {
      const url = typeof cible === 'string' ? cible : cible?.url || String(cible);
      const methode = (options.method || 'GET').toUpperCase();
      if (methode === 'PUT' && /\/api\/data\//.test(url)) { const e = new Error('lien coupé'); e.status = 0; throw e; }
      return origine(cible, options);
    };
    const r = await db.processSyncQueue();
    window.fetch = origine;
    return r;
  });
  const file = await fileDe(page);
  const entree = file.find(e => e.store === 'settings');
  dit(!!entree, 'l’entrée n’est pas retirée sous prétexte qu’elle est partie', JSON.stringify(entree || null));
  dit(!!entree && entree.statut === 'pending', 'elle redevient rejouable — aucune main laissée posée', entree?.statut);
  dit(!!entree && entree.tentatives >= 1, 'la tentative est comptée', String(entree?.tentatives));
  // Et elle repart pour de bon au retour du lien, une seule fois.
  await remise(page);
  await reseau(false);
  await page.waitForTimeout(9000);
  const puts = await mutations(page, 'settings/global');
  dit(puts.length === 1 && puts[0].statut === 200, 'le retry aboutit, et une seule fois', `${puts.length} → [${puts.map(p => p.statut).join(',')}]`);
  dit(bilan.processed === 0, 'le bilan ne compte pas une opération qui n’est pas partie', JSON.stringify(bilan));
  await contexte.close();
}

/* ═════ 8 · AUCUN VERROU MORT ═════ */
titre('8 · Une réclamation abandonnée est reprise, une réclamation vivante ne l’est pas');
{
  const { contexte, page, reseau } = await ouvrir('admin');
  const resultat = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    // La constante n'existe pas sur la base d'avant le correctif : l'épreuve doit tout de
    // même pouvoir s'exécuter là-bas, et RATER, plutôt que de tomber en panne.
    const { QUEUE_CLAIM_LEASE_MS = 60000 } = await import('/revision-contract.js');
    const reglages = await db._getRaw('settings', 'global');
    const vieille = new Date(Date.now() - QUEUE_CLAIM_LEASE_MS - 5000).toISOString();
    const fraiche = new Date().toISOString();

    // a · une main posée par un contexte disparu
    await db.saveLocalOnly('syncQueue', {
      action: 'save', storeName: 'settings', entityId: 'global', data: { ...reglages, autoLogout: 199 },
      expectedRevision: null, timestamp: vieille, status: 'processing', claimedAt: vieille, attempts: 1
    });
    window.__net.length = 0;
    const bilanA = await db.processSyncQueue();
    const abandonnee = window.__net.filter(r => /settings\/global/.test(r.chemin)).length;

    // b · une main posée à l'instant, par un rejeu bien vivant
    await db.saveLocalOnly('syncQueue', {
      action: 'save', storeName: 'settings', entityId: 'global', data: { ...reglages, autoLogout: 200 },
      expectedRevision: null, timestamp: fraiche, status: 'processing', claimedAt: fraiche, attempts: 1
    });
    window.__net.length = 0;
    const bilanB = await db.processSyncQueue();
    const vivante = window.__net.filter(r => /settings\/global/.test(r.chemin)).length;
    const reste = (await db.getAll('syncQueue')).filter(e => e.storeName === 'settings');
    return { abandonnee, vivante, bilanA, bilanB, reste: reste.map(e => e.status) };
  });
  dit(resultat.abandonnee === 1, 'une réclamation périmée est reprise et repart', `${resultat.abandonnee} PUT`);
  dit(resultat.vivante === 0, 'une réclamation vivante n’est jamais volée', `${resultat.vivante} PUT`);
  dit(resultat.bilanB.pending >= 1, 'et elle reste comptée comme travail en attente', JSON.stringify(resultat.bilanB));
  await contexte.close();
}

/* ═════ 9 · UNE SAISIE POSTÉRIEURE SURVIT AU REJEU ═════ */
titre('9 · Nouvelle saisie pendant le rejeu — elle n’est ni écrasée ni emportée');
{
  /*
   * Le rejeu est PILOTÉ, sans coupure ni retour de réseau. Une transition ferait passer un
   * instantané complet au milieu de la mesure, et l'on ne saurait plus si une valeur vient
   * du rejeu, de la saisie ou de l'instantané. Ici l'entrée en file est posée à la main —
   * c'est exactement ce qu'une coupure aurait laissé — et rien d'autre ne bouge.
   */
  const { contexte, page } = await ouvrir('admin');
  await remise(page);
  const mesure = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const depart = await db._getRaw('settings', 'global');
    // A : ce qu'une saisie hors ligne aurait laissé — la fiche telle qu'elle était, autoLogout 21.
    await db.saveLocalOnly('syncQueue', {
      action: 'save', storeName: 'settings', entityId: 'global',
      data: { ...depart, autoLogout: 21 }, expectedRevision: null,
      timestamp: new Date().toISOString(), status: 'pending', attempts: 0
    });
    const rejeu = db.processSyncQueue();
    await new Promise(r => setTimeout(r, 30));
    const filePendant = (await db.getAll('syncQueue')).filter(e => e.storeName === 'settings').map(e => e.status);
    // B : saisie pendant que A est en vol.
    const fiche = await db._getRaw('settings', 'global');
    let refusB = null;
    try { await db.save('settings', { ...fiche, autoLogout: 22 }); } catch (e) { refusB = e.code || String(e.message).slice(0, 40); }
    const bilan = await rejeu;
    await new Promise(r => setTimeout(r, 600));
    const finale = await db._getRaw('settings', 'global');
    return {
      filePendant, refusB, bilan,
      autoLogout: finale?.autoLogout, rev: finale?._revision,
      file: (await db.getAll('syncQueue')).filter(e => e.storeName === 'settings').map(e => `${e.status}/${e.lastErrorCode || ''}`),
      envois: window.__net.filter(r => /settings\/global/.test(r.chemin))
    };
  });
  const serveur = sql(`select data->>'autoLogout' from platform_records where store_name='settings' and record_id='global'`);
  console.log(`     A en vol : file ${JSON.stringify(mesure.filePendant)} · B ${mesure.refusB ? `refusée (${mesure.refusB})` : 'acceptée'} · local ${mesure.autoLogout} · serveur ${serveur}`);
  dit(mesure.filePendant.includes('processing'), 'l’entrée en vol est visiblement réclamée, pas simplement `pending`', JSON.stringify(mesure.filePendant));
  dit(mesure.envois.length === 2, 'deux opérations distinctes = deux envois, aucun doublon', `${mesure.envois.length} → [${mesure.envois.map(r => r.statut).join(',')}]`);
  dit(mesure.envois.filter(r => r.statut === 200).length >= 1, 'le rejeu de A aboutit', mesure.envois.map(r => r.statut).join(','));
  /*
   * B PART AVEC SA PROPRE CHARGE, et c'est la question de #127.
   *
   * Son sort — acceptée, ou refusée parce qu'elle déclare la révision d'AVANT l'accusé de A —
   * relève du contrat de concurrence, pas de la file : deux écritures qui déclarent la même
   * révision, l'une des deux doit perdre, et c'est précisément ce que le 409 protège. Ce que
   * la file doit garantir, elle, c'est que B ne soit ni avalée avec l'entrée de A, ni envoyée
   * avec la charge de A, ni tenue pour déjà partie.
   */
  dit(mesure.envois.some(r => r.rev !== null), 'B part avec sa propre charge, jamais avec celle de A', `envois ${JSON.stringify(mesure.envois.map(r => `${r.statut}`))}`);
  dit(mesure.refusB === null || mesure.file.some(f => f.startsWith('conflict')),
    'B n’est jamais perdue en silence — appliquée, ou nommée en conflit', mesure.refusB ? `refus ${mesure.refusB} · file ${JSON.stringify(mesure.file)}` : 'appliquée');
  dit(!mesure.file.some(f => f.startsWith('pending') || f.startsWith('processing')),
    'l’entrée de A est retirée, et aucune entrée fantôme ne la remplace', JSON.stringify(mesure.file));

  /*
   * PUIS B REPART, AVEC LA RÉVISION AUTORITAIRE — c'est l'exigence explicite de #127 :
   * une saisie postérieure doit rester possible après l'accusé de A.
   */
  const rattrapage = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    await db.enableCentralSync({ bootstrapLocal: false }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    window.__net.length = 0;
    const fiche = await db._getRaw('settings', 'global');
    let refus = null;
    try { await db.save('settings', { ...fiche, autoLogout: 24 }); } catch (e) { refus = e.code || String(e.message).slice(0, 40); }
    const apres = await db._getRaw('settings', 'global');
    return { refus, autoLogout: apres?.autoLogout, rev: apres?._revision, envois: window.__net.filter(r => /settings\/global/.test(r.chemin)) };
  });
  dit(rattrapage.refus === null && rattrapage.autoLogout === 24, 'après l’accusé de A, la même fiche se ressaisit sans refus', rattrapage.refus || String(rattrapage.autoLogout));
  dit(rattrapage.envois.length === 1 && rattrapage.envois[0].statut === 200, 'et elle ne part qu’une fois, acceptée', `${rattrapage.envois.length} → [${rattrapage.envois.map(r => r.statut).join(',')}]`);
  dit(String(rattrapage.rev) === revServeur('settings', 'global'), 'avec la révision que le serveur vient d’attribuer', `${rattrapage.rev} vs ${revServeur('settings', 'global')}`);
  await contexte.close();
}

/* ═════ 10 · `logs` — aucune écriture nouvelle ═════ */
titre('10 · Le magasin `logs` garde son contrat : aucune écriture introduite');
{
  const avant = Number(sql(`select count(*) from platform_records where store_name='logs'`));
  const { contexte, page, reseau } = await ouvrir('admin');
  await reseau(true);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const reglages = await db._getRaw('settings', 'global');
    await db.save('settings', { ...reglages, autoLogout: 23 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
  });
  await remise(page);
  await reseau(false);
  await page.waitForTimeout(9000);
  const versLogs = await mutations(page, '/api/data/logs/');
  dit(versLogs.length === 0, 'le rejeu n’écrit rien dans `logs`', `${versLogs.length}`);
  dit(Number(sql(`select count(*) from platform_records where store_name='logs'`)) === avant, 'le nombre de journaux au serveur n’a pas bougé', `${avant}`);
  await contexte.close();
}

/* ═════ 11 · #120 — l’accusé de réception n’a pas bougé ═════ */
titre('11 · Non-régression #120 — un geste en ligne = un PUT, la projection apprend la révision');
{
  const { contexte, page } = await ouvrir('admin');
  await remise(page);
  const suite = await page.evaluate(async () => {
    const contrat = await import('/settings-contract.js');
    const { db } = await import('/db.js');
    const etapes = [];
    for (let n = 1; n <= 5; n += 1) {
      try { await contrat.savePlatformSettings({ autoLogout: 30 + n }); etapes.push({ n, ok: true, rev: (await db._getRaw('settings', 'global'))?._revision }); }
      catch (e) { etapes.push({ n, ok: false, erreur: String(e.message).slice(0, 50) }); }
    }
    return etapes;
  });
  await page.waitForTimeout(2000);
  const puts = await mutations(page, 'settings/global');
  dit(suite.every(e => e.ok), 'les cinq sauvegardes consécutives aboutissent', suite.map(e => e.ok ? 'ok' : e.erreur).join(' · '));
  dit(puts.length === 5, 'un geste utilisateur = un seul PUT', `${puts.length} PUT pour 5 gestes`);
  dit(puts.every(p => p.statut === 200), 'aucun 409 illégitime', puts.map(p => p.statut).join(','));
  dit(String(suite.at(-1).rev) === revServeur('settings', 'global'), 'la projection porte la révision finale du serveur', `${suite.at(-1).rev} vs ${revServeur('settings', 'global')}`);
  await contexte.close();
}

/* ═════ 12 · #117 — lire les paramètres n’écrit rien, pour aucun rôle ═════ */
titre('12 · Non-régression #117 — cinq rôles non-admin lisent sans écrire');
{
  for (const cle of ['manager', 'chef', 'responsable', 'technique', 'visiteur']) {
    const { contexte, page } = await ouvrir(cle, { sonderFile: false });
    await remise(page);
    await page.evaluate(async () => { const c = await import('/settings-contract.js'); await c.getPlatformSettings().catch(() => {}); });
    await page.waitForTimeout(4000);
    const ecritures = await page.evaluate(() => window.__net);
    const file = await fileDe(page);
    const echouees = file.filter(e => e.store === 'settings' && (e.statut === 'failed' || e.statut === 'conflict'));
    dit(ecritures.filter(r => /settings/.test(r.chemin)).length === 0, `${cle} : aucune écriture implicite sur les paramètres`, JSON.stringify(ecritures.map(r => `${r.methode} ${r.chemin} ${r.statut}`)));
    dit(ecritures.filter(r => r.statut === 403).length === 0, `${cle} : aucun 403`, String(ecritures.filter(r => r.statut === 403).length));
    dit(echouees.length === 0, `${cle} : aucune entrée de paramètres en échec`, JSON.stringify(echouees));
    await contexte.close();
  }
}

/* ═════ 13 · ENDURANCE ═════ */
titre('13 · Endurance — cycles répétés hors ligne / en ligne / arrière-plan');
{
  const SOAK_MS = Number(process.env.GATE_SOAK_MS || 130000);
  const { contexte, page, reseau } = await ouvrir('admin');
  const secondOnglet = await contexte.newPage();
  await secondOnglet.goto('about:blank');
  await remise(page);
  const debut = Date.now();
  let tours = 0;
  const doubles = [];
  while (Date.now() - debut < SOAK_MS) {
    tours += 1;
    await reseau(true);
    await page.waitForTimeout(200);
    await page.evaluate(async tour => {
      const { db } = await import('/db.js');
      const reglages = await db._getRaw('settings', 'global');
      await db.save('settings', { ...reglages, autoLogout: 40 + (tour % 9) }).catch(() => {});
      const salle = (await db.getAll('rooms')).find(r => String(r.id) === 'ui-polish-salle-libre');
      if (salle) await db.save('rooms', { ...salle, description: `soak-${tour}` }).catch(() => {});
      await new Promise(r => setTimeout(r, 800));
    }, tours);
    await secondOnglet.bringToFront();          // arrière-plan
    await page.waitForTimeout(600);
    await reseau(false);
    await page.bringToFront();                  // premier plan + réseau, ensemble
    await page.waitForTimeout(5200);
    /*
     * Seules comptent les requêtes qui ont ATTEINT le serveur. Une tentative avortée par la
     * coupure — `saveWithCentralSync` essaie d'abord, met en file ensuite — n'a rien envoyé
     * à personne : la compter ferait passer le contrat hors ligne pour un double envoi.
     */
    const envois = await page.evaluate(() => { const n = window.__net.slice(); window.__net.length = 0; return n; });
    const parCible = new Map();
    for (const r of envois) {
      if (typeof r.statut !== 'number') continue;
      parCible.set(r.chemin, (parCible.get(r.chemin) || 0) + 1);
    }
    for (const [chemin, n] of parCible) if (n > 1) doubles.push(`tour ${tours} · ${chemin} × ${n}`);
  }
  /*
   * LA CONVERGENCE SE CONSTATE, ELLE NE SE DÉCRÈTE PAS.
   *
   * `accorderRevision` refuse d'estampiller une fiche qui a bougé depuis l'envoi — c'est la
   * garde de #120, et elle est voulue : la révision est alors rattrapée par l'instantané
   * suivant, pas par l'accusé. Une seule relance ne suffit pas à l'observer, parce qu'elle
   * peut REJOINDRE une reprise déjà partie, dont l'instantané est plus ancien que le dernier
   * accusé. On laisse donc plusieurs occasions, et c'est l'issue qu'on juge.
   */
  const attendu = revServeur('settings', 'global');
  let convergee = false;
  for (let essai = 0; essai < 8 && !convergee; essai += 1) {
    await page.evaluate(async () => { await (await import('/db.js')).db.enableCentralSync({ bootstrapLocal: false }).catch(() => {}); });
    await page.waitForTimeout(2000);
    convergee = String(await page.evaluate(async () => (await (await import('/db.js')).db._getRaw('settings', 'global'))?._revision)) === attendu;
  }
  const fin = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const file = await db.getAll('syncQueue');
    return {
      erreurs: window.__erreurs,
      enSuspens: file.filter(e => ['pending', 'processing'].includes(e.status ?? 'pending')).map(e => `${e.storeName}/${e.entityId}:${e.status}`),
      autoLogout: (await db._getRaw('settings', 'global'))?.autoLogout,
      rev: (await db._getRaw('settings', 'global'))?._revision
    };
  });
  console.log(`     ${tours} cycles en ${Math.round((Date.now() - debut) / 1000)} s`);
  dit(tours >= 8, 'l’endurance a bien enchaîné plusieurs cycles complets', `${tours}`);
  dit(doubles.length === 0, 'aucun envoi en double sur toute la durée', doubles.slice(0, 5).join(' | ') || 'aucun');
  dit(fin.enSuspens.length === 0, 'aucune entrée bloquée en fin de course', JSON.stringify(fin.enSuspens));
  dit(fin.erreurs.length === 0, 'aucune exception', fin.erreurs.slice(0, 3).join(' | ') || 'aucune');
  dit(convergee, 'la révision finit par converger avec celle du serveur', `${fin.rev} vs ${attendu}`);
  await secondOnglet.close();
  await contexte.close();
}

console.log(`\n╚═══ ${verifs - echecs}/${verifs} vérifications · ${echecs === 0 ? 'GATE PASS' : `GATE FAIL (${echecs})`} ═══╝\n`);
await navigateur.close();
process.exit(echecs === 0 ? 0 : 1);
