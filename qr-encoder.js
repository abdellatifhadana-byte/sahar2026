/**
 * @file qr-encoder.js — encodeur QR Code (Modèle 2) local, sans dépendance.
 *
 * POURQUOI CE FICHIER EXISTE.
 *
 * `qr.js` construisait une URL vers `api.qrserver.com` : un service externe, injoignable
 * hors ligne, et un octet de la plateforme envoyé à un tiers pour chaque QR affiché. Cette
 * plateforme n'a ni empaqueteur ni dépendance d'exécution (voir `package.json`) : un QR
 * réellement local exige donc l'algorithme lui-même, pas une bibliothèque à charger.
 *
 * PORTÉE DÉLIBÉRÉMENT BORNÉE — VERSIONS 1 À 6, NIVEAUX L ET M.
 *
 * La norme (ISO/IEC 18004) définit 40 versions × 4 niveaux de correction, avec des groupes
 * de blocs hétérogènes à partir de la version 5 pour Q/H, et un bloc d'information de
 * VERSION distinct à partir de la version 7. Chaque cas ajouté est une table de constantes
 * de plus, donc un risque de transcription de plus, pour un gain qui ne sert à rien ici : la
 * charge utile est toujours un identifiant ou un lien court. Les versions 1-6 aux niveaux L
 * et M sont exactement celles où CHAQUE bloc de correction a la MÊME taille (aucun
 * regroupement hétérogène à interlacer), et aucune ne dépasse la version 6 : ni bloc de
 * version, ni configuration multi-groupe. La version 6-L porte 134 octets utiles en mode
 * octet — largement assez pour un lien `https://…?entity=equipment&id=…#/devices`. Un texte
 * plus long lève une erreur explicite plutôt que de produire un code invalide.
 *
 * MODE OCTET SEUL. Les modes numérique/alphanumérique compressent mieux mais n'apportent
 * rien pour un texte qui contient déjà `:`, `/`, `?`, `&` — hors de l'alphabet alphanumérique
 * du QR. Le mode octet accepte n'importe quel texte UTF-8 sans distinction de cas.
 */

const QR_ENCODER_VERSION = 1;

/* ═══════════════════════════ GF(256) — arithmétique de Galois du QR Code ═══════════════════════════
 *
 * Polynôme primitif 0x11D (x^8+x^4+x^3+x^2+1) et générateur α=2 : les deux constantes que la
 * norme fixe pour Reed-Solomon. Les tables exp/log sont CALCULÉES ici, pas recopiées : une
 * table de 256 entrées mal recopiée serait une source d'erreur bien plus probable qu'une
 * boucle de 255 itérations sur une règle connue.
 */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function buildGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

/** Polynôme générateur Reed-Solomon de degré `n` : produit (x-1)(x-2)(x-4)…(x-2^(n-1)). */
function rsGeneratorPolynomial(n) {
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Codewords de correction Reed-Solomon pour `data`, par division polynomiale en GF(256). */
function rsEncode(data, ecCount) {
  const generator = rsGeneratorPolynomial(ecCount);
  const remainder = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i += 1) remainder[i] ^= gfMul(generator[i + 1], factor);
    }
  }
  return Array.from(remainder);
}

/* ═══════════════════════════ table des versions 1-6, niveaux L et M ═══════════════════════════
 *
 * `data`: codewords de données PAR BLOC (identique pour chaque bloc à cette portée) ;
 * `blocks`: nombre de blocs (>1 exige l'entrelacement, ci-dessous) ; `ec`: codewords de
 * correction par bloc. Chaque ligne s'autovérifie : `blocks*(data+ec)` doit valoir le total
 * de codewords connu de cette version (26/44/70/100/134/172) — la table de test le confirme
 * indépendamment de ce fichier.
 */
const VERSION_TABLE = Object.freeze({
  1: { size: 21, alignment: [], L: { data: 19, ec: 7, blocks: 1 }, M: { data: 16, ec: 10, blocks: 1 } },
  2: { size: 25, alignment: [6, 18], L: { data: 34, ec: 10, blocks: 1 }, M: { data: 28, ec: 16, blocks: 1 } },
  3: { size: 29, alignment: [6, 22], L: { data: 55, ec: 15, blocks: 1 }, M: { data: 44, ec: 26, blocks: 1 } },
  4: { size: 33, alignment: [6, 26], L: { data: 80, ec: 20, blocks: 1 }, M: { data: 32, ec: 18, blocks: 2 } },
  5: { size: 37, alignment: [6, 30], L: { data: 108, ec: 26, blocks: 1 }, M: { data: 43, ec: 24, blocks: 2 } },
  6: { size: 41, alignment: [6, 34], L: { data: 68, ec: 18, blocks: 2 }, M: { data: 27, ec: 16, blocks: 4 } }
});
const MAX_VERSION = 6;

