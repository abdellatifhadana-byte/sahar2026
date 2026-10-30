/**
 * @file scripts/revision-ack-gate.mjs — SETTINGS-REVISION-01 (#120), le contrat d'accusé de réception.
 *
 * CE QUI SE PASSAIT
 * -----------------
 * Une écriture partait avec la révision N, le serveur l'acceptait et passait à N+1 — mais
 * sa réponse ne disait que « c'est écrit ». La projection locale restait à N, et l'écriture
 * légitime SUIVANTE se faisait refuser en 409 STALE_WRITE : un conflit sans deuxième
 * auteur. Mesuré sur `settings`, `rooms` et `docs` : le défaut n'était pas propre aux
 * paramètres, il était dans le contrat d'écriture central.
 *
 * CE QUE CETTE ÉPREUVE VÉRIFIE
 * ----------------------------
 * Que l'accusé de réception porte la révision, que la projection l'apprend, et surtout
 * qu'elle ne l'apprend PAS au prix d'une saisie plus récente : l'écriture locale précède
 * l'appel réseau, donc une autre modification peut occuper la place pendant l'attente.
 *
 * Elle vérifie aussi tout ce que le correctif n'a pas le droit de casser : un vrai conflit
 * entre deux sessions reste 409, un refus n'avance jamais la révision locale, un geste
 * utilisateur ne produit qu'un seul PUT, et la réconciliation n'émet aucun événement métier.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const REPO = process.env.REPO_DIR || new URL('..', import.meta.url).pathname;
const { BASE, COMPTES, motDePasseDe, ZONE, SALLE_LIBRE } = await import(`file://${REPO}/scripts/ui-polish-decor.mjs`);
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sql = requete => execSync(`psql "${process.env.DATABASE_URL}" -tAc "${requete}"`).toString().trim();
const revServeur = (magasin, id) =>
  sql(`select coalesce(data->>'_revision','ABSENT') from platform_records where store_name='${magasin}' and record_id='${id}' and not deleted`);

let echecs = 0, verifs = 0;
const dit = (condition, message, detail = '') => {
  verifs += 1;
  console.log(`  ${condition ? '✅' : '❌'} ${message}${detail ? ` → ${detail}` : ''}`);
  if (!condition) echecs += 1;
};
const titre = texte => console.log(`\n━━━ ${texte} ━━━`);

/* La sonde compte les PUT réseau et les événements métier, sans rien modifier au produit. */
const SONDE = () => {
  window.__net = [];
  window.__evt = [];
  for (const nom of ['platform-entity-updated', 'platform-entity-deleted', 'platform-settings-updated']) {
    window.addEventListener(nom, event => window.__evt.push(`${nom}:${event?.detail?.storeName ?? ''}`));
  }
  const original = window.fetch;
  window.fetch = async (cible, options = {}) => {
    const url = typeof cible === 'string' ? cible : cible?.url || String(cible);
    const methode = (options.method || (typeof cible === 'object' && cible?.method) || 'GET').toUpperCase();
    const reponse = await original(cible, options);
    if (methode !== 'GET' && /\/api\/data\//.test(url)) {
      window.__net.push({ methode, chemin: new URL(url, location.origin).pathname, statut: reponse.status });
    }
    return reponse;
  };
};

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
const ouvrir = async cle => {
  const compte = COMPTES[cle];
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
  await contexte.addInitScript(SONDE);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 60000 });
  await page.fill('#login-username', compte.username);
  await page.fill('#login-password', motDePasseDe(compte));
  await page.click('#login-submit');
  await page.waitForSelector('#login-form', { state: 'detached', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(10000);
  return { contexte, page };
};
const revLocale = (page, magasin, id) => page.evaluate(async ([m, i]) => {
  const { db } = await import('/db.js');
  const fiche = await db._getRaw(m, i);
  return fiche ? (fiche._revision ?? '∅') : 'ABSENT';
}, [magasin, id]);

/*
 * Le décor de sonde est retiré AVANT de commencer : une épreuve qui hérite de ses propres
 * traces mesure l'histoire de ses passages précédents, pas le produit. C'est exactement
 * ainsi qu'une épreuve devient capricieuse.
 */
const cookieAdmin = execSync(
  `curl -s -i -X POST ${BASE}/api/auth/login -H 'content-type: application/json' ` +
  `-d '{"username":"${process.env.PLATFORM_ADMIN_USERNAME}","password":"${process.env.PLATFORM_ADMIN_PASSWORD}"}' | ` +
  `grep -i '^set-cookie' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1`
).toString().trim();
for (const [magasin, id] of [['rooms', 'rev-salle'], ['equipments', 'rev-eq'], ['docs', 'rev-doc'],
  ['notes', 'rev-note'], ['docs', 'rev-ack-docs'], ['rooms', 'rev-ack-rooms'], ['rooms', 'rev-salle-diag']]) {
  execSync(`curl -s -o /dev/null -X DELETE ${BASE}/api/data/${magasin}/${id} -H "cookie: ${cookieAdmin}"`);
}
/*
 * Le ménage passe par l'API, jamais par une écriture directe dans `platform_records` :
 * l'invariant REV·26 veut que TOUTE mutation traverse le magasin de révisions, et une
 * épreuve qui s'en dispenserait ouvrirait précisément la porte dérobée qu'elle surveille.
 */

console.log(`\n╔═══ SETTINGS-REVISION-01 · contrat d'accusé de réception — ${BASE} ═══╗`);

/* ═════ 1 · L'accusé porte la révision, et la projection l'apprend ═════ */
titre('1 · Cinq sauvegardes consécutives, sans rechargement ni instantané');
{
  const { contexte, page } = await ouvrir('admin');
  const depart = Number(revServeur('settings', 'global'));
  await page.evaluate(() => { window.__net.length = 0; window.__evt.length = 0; });
  const suite = await page.evaluate(async () => {
    const contrat = await import('/settings-contract.js');
    const { db } = await import('/db.js');
    const etapes = [];
    for (let n = 1; n <= 5; n += 1) {
      try {
        await contrat.savePlatformSettings({ autoLogout: 20 + n });
        const fiche = await db._getRaw('settings', 'global');
        etapes.push({ n, ok: true, locale: fiche?._revision ?? '∅' });
      } catch (erreur) { etapes.push({ n, ok: false, erreur: String(erreur.message).slice(0, 60) }); }
    }
    return etapes;
  });
  for (const etape of suite) console.log(`     sauvegarde ${etape.n} : ${etape.ok ? `OK · révision locale ${etape.locale}` : `REFUS ${etape.erreur}`}`);
  dit(suite.every(e => e.ok), 'les cinq sauvegardes légitimes aboutissent');
  const arrivee = Number(revServeur('settings', 'global'));
  dit(arrivee === depart + 5, 'le serveur a bien avancé de cinq révisions', `${depart} → ${arrivee}`);
  dit(Number(suite.at(-1).locale) === arrivee, 'la projection locale porte la révision finale du serveur', `${suite.at(-1).locale} vs ${arrivee}`);
  const reseau = await page.evaluate(() => window.__net);
  const puts = reseau.filter(r => r.methode === 'PUT' && /settings\/global/.test(r.chemin));
  dit(puts.length === 5, 'un geste utilisateur = un seul PUT réseau', `${puts.length} PUT pour 5 sauvegardes`);
  dit(puts.every(p => p.statut === 200), 'aucun 409 illégitime', puts.map(p => p.statut).join(','));
  await contexte.close();
}

/* ═════ 2 · Le point critique : une saisie plus récente pendant l'attente ═════ */
titre('2 · Une saisie locale survient PENDANT le PUT — elle ne doit pas être écrasée');
{
  const { contexte, page } = await ouvrir('admin');
  const resultat = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const contrat = await import('/settings-contract.js');
    const avant = await db._getRaw('settings', 'global');

    // On retient la RÉPONSE du serveur — la requête part, le serveur avance — pour ouvrir
    // la fenêtre exacte que le correctif doit respecter.
    let relacher;
    const attente = new Promise(resolve => { relacher = resolve; });
    const original = window.fetch;
    window.fetch = async (cible, options = {}) => {
      const url = typeof cible === 'string' ? cible : cible?.url || String(cible);
      const methode = (options.method || 'GET').toUpperCase();
      const reponse = await original(cible, options);
      if (methode === 'PUT' && /settings\/global/.test(url)) { await attente; }
      return reponse;
    };

    const ecritureA = contrat.savePlatformSettings({ autoLogout: 111 });   // non attendue
    await new Promise(r => setTimeout(r, 1200));                            // le PUT est parti
    // Saisie B, plus récente, posée directement dans la projection locale.
    const pendant = await db._getRaw('settings', 'global');
    await db._putRawLocalPourEpreuve?.('settings');                         // no-op : garde de lisibilité
    const bDirect = { ...pendant, autoLogout: 222, theme: 'dark' };
    await new Promise((resolve, reject) => {
      const transaction = db.db.transaction('settings', 'readwrite');
      const requete = transaction.objectStore('settings').put(bDirect);
      requete.onsuccess = () => resolve(); requete.onerror = () => reject(requete.error);
    });
    relacher();
    await ecritureA.catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    window.fetch = original;
    const apres = await db._getRaw('settings', 'global');
    return {
      revisionAvant: avant?._revision ?? '∅',
      contenuApres: { autoLogout: apres?.autoLogout, theme: apres?.theme },
      revisionApres: apres?._revision ?? '∅'
    };
  });
  console.log(`     avant : révision ${resultat.revisionAvant}`);
  console.log(`     après : ${JSON.stringify(resultat.contenuApres)} · révision ${resultat.revisionApres}`);
  dit(resultat.contenuApres.autoLogout === 222 && resultat.contenuApres.theme === 'dark',
    'la saisie plus récente (222/dark) a SURVÉCU à l’accusé de réception de la précédente',
    JSON.stringify(resultat.contenuApres));
  dit(String(resultat.revisionApres) === String(resultat.revisionAvant),
    'aucune révision inventée n’a été posée sur cette saisie non acquittée',
    `${resultat.revisionAvant} → ${resultat.revisionApres}`);
  await contexte.close();
}

