import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const serveur = lire('scripts/serve.js');
const sync = lire('central-sync.js');

const sansCommentaires = source => source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map(l => /^\s*(\/\/|\*)/.test(l) ? '' : l).join('\n');

/*
 * DEUX CONTRATS SE SUPERPOSENT ICI, ET LE SECOND A CHANGÉ LE PREMIER.
 *
 * LE POIDS (d'origine). L'image du plan vivait en base64 dans `settings/global` —
 * l'enregistrement que CHAQUE poste reçoit dans CHAQUE instantané, toutes les vingt
 * secondes. Mesuré sur une charge d'un mégaoctet : l'instantané passait de 292 257 à
 * 1 292 493 octets, soit 2,9 Mo par minute et par poste. L'instantané ne porte donc plus
 * qu'une empreinte, et les octets voyagent par une route dédiée. Cette économie est
 * conservée, et ces épreuves la gardent.
 *
 * LA CONFIDENTIALITÉ (lot #131). L'audit #130 a montré que la route dédiée ne vérifiait
 * que la session : un Visiteur d'un autre département recevait le plan entier. Trois
 * comportements écrits pour la DISPONIBILITÉ sont devenus des fuites, et deux épreuves de
 * ce fichier les gardaient explicitement :
 *
 *   « seule une charge base64 est retirée : un chemin doit passer »
 *        → le chemin était précisément ce que le poste suivait pour prendre le fichier
 *          hors de toute autorisation. La source est désormais retirée DANS TOUS LES CAS.
 *
 *   « hors ligne, on garde le dernier plan connu »
 *        → appliqué à un 403, cela réaffiche le document qu'on vient de refuser.
 *          Un refus ne rend plus rien.
 *
 * Ces deux épreuves sont donc REMPLACÉES par leur contraire, et non réparées : elles
 * gardaient un contrat que ce lot annule.
 *
 * ET ELLES S'EXÉCUTENT. Les assertions de texte ne pouvaient pas voir la fuite — les 1 261
 * tests de la base étaient au vert pendant que le plan sortait. Ce qui peut être exécuté
 * l'est ; ce qui ne peut pas l'être (le corps du serveur, qui ouvre un port et une base)
 * est vérifié par le gate `scripts/map-fail-closed-gate.mjs`, sur PostgreSQL et Chromium.
 */

