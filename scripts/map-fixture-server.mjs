/**
 * @file scripts/map-fixture-server.mjs — l'image distante déterministe du gate #131.
 *
 * POURQUOI ELLE EXISTE
 * --------------------
 * Le parcours « Appliquer l'URL » de l'écran des réglages est un comportement CENTRAL du
 * lot : c'est celui que le premier correctif cassait en silence, en remplaçant toute URL
 * distante par le plan intégré. Le gate l'éprouvait avec une image fournie par
 * l'environnement, et se contentait de l'IGNORER quand elle était injoignable — mesuré au
 * Re-Gate indépendant : 51 assertions au lieu de 52, sans que rien ne signale l'absence.
 *
 * Un test central qui s'ignore lui-même vaut moins qu'un test absent : il donne le vert.
 * La fixture est donc livrée avec le gate, servie par lui, et son échec au démarrage fait
 * échouer le gate.
 *
 * CE QU'ELLE SERT
 * ---------------
 * Un PNG 640 × 360 uni, engendré ici même — aucun binaire à versionner, aucune dépendance,
 * et des dimensions volontairement différentes du plan intégré (1280 × 720) pour qu'une
 * confusion entre les deux se voie dans l'assertion plutôt que de passer inaperçue.
 */
import http from 'node:http';
import { deflateSync } from 'node:zlib';

export const FIXTURE_WIDTH = 640;
export const FIXTURE_HEIGHT = 360;

const TABLE_CRC = Array.from({ length: 256 }, (_, index) => {
  let valeur = index;
  for (let bit = 0; bit < 8; bit += 1) valeur = valeur & 1 ? 0xEDB88320 ^ (valeur >>> 1) : valeur >>> 1;
  return valeur >>> 0;
});

const crc32 = octets => {
  let valeur = 0xFFFFFFFF;
  for (const octet of octets) valeur = TABLE_CRC[(valeur ^ octet) & 0xFF] ^ (valeur >>> 8);
  return (valeur ^ 0xFFFFFFFF) >>> 0;
};

const bloc = (type, donnees) => {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const typeEtDonnees = Buffer.concat([Buffer.from(type), donnees]);
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(typeEtDonnees));
  return Buffer.concat([longueur, typeEtDonnees, controle]);
};

/** Le PNG de la fixture, engendré une fois. */
export function fixturePng(largeur = FIXTURE_WIDTH, hauteur = FIXTURE_HEIGHT) {
  const brut = Buffer.alloc((largeur * 3 + 1) * hauteur);
  for (let y = 0; y < hauteur; y += 1) {
    const depart = y * (largeur * 3 + 1);
    brut[depart] = 0;                       // filtre « aucun », ligne par ligne
    for (let x = 0; x < largeur; x += 1) {
      brut[depart + 1 + x * 3] = 200;
      brut[depart + 2 + x * 3] = 80;
      brut[depart + 3 + x * 3] = 40;
    }
  }
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;   // 8 bits par canal
  entete[9] = 2;   // couleur vraie, sans alpha
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloc('IHDR', entete),
    bloc('IDAT', deflateSync(brut)),
    bloc('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Démarre la fixture et rend son URL, ou LÈVE.
 *
 * Aucun repli silencieux : l'appelant doit échouer si l'image ne peut pas être servie.
 */
export function startMapFixture({ port = 0, host = '127.0.0.1' } = {}) {
  const png = fixturePng();
  return new Promise((resolve, reject) => {
    const serveur = http.createServer((requete, reponse) => {
      reponse.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': png.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      reponse.end(requete.method === 'HEAD' ? undefined : png);
    });
    serveur.once('error', reject);
    serveur.listen(port, host, () => {
      const { port: attribue } = serveur.address();
      resolve({
        url: `http://${host}:${attribue}/custom-map.png`,
        largeur: FIXTURE_WIDTH, hauteur: FIXTURE_HEIGHT,
        octets: png.length,
        arreter: () => new Promise(fini => serveur.close(fini))
      });
    });
  });
}

// Exécution directe : sert la fixture sur un port fixe, pour un diagnostic à la main.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { url, octets } = await startMapFixture({ port: Number(process.env.PORT || 4310) });
  console.log(`Fixture ${FIXTURE_WIDTH}×${FIXTURE_HEIGHT} (${octets} octets) servie sur ${url}`);
}