/* ═════ 3 · Cinq magasins révisionnés, pas seulement les paramètres ═════ */
titre('3 · Le contrat vaut pour tout magasin révisionné');
{
  const { contexte, page } = await ouvrir('admin');
  const CAS = [
    { magasin: 'settings',   id: 'global',        creer: null, champ: 'autoLogout', valeurs: [31, 32] },
    { magasin: 'rooms',      id: 'rev-salle',     creer: { id: 'rev-salle', name: 'Salle révision', location: 'Casablanca', zoneId: ZONE }, champ: 'name', valeurs: ['Salle révision A', 'Salle révision B'] },
    { magasin: 'equipments', id: 'rev-eq',        creer: { id: 'rev-eq', name: 'Équipement révision', type: 'Convertisseur', status: 'actif', roomId: SALLE_LIBRE, salleId: SALLE_LIBRE, baieId: 'ui-polish-baie', zoneId: ZONE }, champ: 'name', valeurs: ['Équipement A', 'Équipement B'] },
    { magasin: 'docs',       id: 'rev-doc',       creer: { id: 'rev-doc', title: 'Doc révision', content: 'v0', targetType: 'platform' }, champ: 'content', valeurs: ['v1', 'v2'] },
    { magasin: 'notes',      id: 'rev-note',      creer: { id: 'rev-note', text: 'Note révision', targetType: 'platform', targetId: 'rev-doc' }, champ: 'text', valeurs: ['Note A', 'Note B'] }
  ];
  for (const cas of CAS) {
    const suite = await page.evaluate(async c => {
      const { db } = await import('/db.js');
      const etapes = [];
      if (c.creer) { try { await db.save(c.magasin, c.creer); } catch (e) { etapes.push({ creation: String(e.message).slice(0, 50) }); } }
      await new Promise(r => setTimeout(r, 2200));
      for (const valeur of c.valeurs) {
        const courant = await db._getRaw(c.magasin, c.id);
        const avant = courant?._revision ?? '∅';
        try {
          await db.save(c.magasin, { ...courant, [c.champ]: valeur });
          const apres = (await db._getRaw(c.magasin, c.id))?._revision ?? '∅';
          etapes.push({ ok: true, avant, apres });
        } catch (e) { etapes.push({ ok: false, avant, erreur: String(e.message).slice(0, 45) }); }
        await new Promise(r => setTimeout(r, 1800));
      }
      return etapes;
    }, cas);
    const ecritures = suite.filter(e => 'ok' in e);
    const serveur = revServeur(cas.magasin, cas.id);
    const derniere = ecritures.at(-1);
    console.log(`     ${cas.magasin}/${cas.id} : ${ecritures.map(e => e.ok ? `${e.avant}→${e.apres}` : `REFUS(${e.erreur})`).join(' · ')} · serveur=${serveur}`);
    dit(ecritures.every(e => e.ok), `${cas.magasin} : deux écritures consécutives réussissent`);
    dit(derniere && String(derniere.apres) === String(serveur), `${cas.magasin} : la révision locale suit le serveur`, `${derniere?.apres} vs ${serveur}`);
  }
  await contexte.close();
}