/** Capacité utile en mode octet : total des données moins l'en-tête (mode+longueur+terminateur). */
function byteCapacity(version, level) {
  const row = VERSION_TABLE[version][level];
  const totalDataBits = row.data * row.blocks * 8;
  return Math.floor((totalDataBits - 4 - 8) / 8); // 4 bits mode + 8 bits longueur (v1-9)
}

function pickVersion(byteLength, level) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    if (byteLength <= byteCapacity(version, level)) return version;
  }
  return null;
}

/* ═══════════════════════════ flux de données — mode octet ═══════════════════════════ */

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
  // Repli manuel, au cas où `TextEncoder` manquerait dans l'environnement d'exécution.
  const bytes = [];
  for (const char of text) {
    let code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

class BitWriter {
  constructor() { this.bits = []; }
  push(value, length) { for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >> i) & 1); }
  get length() { return this.bits.length; }
  toBytes() {
    const bytes = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] || 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

/** Construit les codewords de données (mode octet, terminés et complétés au motif standard). */
function buildDataCodewords(bytes, version, level) {
  const row = VERSION_TABLE[version][level];
  const totalDataCodewords = row.data * row.blocks;
  const writer = new BitWriter();
  writer.push(0b0100, 4); // indicateur de mode : octet
  writer.push(bytes.length, 8); // compte de caractères (8 bits, versions 1-9)
  for (const byte of bytes) writer.push(byte, 8);
  const capacityBits = totalDataCodewords * 8;
  writer.push(0, Math.min(4, capacityBits - writer.length)); // terminateur, jamais négatif
  while (writer.length % 8 !== 0) writer.push(0, 1);
  const codewords = writer.toBytes();
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < totalDataCodewords) { codewords.push(padBytes[padIndex % 2]); padIndex += 1; }
  return codewords;
}

/** Sépare en blocs égaux (portée 1-6 : jamais de groupes hétérogènes) et entrelace. */
function interleave(dataCodewords, version, level) {
  const row = VERSION_TABLE[version][level];
  const blocks = [];
  for (let b = 0; b < row.blocks; b += 1) blocks.push(dataCodewords.slice(b * row.data, (b + 1) * row.data));
  const ecBlocks = blocks.map(block => rsEncode(block, row.ec));

  const interleavedData = [];
  for (let i = 0; i < row.data; i += 1) for (const block of blocks) interleavedData.push(block[i]);
  const interleavedEc = [];
  for (let i = 0; i < row.ec; i += 1) for (const block of ecBlocks) interleavedEc.push(block[i]);
  return [...interleavedData, ...interleavedEc];
}

/* ═══════════════════════════ construction de la matrice ═══════════════════════════ */

const FORMAT_GENERATOR = 0x537;
const FORMAT_MASK = 0x5412;
const LEVEL_BITS = { L: 0b01, M: 0b00 };

function formatBits(level, maskId) {
  const data = (LEVEL_BITS[level] << 3) | maskId; // 5 bits : niveau (2) + masque (3)
  let value = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (value & (1 << (i + 10))) value ^= FORMAT_GENERATOR << i;
  }
  return ((data << 10) | value) ^ FORMAT_MASK;
}

const MASK_FUNCTIONS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function alignmentCenters(version) {
  const coords = VERSION_TABLE[version].alignment;
  if (!coords.length) return [];
  const centers = [];
  for (const row of coords) for (const col of coords) centers.push([row, col]);
  return centers;
}

class Matrix {
  constructor(size) {
    this.size = size;
    this.modules = new Uint8Array(size * size); // 0/1 = couleur, une fois posé
    this.reserved = new Uint8Array(size * size); // 1 = motif de fonction, jamais masqué/écrit par les données
  }
  set(r, c, dark, reserve = true) {
    if (r < 0 || c < 0 || r >= this.size || c >= this.size) return;
    this.modules[r * this.size + c] = dark ? 1 : 0;
    if (reserve) this.reserved[r * this.size + c] = 1;
  }
  get(r, c) { return this.modules[r * this.size + c]; }
  isReserved(r, c) { return this.reserved[r * this.size + c] === 1; }
}

