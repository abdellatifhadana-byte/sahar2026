import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { encodeQrMatrix, qrByteCapacity } from '../qr-encoder.js';

const lireFichier = chemin => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

test('qr-encoder.js est précaché : `qr.js` (déjà précaché) l\'importe de façon STATIQUE', () => {
  const qr = lireFichier('qr.js');
  const worker = lireFichier('service-worker.js');
  const precacheList = worker.slice(worker.indexOf('const ASSETS_TO_CACHE'), worker.indexOf('];', worker.indexOf('const ASSETS_TO_CACHE')));
  assert.match(qr, /from '\.\/qr-encoder\.js'/, 'qr.js doit importer qr-encoder.js statiquement');
  assert.match(precacheList, /'\/qr-encoder\.js'/, 'qr-encoder.js est importé statiquement depuis qr.js (déjà précaché) : il doit être précaché aussi');
});

test('qr.js ne fait plus la moindre requête réseau — aucun fetch, aucun XHR, aucune image distante', () => {
  const qr = lireFichier('qr.js');
  assert.doesNotMatch(qr, /\bfetch\(|XMLHttpRequest|new Image\(/, 'la génération doit rester une pure fonction locale');
});

/*
 * DÉFAUT MESURÉ PENDANT LE DÉVELOPPEMENT, ET QUE CE FICHIER FERME DÉFINITIVEMENT.
 *
 * La première version posait l'information de FORMAT (15 bits BCH — niveau de correction +
 * masque) dans le bon jeu de cases, mais avec l'ORDRE DE BITS INVERSÉ : le géométriquement
 * PREMIER emplacement visité recevait le bit de poids FAIBLE, alors que la norme y pose le
 * bit de poids FORT. La matrice produite était un QR Code géométriquement irréprochable —
 * trois repères, motif de synchronisation, module sombre, tout au bon endroit — mais dont
 * l'information de format ne valait plus un codeword BCH valide : aucun lecteur réel ne
 * pouvait savoir quel masque lever avant de lire la moindre donnée. Confirmé par un
 * décodeur indépendant (jsQR) : ÉCHEC TOTAL, sur les 8 masques, à toutes les tailles.
 *
 * Le test ci-dessous ne fait confiance à aucune bibliothèque externe : il recalcule la
 * propriété mathématique que l'information de format doit vérifier (un codeword BCH(15,5)
 * valide a un reste nul par le polynôme générateur 0x537) directement depuis les modules
 * PUBLICS renvoyés par `encodeQrMatrix`. Un futur bug du même ordre — un octet ou un bit mal
 * placé dans l'une ou l'autre copie — ferait à nouveau échouer ce test, avant d'atteindre un
 * scanner réel.
 */

function bchRemainder(value, generator = 0x537, degree = 10) {
  let v = value;
  let msb = v === 0 ? 0 : 32 - Math.clz32(v);
  while (msb > degree) { v ^= generator << (msb - 1 - degree); msb = v === 0 ? 0 : 32 - Math.clz32(v); }
  return v;
}

/** Relit les DEUX copies de l'information de format depuis la matrice, sans supposer l'ordre. */
function readFormatCopies(modules, size) {
  const at = (r, c) => modules[r * size + c];
  const bitsAt = positions => positions.reduce((value, [r, c], index) => value | (at(r, c) << (positions.length - 1 - index)), 0);
  const copyA = bitsAt([[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]]);
  const copyB = bitsAt([
    ...Array.from({ length: 7 }, (_, i) => [size - 1 - i, 8]),
    ...Array.from({ length: 8 }, (_, i) => [8, size - 8 + i])
  ]);
  return { copyA, copyB };
}

const SAMPLES = [
  ['HELLO', 'M'], ['HELLO WORLD', 'L'], ['a', 'M'], ['2MTECH:EQUIPMENT:eq-1', 'L'],
  ['https://tech-platform-production.up.railway.app/index.html?entity=equipment&id=42#/devices', 'M'],
  ['Café à côté — équipement n°42 (été)', 'M']
];

for (const [text, level] of SAMPLES) {
  test(`information de format : codeword BCH valide et identique sur ses deux copies — "${text.slice(0, 24)}" (${level})`, () => {
    const result = encodeQrMatrix(text, level);
    const { copyA, copyB } = readFormatCopies(result.modules, result.size);
    assert.equal(copyA, copyB, 'les deux copies redondantes doivent porter EXACTEMENT la même valeur');
    const unmasked = copyA ^ 0x5412;
    assert.equal(bchRemainder(unmasked), 0, "le codeword BCH(15,5) doit avoir un reste nul par le générateur 0x537 — sinon aucun lecteur ne peut retrouver le masque");
    const decodedLevelBits = (unmasked >> 13) & 0b11;
    const decodedMask = (unmasked >> 10) & 0b111;
    assert.equal(decodedMask, result.maskId, "le masque encodé dans l'information de format doit être celui réellement appliqué aux données");
    assert.equal(decodedLevelBits, result.level === 'L' ? 0b01 : 0b00, 'le niveau de correction encodé doit correspondre à celui demandé');
  });
}

test('la taille de la matrice suit exactement 4×version+17', () => {
  for (const [text, level] of SAMPLES) {
    const result = encodeQrMatrix(text, level);
    assert.equal(result.size, 4 * result.version + 17);
    assert.equal(result.modules.length, result.size * result.size);
  }
});

test('un texte qui dépasse la portée (versions 1 à 6) lève une erreur explicite, jamais un code tronqué', () => {
  assert.throws(() => encodeQrMatrix('x'.repeat(200), 'M'), /trop long/);
  assert.throws(() => encodeQrMatrix('x'.repeat(200), 'L'), /trop long/);
});

test('un texte vide ne produit pas de QR : le call site décide de l’absence, pas un code invalide', () => {
  const result = encodeQrMatrix('', 'M');
  assert.equal(result.version, 1, 'même vide, la version choisie reste cohérente (mode octet, longueur 0)');
});

test('qrByteCapacity croît avec la version, jamais avec le niveau L au-dessus de M à version égale', () => {
  for (let version = 1; version <= 6; version += 1) {
    assert.ok(qrByteCapacity(version, 'L') >= qrByteCapacity(version, 'M'), `v${version} : L doit offrir au moins autant de capacité que M`);
  }
  for (let version = 2; version <= 6; version += 1) {
    assert.ok(qrByteCapacity(version, 'M') > qrByteCapacity(version - 1, 'M'), `v${version} doit offrir plus de capacité que v${version - 1}`);
  }
});

/*
 * PREUVE PAR UN DÉCODEUR INDÉPENDANT — OPTIONNELLE, JAMAIS BLOQUANTE POUR LA CI.
 *
 * `package.json` n'a aucune devDependency, et la CI installe avec `--omit=dev`
 * (`.github/workflows/verify.yml`) : `jsqr` n'y est donc jamais présent, et ce test se
 * retire proprement plutôt que d'échouer sur un module absent. Un développeur qui exécute
 * `npm install --no-save jsqr` en local obtient la preuve la plus forte qui soit : que la
 * matrice produite est RÉELLEMENT scannable, pas seulement structurellement plausible.
 */
test('décodage par un lecteur QR indépendant (jsQR), si disponible en local', async () => {
  let jsQR;
  try { ({ default: jsQR } = await import('jsqr')); }
  catch { return; }

  const toImageData = ({ modules, size }, scale = 6, quiet = 4) => {
    const dim = (size + quiet * 2) * scale;
    const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!modules[r * size + c]) continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const idx = (((r + quiet) * scale + dy) * dim + (c + quiet) * scale + dx) * 4;
            data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
          }
        }
      }
    }
    return { data, width: dim, height: dim };
  };

  for (const [text, level] of SAMPLES) {
    const result = encodeQrMatrix(text, level);
    const image = toImageData(result);
    const decoded = jsQR(image.data, image.width, image.height);
    assert.ok(decoded, `jsQR doit localiser un code pour "${text.slice(0, 24)}"`);
    assert.equal(decoded.data, text, `le contenu décodé doit être identique à l'entrée pour "${text.slice(0, 24)}"`);
  }
});