/* ═════ 4 · Une vraie concurrence reste un vrai conflit ═════ */
titre('4 · Deux sessions Admin — la seconde, réellement périmée, doit rester 409');
{
  const a = await ouvrir('admin');
  const b = await ouvrir('admin');
  const revA = await revLocale(a.page, 'settings', 'global');
  const revB = await revLocale(b.page, 'settings', 'global');
  dit(String(revA) === String(revB), 'les deux sessions partent de la même révision', `A=${revA} B=${revB}`);
  const ecritA = await a.page.evaluate(async () => {
    const contrat = await import('/settings-contract.js');
    try { await contrat.savePlatformSettings({ autoLogout: 77 }); return 'ok'; } catch (e) { return `REFUS ${String(e.message).slice(0, 40)}`; }
  });
  await a.page.waitForTimeout(2500);
  dit(ecritA === 'ok', 'la session A écrit', ecritA);
  dit(String(await revLocale(a.page, 'settings', 'global')) === revServeur('settings', 'global'),
    'A a appris la nouvelle révision', `A=${await revLocale(a.page, 'settings', 'global')} serveur=${revServeur('settings', 'global')}`);
  dit(String(await revLocale(b.page, 'settings', 'global')) === String(revB),
    'B n’a PAS été rafraîchie à distance par l’écriture de A', `B=${await revLocale(b.page, 'settings', 'global')}`);
  const ecritB = await b.page.evaluate(async () => {
    const contrat = await import('/settings-contract.js');
    try { await contrat.savePlatformSettings({ autoLogout: 88 }); return 'ACCEPTÉE'; } catch (e) { return `409:${e.code || ''} ${String(e.message).slice(0, 40)}`; }
  });
  await b.page.waitForTimeout(2000);
  dit(/409|modifiée par un autre/.test(ecritB), 'l’écriture réellement périmée de B est REFUSÉE', ecritB);
  dit(revServeur('settings', 'global') !== 'ABSENT' && sql("select data->>'autoLogout' from platform_records where store_name='settings' and record_id='global'") === '77',
    'la valeur de A n’a pas été écrasée par B', sql("select data->>'autoLogout' from platform_records where store_name='settings' and record_id='global'"));
  await a.contexte.close(); await b.contexte.close();
}