function drawFinder(matrix, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const inSquare = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      matrix.set(row + r, col + c, inSquare ? (inOuter || inInner) : false);
    }
  }
}

function drawAlignment(matrix, row, col) {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const ring = Math.max(Math.abs(r), Math.abs(c));
      matrix.set(row + r, col + c, ring !== 1);
    }
  }
}

function buildFunctionPatterns(matrix, version) {
  drawFinder(matrix, 0, 0);
  drawFinder(matrix, 0, matrix.size - 7);
  drawFinder(matrix, matrix.size - 7, 0);
  // Séparateurs blancs autour de chaque motif de repérage.
  for (let i = 0; i < 8; i += 1) {
    matrix.set(7, i, false); matrix.set(i, 7, false);
    matrix.set(7, matrix.size - 1 - i, false); matrix.set(i, matrix.size - 8, false);
    matrix.set(matrix.size - 8, i, false); matrix.set(matrix.size - 1 - i, 7, false);
  }
  // Motifs d'alignement — jamais sur un motif de repérage déjà posé.
  for (const [r, c] of alignmentCenters(version)) {
    if (matrix.isReserved(r, c)) continue;
    drawAlignment(matrix, r, c);
  }
  // Motifs de synchronisation : alternance sur la ligne/colonne 6.
  for (let i = 8; i < matrix.size - 8; i += 1) {
    matrix.set(6, i, i % 2 === 0);
    matrix.set(i, 6, i % 2 === 0);
  }
  matrix.set(matrix.size - 8, 8, true); // module sombre, fixe, toujours posé
  // Zones réservées à l'information de FORMAT (posées ici en blanc ; la vraie valeur remplace
  // ce placeholder une fois le masque choisi — réserver empêche les données de s'y écrire).
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) { matrix.set(8, i, false); matrix.set(i, 8, false); }
  }
  for (let i = 0; i < 8; i += 1) matrix.set(8, matrix.size - 1 - i, false);
  // Bande verticale : 7 cases seulement (bits 0-6) — la 8e (taille-8, 8) est le module sombre
  // posé juste au-dessus, et ne doit jamais être réécrite en blanc après coup.
  for (let i = 0; i < 7; i += 1) matrix.set(matrix.size - 1 - i, 8, false);
}

/** Pose l'information de format (15 bits, BCH) dans ses deux copies canoniques. */
function placeFormatInfo(matrix, level, maskId) {
  const bits = formatBits(level, maskId);
  const bit = i => ((bits >> i) & 1) === 1;
  /*
   * L'ORDRE DE POSE EST L'INVERSE DE L'ORDRE DE LECTURE «NATUREL» DE LA FORME EN L.
   *
   * Mesuré par confrontation à une référence indépendante (bibliothèque Python `qrcode`) :
   * le bit LE PLUS significatif (14) se pose EN PREMIER, en (0,8) — le sommet de la bande
   * verticale — et redescend jusqu'au bit 0 en (8,0). Une pose naïve « bit(i) au i-ème
   * emplacement visité » produit un code géométriquement correct mais dont l'information de
   * format ne vaut plus le codeword BCH attendu : aucun lecteur réel ne peut alors savoir
   * quel masque lever, et le décodage échoue entièrement — mesuré avec jsQR, tous masques
   * confondus, avant ce correctif.
   */
  // Copie A — autour du repère haut-gauche.
  for (let i = 0; i <= 5; i += 1) matrix.set(8, i, bit(14 - i), true);
  matrix.set(8, 7, bit(8), true); matrix.set(8, 8, bit(7), true); matrix.set(7, 8, bit(6), true);
  for (let i = 9; i < 15; i += 1) matrix.set(14 - i, 8, bit(14 - i), true);
  /*
   * Copie B — répartie près des repères bas-gauche / haut-droit, découpée 7 puis 8 bits.
   *
   * Le module sombre fixe occupe (taille-8, 8) — voir `buildFunctionPatterns`. Un découpage
   * 8+7 (bits 0-7 puis 8-14) ferait déborder la première moitié jusqu'à cette même case et
   * l'écraserait ; 7+8 s'arrête juste au-dessus, à (taille-7, 8), et ne la touche jamais.
   */
  for (let i = 0; i < 7; i += 1) matrix.set(matrix.size - 1 - i, 8, bit(14 - i), true);
  for (let i = 7; i < 15; i += 1) matrix.set(8, matrix.size - 15 + i, bit(14 - i), true);
}