test('l’instantané ne transporte plus les octets du plan, ni sa source', () => {
  const code = sansCommentaires(serveur);
  assert.match(code, /function stripMapImagePayload\(record\)/);
  assert.match(code, /delete allege\.mapImageUrl;/);
  // La retenue conditionnelle a disparu : un chemin ne doit pas davantage sortir qu'une
  // charge, puisqu'il suffit à aller chercher le fichier.
  assert.doesNotMatch(code, /if \(!url\.startsWith\('data:'\)\) return record;/,
    'un plan désigné par un chemin doit être masqué comme une charge base64');
  assert.match(code, /if \(storeName === 'settings' && String\(record\?\.id\) === 'global'\) \{\s*return stripMapImagePayload/);
});

test('une empreinte remplace la charge, pour détecter un changement', () => {
  const code = sansCommentaires(serveur);
  assert.match(code, /createHmac\('sha256', 'map-image'\)/);
  assert.match(code, /allege\.mapImageRef = empreinte/);
});

test('la route des octets demande au moteur d’accès avant de lire quoi que ce soit', () => {
  const code = sansCommentaires(serveur);
  assert.match(code, /url\.pathname === '\/api\/settings\/map-image'/);
  assert.match(code, /await access\.canReadOperationalMap\(user\)/,
    'la décision revient au moteur d’accès, pas à un test de rôle écrit sur place');
  assert.match(code, /MAP_SCOPE_FORBIDDEN/);
  // Le refus doit précéder la lecture des octets : refuser ne doit pas coûter le fichier.
  const bloc = code.slice(code.indexOf("url.pathname === '/api/settings/map-image'"));
  assert.ok(bloc.indexOf('canReadOperationalMap') < bloc.indexOf('SELECT data FROM'),
    'la garde doit être franchie avant la requête qui lit le plan');
  // Et la garantie de cache vaut pour TOUTE réponse d'API, pas seulement pour celle-ci :
  // la poser une seconde fois ici laisserait croire que les autres en sont dispensées.
  assert.match(code, /function json\(res, status, payload, extraHeaders = \{\}\) \{\s*res\.writeHead\(status, \{[^}]*'Cache-Control': 'no-store'/,
    'les octets du plan ne doivent survivre dans aucun cache après la perte de l’habilitation');
});

test('le cache local ne repart jamais vers le serveur', async () => {
  /*
   * S'il repartait, il serait réintégré à l'instantané et l'on aurait tout reconstruit pour
   * rien. Depuis #131 il n'est PLUS ÉCRIT du tout — mais un poste ayant tourné sur une
   * version précédente le porte encore, et ces deux protections restent donc utiles
   * jusqu'à ce que `forgetMapImage()` soit passé dessus.
   */
  const propriete = await import('../record-ownership-contract.js');
  assert.deepEqual([...propriete.STRICT_LOCAL_SETTINGS].sort(), ['current-room', 'map-image-cache']);
  assert.equal(propriete.isStrictLocalRecord('settings', 'map-image-cache'), true,
    'le cache du plan ne doit jamais partir vers le serveur');
  assert.equal(propriete.isStrictLocalRecord('settings', 'global'), false,
    'la protection vise deux identifiants nommés, pas le magasin entier');

  assert.match(sync, /from '\.\/record-ownership-contract\.js'/);
  assert.doesNotMatch(sync, /new Set\(\['current-room', 'map-image-cache'\]\)/,
    'deux copies de la même règle finissent toujours par diverger');

  const code = sansCommentaires(serveur);
  assert.equal((code.match(/\['current-room', 'map-image-cache'\]\.includes/g) || []).length, 2,
    'une des deux portes d’écriture laisse encore passer le cache local');
});

/* ────────── le magasin client, EXÉCUTÉ ────────── */

/** Remplace `fetch` le temps d'une épreuve, et compte les appels. */
async function avecFetch(reponse, corps) {
  const original = globalThis.fetch;
  const appels = [];
  globalThis.fetch = async (url, options) => { appels.push({ url, options }); return reponse(); };
  try { return await corps(appels); }
  finally { globalThis.fetch = original; }
}

const ok = charge => () => ({ ok: true, status: 200, json: async () => charge });
const refus = status => () => ({ ok: false, status, json: async () => ({ error: 'MAP_SCOPE_FORBIDDEN' }) });
const PLAN = 'data:image/png;base64,AAAA';

test('un refus du serveur ne rend AUCUN plan', async () => {
  const { resolveMapImageUrl } = await import('../map-image-store.js');
  for (const status of [401, 403]) {
    await avecFetch(refus(status), async () => {
      const url = await resolveMapImageUrl({ mapImageRef: 'abc' });
      assert.equal(url, null, `un ${status} doit rendre null, jamais une image`);
    });
  }
});

test('une panne réseau ne ressuscite pas le plan d’hier', async () => {
  const { resolveMapImageUrl } = await import('../map-image-store.js');
  await avecFetch(ok({ mapImageRef: 'abc', mapImageUrl: PLAN }), async () => {
    assert.equal(await resolveMapImageUrl({ mapImageRef: 'abc' }), PLAN);
  });
  await avecFetch(() => { throw new Error('hors ligne'); }, async () => {
    assert.equal(await resolveMapImageUrl({ mapImageRef: 'abc' }), null,
      'pour un document restreint, « pas de plan » est la seule réponse sûre');
  });
});

test('le serveur est réinterrogé à CHAQUE ouverture, jamais court-circuité', async () => {
  const { resolveMapImageUrl } = await import('../map-image-store.js');
  await avecFetch(ok({ mapImageRef: 'abc', mapImageUrl: PLAN }), async appels => {
    await resolveMapImageUrl({ mapImageRef: 'abc' });
    await resolveMapImageUrl({ mapImageRef: 'abc' });
    await resolveMapImageUrl({ mapImageRef: 'abc' });
    assert.equal(appels.length, 3,
      'des octets déjà reçus ne prouvent pas qu’ils sont encore dus : ' +
      'une habilitation révoquée doit fermer la carte à l’ouverture suivante');
  });
  // Et la révocation, mesurée : la même session bascule sur un refus.
  await avecFetch(refus(403), async () => {
    assert.equal(await resolveMapImageUrl({ mapImageRef: 'abc' }), null);
  });
});

test('AUCUNE valeur locale ne fait autorité — chemin, data: ou URL distante', async () => {
  /*
   * LEGACY-DATA-1. La première version rendait directement une charge `data:` trouvée dans
   * les réglages locaux, sans appeler le serveur : sur un poste partagé, hors ligne, le
   * plan laissé par un administrateur atteignait l'utilisateur suivant. Trois formes sont
   * éprouvées ici, parce que les trois peuvent dormir dans une projection locale héritée.
   */
  const { resolveMapImageUrl } = await import('../map-image-store.js');
  for (const local of [
    { mapImageUrl: 'assets/plan-technique.PNG' },
    { mapImageUrl: 'data:image/png;base64,UExBTi1DT05GSURFTlRJRUw=' },
    { mapImageUrl: 'https://ancien-hote.test/plan.png' },
    { mapImageUrl: 'data:image/png;base64,AAAA', mapImageRef: 'abc' },
    {}
  ]) {
    await avecFetch(refus(403), async appels => {
      assert.equal(await resolveMapImageUrl(local), null,
        `une valeur locale ${JSON.stringify(local).slice(0, 40)} ne prouve aucune autorisation`);
      assert.equal(appels.length, 1,
        'le serveur doit être interrogé même quand le poste croit déjà connaître le plan');
    });
  }
});

test('le client refuse toute référence que le serveur ne devrait pas rendre', async () => {
  const { resolveMapImageUrl } = await import('../map-image-store.js');
  for (const dangereuse of [
    'javascript:alert(1)', 'file:///etc/passwd', 'ftp://hote/plan.png',
    'assets/plan-technique.PNG', 'data:text/html;base64,PHNjcmlwdD4=', ''
  ]) {
    await avecFetch(ok({ mapImageRef: 'abc', mapImageUrl: dangereuse }), async () => {
      assert.equal(await resolveMapImageUrl({}), null,
        `« ${dangereuse} » ne doit jamais atteindre un attribut src`);
    });
  }
  // Les deux formes légitimes, elles, passent.
  for (const bonne of ['data:image/png;base64,AAAA', 'https://hote.test/plan.png', 'http://hote.test/plan.jpg']) {
    await avecFetch(ok({ mapImageRef: 'abc', mapImageUrl: bonne }), async () => {
      assert.equal(await resolveMapImageUrl({}), bonne);
    });
  }
});

test('un seul aller-retour quand plusieurs vues demandent le plan ensemble', async () => {
  const { resolveMapImageUrl } = await import('../map-image-store.js');
  await avecFetch(ok({ mapImageRef: 'abc', mapImageUrl: PLAN }), async appels => {
    const [a, b, c] = await Promise.all([
      resolveMapImageUrl({ mapImageRef: 'abc' }),
      resolveMapImageUrl({ mapImageRef: 'abc' }),
      resolveMapImageUrl({ mapImageRef: 'abc' })
    ]);
    assert.deepEqual([a, b, c], [PLAN, PLAN, PLAN]);
    assert.equal(appels.length, 1, 'trois vues simultanées ne doivent faire qu’une requête');
  });
});

test('la carte ATTEND la résolution, et n’a plus de plan par défaut', () => {
  const code = sansCommentaires(lire('interactive-map.js'));
  assert.match(code, /const url = await resolveMapImageUrl\(settings\);/);
  assert.doesNotMatch(code, /let mapImage = "assets\/plan-technique\.PNG"/,
    'la carte partait du plan opérationnel avant même d’avoir interrogé le serveur');
  assert.match(code, /if \(!planAutorise\) \{ renderRestrictedMap\(\); return; \}/,
    'sans plan autorisé, aucune carte ne doit être construite');
});
