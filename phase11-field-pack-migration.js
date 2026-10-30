export const PHASE11_FIELD_PACK_MIGRATION_VERSION = 4;
export const PHASE11_FIELD_PACK_LEGACY_URL = '/assets/field-evidence/2026-08-16/2m-field-pack.bin';
export const PHASE11_FIELD_PACK_LEGACY_BYTES = 200528;
export const PHASE11_FIELD_PACK_COMPACT_BYTES = 27088;
export const PHASE11_FIELD_PACK_IMAGE_COUNT = 20;

const ROOT = '/assets/field-evidence/2026-08-16';
const PARTS = Object.freeze([
  'phase11-migration-01.b64',
  'phase11-migration-02.b64',
  'phase11-migration-03.b64',
  'phase11-migration-04.b64',
  'phase11-migration-05.b64',
  'phase11-migration-06a.b64',
  'phase11-migration-06b.b64',
  'phase11-migration-07a.b64',
  'phase11-migration-07b.b64',
  'phase11-migration-08a.b64',
  'phase11-migration-08b.b64'
]);

export const PHASE11_LEGACY_SEGMENTS = Object.freeze([
  [0,19360],[19360,18154],[37514,6872],[44386,11874],[56260,8502],
  [64762,11864],[76626,11126],[87752,10560],[98312,15122],[113434,12704],
  [126138,8240],[134378,10206],[144584,6800],[151384,8044],[159428,5908],
  [165336,7656],[172992,8802],[181794,6418],[188212,7054],[195266,5262]
].map(([offset,length], index) => Object.freeze({ id:index + 1, offset, length })));

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.slice(start, start + length));
const isWebpStart = (bytes, offset) => (
  offset + 12 <= bytes.length &&
  ascii(bytes,offset,4) === 'RIFF' &&
  ascii(bytes,offset + 8,4) === 'WEBP'
);

/**
 * Le pack de migration est une concaténation compacte produite à partir des
 * vingt vues terrain. Il ne faut pas utiliser le champ RIFF-size pour trouver
 * le segment suivant : certaines vues ont été compactées puis concaténées et
 * ce champ ne constitue plus une frontière fiable. La frontière sûre du pack
 * est la signature RIFF....WEBP suivante, avec exactement vingt signatures.
 */
export function parseCompactWebpSegments(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const starts = [];
  for (let offset = 0; offset <= bytes.length - 12; offset += 1) {
    if (isWebpStart(bytes, offset)) starts.push(offset);
  }
  if (starts[0] !== 0) throw new Error('Pack compact Phase 11 sans signature RIFF/WEBP initiale.');
  if (starts.length !== PHASE11_FIELD_PACK_IMAGE_COUNT) {
    throw new Error(`Nombre de signatures RIFF/WEBP Phase 11 invalide : ${starts.length}/${PHASE11_FIELD_PACK_IMAGE_COUNT}`);
  }
  const segments = starts.map((offset, index) => {
    const end = starts[index + 1] ?? bytes.length;
    const length = end - offset;
    if (length < 12) throw new Error(`Segment Phase 11 trop court à ${offset} : ${length}.`);
    return Object.freeze({ id:index + 1, offset, length });
  });
  const last = segments.at(-1);
  if (!last || last.offset + last.length !== bytes.length) throw new Error('Pack compact Phase 11 non contigu.');
  return Object.freeze(segments);
}

export function padWebpToLegacyLength(input, targetLength) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (source.length > targetLength) throw new Error(`Segment WebP trop grand (${source.length} > ${targetLength})`);
  if (!isWebpStart(source, 0)) throw new Error('Segment Phase 11 invalide : RIFF/WEBP attendu.');
  const output = new Uint8Array(targetLength);
  output.set(source, 0);
  const view = new DataView(output.buffer);
  if (source.length < targetLength) {
    const added = targetLength - source.length;
    if (added < 8 || added % 2) throw new Error(`Padding WebP impossible : ${added} octets.`);
    const payloadLength = added - 8;
    output.set([0x4a,0x55,0x4e,0x4b], source.length); // JUNK
    view.setUint32(source.length + 4, payloadLength, true);
  }
  view.setUint32(4, targetLength - 8, true);
  return output;
}

function decodeBase64(base64) {
  const normalized = String(base64 || '').replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function buildLegacyPack(nativeFetch) {
  const texts = await Promise.all(PARTS.map(async name => {
    const response = await nativeFetch(`${ROOT}/${name}`, { cache:'no-store' });
    if (!response.ok) throw new Error(`Segment migration Phase 11 indisponible : ${name}`);
    return response.text();
  }));
  const compact = decodeBase64(texts.join(''));
  if (compact.byteLength !== PHASE11_FIELD_PACK_COMPACT_BYTES) {
    throw new Error(`Pack compact Phase 11 invalide : ${compact.byteLength}/${PHASE11_FIELD_PACK_COMPACT_BYTES}`);
  }
  const compactSegments = parseCompactWebpSegments(compact);
  const legacy = new Uint8Array(PHASE11_FIELD_PACK_LEGACY_BYTES);
  for (let index = 0; index < compactSegments.length; index += 1) {
    const sourceMeta = compactSegments[index];
    const targetMeta = PHASE11_LEGACY_SEGMENTS[index];
    const segment = compact.slice(sourceMeta.offset, sourceMeta.offset + sourceMeta.length);
    const padded = padWebpToLegacyLength(segment, targetMeta.length);
    legacy.set(padded, targetMeta.offset);
  }
  return legacy;
}

let legacyPackPromise = null;

export function installPhase11FieldPackMigration(target = globalThis) {
  if (!target?.fetch || target.__phase11FieldPackMigrationInstalled) return false;
  const nativeFetch = target.fetch.bind(target);
  const migratedFetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (!String(url || '').includes(PHASE11_FIELD_PACK_LEGACY_URL)) return nativeFetch(input, init);
    legacyPackPromise ||= buildLegacyPack(nativeFetch);
    try {
      const bytes = await legacyPackPromise;
      return new Response(bytes.slice(), {
        status:200,
        headers:{
          'Content-Type':'application/octet-stream',
          'Content-Length':String(PHASE11_FIELD_PACK_LEGACY_BYTES),
          'X-2M-Field-Pack-Migration':'phase11-v4'
        }
      });
    } catch (error) {
      legacyPackPromise = null;
      console.warn('Migration pack terrain Phase 11 indisponible', error);
      return nativeFetch(input, init);
    }
  };
  target.fetch = migratedFetch;
  target.__phase11FieldPackMigrationInstalled = true;
  return true;
}

if (typeof window !== 'undefined') {
  installPhase11FieldPackMigration(window);
  window.Phase11FieldPackMigration = Object.freeze({
    version:PHASE11_FIELD_PACK_MIGRATION_VERSION,
    install:installPhase11FieldPackMigration,
    compactBytes:PHASE11_FIELD_PACK_COMPACT_BYTES,
    legacyBytes:PHASE11_FIELD_PACK_LEGACY_BYTES,
    imageCount:PHASE11_FIELD_PACK_IMAGE_COUNT,
    parseCompactWebpSegments,
    legacySegments:PHASE11_LEGACY_SEGMENTS
  });
}