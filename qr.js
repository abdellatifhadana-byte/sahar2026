/**
 * @file qr.js — génération de QR Code 100% locale.
 *
 * CE QUE CE FICHIER REMPLACE.
 *
 * Il construisait une URL vers `https://api.qrserver.com/...` : un service tiers, chaque QR
 * affiché envoyait la donnée qu'il encodait à un serveur externe, et le QR ne s'affichait
 * jamais hors ligne (`navigator.onLine === false` rendait `null` sans même essayer). Le
 * dessin est désormais entièrement calculé ici, par `qr-encoder.js` (aucune dépendance,
 * aucune requête réseau, fonctionne identiquement en ligne ou hors ligne), et rendu en SVG
 * — net à toute taille d'affichage, imprimable, et exportable en `data:` URI directement
 * utilisable comme `src` d'image, exactement comme l'URL externe qu'il remplace : aucun
 * site d'appel n'a besoin de changer.
 */
import { encodeQrMatrix } from './qr-encoder.js';

function qrMatrixToSvgDataUrl({ modules, size }, { margin = 4, moduleColor = '#132433', background = '#ffffff' } = {}) {
  const total = size + margin * 2;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row * size + col]) path += `M${col + margin},${row + margin}h1v1h-1z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="${background}"/>`
    + `<path d="${path}" fill="${moduleColor}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Génère un QR Code local pour `data` et le rend en `data:` URI SVG, directement utilisable
 * comme `src` d'une balise `<img>`. Fonctionne à l'identique en ligne ou hors ligne — aucune
 * requête réseau n'est jamais émise. `null` pour une donnée vide, ou pour un texte qui
 * dépasse la capacité locale (voir `qr-encoder.js`) : un appelant averti préfère l'absence
 * de QR à un code tronqué qui pointerait vers autre chose.
 */
export async function generateQR(data, options) {
  const text = data === undefined || data === null ? '' : String(data);
  if (!text) return null;
  try {
    return qrMatrixToSvgDataUrl(encodeQrMatrix(text, options?.level ?? 'L'), options);
  } catch (error) {
    console.warn('QR local indisponible pour cette donnée :', error?.message || error);
    return null;
  }
}