/* ═════ 5 · Un refus n'avance jamais la révision locale ═════ */
titre('5 · Refus serveur — la révision locale ne bouge pas');
{
  const { contexte, page } = await ouvrir('technique');   // rôle sans droit d'écriture Settings
  const avant = await revLocale(page, 'settings', 'global');
  const refus = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const courant = await db._getRaw('settings', 'global');
    try { await db.save('settings', { ...courant, autoLogout: 5 }); return 'ACCEPTÉE'; }
    catch (e) { return `refus ${e.status || ''}`; }
  });
  await page.waitForTimeout(2500);
  const apres = await revLocale(page, 'settings', 'global');
  dit(/refus/.test(refus), 'le rôle non autorisé est refusé (403)', refus);
  dit(String(apres) === String(avant) || apres === 'ABSENT', 'aucune révision locale avancée après un 403', `${avant} → ${apres}`);
  await contexte.close();
}
{
  const { contexte, page } = await ouvrir('admin');
  const resultat = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const courant = await db._getRaw('settings', 'global');
    // on rend la copie locale périmée à dessein : le serveur doit refuser
    await new Promise((resolve, reject) => {
      const t = db.db.transaction('settings', 'readwrite');
      const r = t.objectStore('settings').put({ ...courant, _revision: 1 });
      r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
    });
    const avant = (await db._getRaw('settings', 'global'))?._revision;
    let issue; try { await db.save('settings', { ...courant, _revision: 1, autoLogout: 9 }); issue = 'ACCEPTÉE'; }
    catch (e) { issue = `${e.status} ${e.code || ''}`; }
    await new Promise(r => setTimeout(r, 1500));
    return { avant, issue, apres: (await db._getRaw('settings', 'global'))?._revision };
  });
  dit(/409/.test(resultat.issue), 'une écriture réellement périmée reste refusée en 409', resultat.issue);
  dit(Number(resultat.apres) !== Number(resultat.avant) + 1, 'la révision locale n’a pas été avancée artificiellement', `${resultat.avant} → ${resultat.apres}`);
  await contexte.close();
}

