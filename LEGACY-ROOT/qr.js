export async function generateQR(data) {
  // Génération rapide via API gratuite qrserver
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data)}&size=80x80`;
}
