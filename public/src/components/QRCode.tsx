/**
 * QR Code generator — pure JS, no external library
 * Uses a simple URL-based approach via public QR API (no API key needed)
 */
interface QRCodeProps {
  value: string;
  size?: number;
  label?: string;
}

export default function QRCode({ value, size = 160, label }: QRCodeProps) {
  // Use goqr.me public API — free, no key needed
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=ffffff&color=000000&margin=2`;

  const download = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qr-code.png';
    a.click();
  };

  return (
    <div className="text-center space-y-2">
      <div className="inline-block rounded-2xl p-3 bg-white">
        <img src={url} alt="QR Code" width={size} height={size} className="rounded-xl" />
      </div>
      {label && <p className="text-muted text-xs">{label}</p>}
      <button onClick={download} className="btn btn-ghost btn-sm mx-auto">
        ⬇️ تحميل QR
      </button>
    </div>
  );
}