/** Parcours en zigzag par paires de colonnes, de bas en haut puis haut en bas — la règle QR. */
function placeDataBits(matrix, codewords) {
  const bits = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  let bitIndex = 0;
  let upward = true;
  for (let col = matrix.size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1; // la colonne de synchronisation ne reçoit jamais de donnée
    for (let step = 0; step < matrix.size; step += 1) {
      const row = upward ? matrix.size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (matrix.isReserved(row, c)) continue;
        const value = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex += 1;
        matrix.set(row, c, value === 1, false);
      }
    }
    upward = !upward;
  }
}

function applyMask(matrix, maskId) {
  const maskFn = MASK_FUNCTIONS[maskId];
  const masked = new Uint8Array(matrix.modules);
  for (let r = 0; r < matrix.size; r += 1) {
    for (let c = 0; c < matrix.size; c += 1) {
      if (matrix.isReserved(r, c)) continue;
      if (maskFn(r, c)) masked[r * matrix.size + c] ^= 1;
    }
  }
  return masked;
}

/** Les quatre règles de pénalité (§7.8.3 de la norme) — plus bas est meilleur. */
function penalty(modules, size) {
  const at = (r, c) => modules[r * size + c];
  let score = 0;
  // Règle 1 : suites de 5+ modules identiques, par ligne puis par colonne.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < size; i += 1) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const prev = pass === 0 ? at(i, j - 1) : at(j - 1, i);
        const cur = pass === 0 ? at(i, j) : at(j, i);
        if (cur === prev) run += 1;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
  }
  // Règle 2 : blocs 2×2 de la même couleur.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }
  // Règle 3 : motif 1:1:3:1:1 précédé/suivi de 4 modules clairs.
  const finderLike = seq => seq.join(',') === '1,0,1,1,1,0,1,0,0,0,0' || seq.join(',') === '0,0,0,0,1,0,1,1,1,0,1';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c <= size - 11; c += 1) {
      if (finderLike(Array.from({ length: 11 }, (_, k) => at(r, c + k)))) score += 40;
    }
  }
  for (let c = 0; c < size; c += 1) {
    for (let r = 0; r <= size - 11; r += 1) {
      if (finderLike(Array.from({ length: 11 }, (_, k) => at(r + k, c)))) score += 40;
    }
  }
  // Règle 4 : écart de la proportion de modules sombres par rapport à 50 %.
  const dark = modules.reduce((sum, v) => sum + v, 0);
  const ratio = Math.abs(Math.round((dark * 100) / (size * size)) - 50) / 5;
  score += Math.floor(ratio) * 10;
  return score;
}

/**
 * Encode `text` en une matrice QR Code — la plus petite version (1 à 6) qui le contient au
 * niveau de correction demandé. Lève une erreur explicite plutôt que de tronquer un texte
 * trop long : un QR partiel ne pointerait pas vers la bonne fiche.
 */
export function encodeQrMatrix(text, level = 'M') {
  const normalizedLevel = level === 'L' ? 'L' : 'M';
  const bytes = utf8Bytes(String(text ?? ''));
  const version = pickVersion(bytes.length, normalizedLevel);
  if (!version) {
    throw new Error(`qr-encoder: texte trop long (${bytes.length} octets) pour un QR local (max ${byteCapacity(MAX_VERSION, normalizedLevel)} en niveau ${normalizedLevel})`);
  }
  const dataCodewords = buildDataCodewords(bytes, version, normalizedLevel);
  const allCodewords = interleave(dataCodewords, version, normalizedLevel);

  const size = VERSION_TABLE[version].size;
  const skeleton = new Matrix(size);
  buildFunctionPatterns(skeleton, version);
  placeDataBits(skeleton, allCodewords);

  let best = null;
  for (let maskId = 0; maskId < 8; maskId += 1) {
    const masked = applyMask(skeleton, maskId);
    const candidate = new Matrix(size);
    candidate.modules.set(masked);
    candidate.reserved.set(skeleton.reserved);
    placeFormatInfo(candidate, normalizedLevel, maskId);
    const score = penalty(candidate.modules, size);
    if (!best || score < best.score) best = { score, modules: candidate.modules, maskId };
  }

  return Object.freeze({ version, size, level: normalizedLevel, maskId: best.maskId, modules: best.modules });
}

export function qrByteCapacity(version, level = 'M') {
  return byteCapacity(version, level === 'L' ? 'L' : 'M');
}

export default Object.freeze({ version: QR_ENCODER_VERSION, encodeQrMatrix, qrByteCapacity });
