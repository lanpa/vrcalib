import QRCode from 'qrcode';

// Black on white regardless of theme: scanners need the contrast.
const OPTIONS = { errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } } as const;

export function drawQr(canvas: HTMLCanvasElement, text: string, width: number): Promise<void> {
  return QRCode.toCanvas(canvas, text, { ...OPTIONS, width });
}

export async function downloadQrPng(text: string, filename: string): Promise<void> {
  const url = await QRCode.toDataURL(text, { ...OPTIONS, width: 1024 });
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/** "Google", "Cardboard v1" → "google-cardboard-v1.png" */
export function qrFilename(vendor: string, model: string): string {
  const slug = `${vendor} ${model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'cardboard-profile'}.png`;
}