/* ═════ 6 · Hors ligne : mise en file, rejeu, réconciliation ═════ */
titre('6 · File hors ligne — le rejeu apprend la révision sans écraser');
{
  const { contexte, page } = await ouvrir('admin');
  const resultat = await page.evaluate(async () => {
    const { db } = await import('/db.js');
    const contexteHorsLigne = async () => { await contexte.setOffline?.(true); };
    // On simule la coupure au niveau du transport : les PUT échouent, le reste vit.
    const original = window.fetch;
    let coupe = true;
    window.fetch = async (cible, options = {}) => {
      const url = typeof cible === 'string' ? cible : cible?.url || String(cible);
      const methode = (options.method || 'GET').toUpperCase();
      if (coupe && methode === 'PUT' && /\/api\/data\//.test(url)) { const e = new Error('réseau coupé'); e.status = 0; throw e; }
      return original(cible, options);
    };
    const courant = await db._getRaw('settings', 'global');
    await db.save('settings', { ...courant, autoLogout: 133 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    const file = (await db.getAll('syncQueue')).filter(x => x.storeName === 'settings');
    const revPendant = (await db._getRaw('settings', 'global'))?._revision;
    coupe = false;
    await db.processSyncQueue?.();
    await new Promise(r => setTimeout(r, 2500));
    window.fetch = original;
    const apres = await db._getRaw('settings', 'global');
    const fileApres = (await db.getAll('syncQueue')).filter(x => x.storeName === 'settings');
    return { enFile: file.length, revPendant, revApres: apres?._revision, valeur: apres?.autoLogout, resteEnFile: fileApres.length };
  });
  console.log(`     mise en file : ${resultat.enFile} · révision pendant la coupure : ${resultat.revPendant}`);
  dit(resultat.enFile >= 1, 'la modification hors ligne est mise en file');
  dit(resultat.valeur === 133, 'le contenu saisi hors ligne est préservé après rejeu', String(resultat.valeur));
  dit(String(resultat.revApres) === revServeur('settings', 'global'),
    'après rejeu réussi, la révision locale est celle du serveur', `${resultat.revApres} vs ${revServeur('settings', 'global')}`);
  dit(resultat.resteEnFile === 0, 'la file est vidée', String(resultat.resteEnFile));
  await contexte.close();
}

/* ═════ 7 · Aucun événement métier supplémentaire, aucun PUT supplémentaire ═════ */
titre('7 · La réconciliation est une métadonnée : ni event métier, ni second PUT');
{
  const { contexte, page } = await ouvrir('admin');
  await page.evaluate(() => { window.__net.length = 0; window.__evt.length = 0; });
  await page.evaluate(async () => { const c = await import('/settings-contract.js'); await c.savePlatformSettings({ autoLogout: 44 }); });
  await page.waitForTimeout(3000);
  const mesure = await page.evaluate(() => ({ net: window.__net, evt: window.__evt }));
  const puts = mesure.net.filter(r => r.methode === 'PUT' && /settings\/global/.test(r.chemin));
  dit(puts.length === 1, 'une sauvegarde = exactement un PUT réseau', `${puts.length}`);
  const metier = mesure.evt.filter(e => e.startsWith('platform-entity-updated'));
  dit(metier.length <= 1, 'aucun événement métier en double', `${metier.length} · ${mesure.evt.join(', ') || 'aucun'}`);
  await contexte.close();
}

/* ═════ 8 · docs conserve son contrat particulier ═════ */
titre('8 · docs — la fiche assainie est toujours rendue, en plus de la révision');
{
  const put = magasin => JSON.parse(execSync(
    `curl -s -X PUT ${BASE}/api/data/${magasin}/rev-ack-${magasin} -H "cookie: ${cookieAdmin}" -H 'content-type: application/json' ` +
    `-d '{"id":"rev-ack-${magasin}","title":"T","content":"c","targetType":"platform","name":"N","location":"Casablanca","zoneId":"${ZONE}"}'`
  ).toString());
  const docs = put('docs');
  dit(Number.isSafeInteger(docs.revision) && docs.revision > 0, 'docs : l’accusé porte la révision', JSON.stringify(docs).slice(0, 90));
  dit(docs.record && typeof docs.record === 'object', 'docs : la fiche assainie est toujours présente', Object.keys(docs.record || {}).slice(0, 6).join(','));
  const rooms = put('rooms');
  dit(Number.isSafeInteger(rooms.revision) && rooms.revision > 0, 'rooms : l’accusé porte la révision', JSON.stringify(rooms).slice(0, 90));
  dit(!('record' in rooms), 'rooms : aucune fiche complète n’est renvoyée sans nécessité', JSON.stringify(rooms).slice(0, 90));
}

await navigateur.close();
console.log(`\n╚═══ ${echecs ? `❌ ${echecs} ÉCHEC(S) sur ${verifs} vérifications` : `✅ VERT sur ${verifs} vérifications`} ═══╝\n`);
process.exit(echecs ? 1 : 0);
