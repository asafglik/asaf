// Barcodes and QR codes as inline SVG (bwip-js, no native dependencies).
import bwip from 'bwip-js';

export const SYMBOLOGIES = [
  { id: 'code128', label: 'Code 128', twoD: false },
  { id: 'code39', label: 'Code 39', twoD: false },
  { id: 'ean13', label: 'EAN-13', twoD: false },
  { id: 'ean8', label: 'EAN-8', twoD: false },
  { id: 'upca', label: 'UPC-A', twoD: false },
  { id: 'itf14', label: 'ITF-14', twoD: false },
  { id: 'interleaved2of5', label: 'Interleaved 2 of 5', twoD: false },
  { id: 'gs1-128', label: 'GS1-128', twoD: false },
  { id: 'qrcode', label: 'QR Code', twoD: true },
  { id: 'datamatrix', label: 'Data Matrix', twoD: true },
  { id: 'pdf417', label: 'PDF417', twoD: true },
  { id: 'azteccode', label: 'Aztec', twoD: true },
];

const ALLOWED = new Set(SYMBOLOGIES.map((s) => s.id));

export function barcodeSvg({ symbology = 'code128', text, showText = true, color = '#000000', rotate = 'N' }) {
  if (!ALLOWED.has(symbology)) throw new Error('סוג ברקוד לא נתמך: ' + symbology);
  const twoD = SYMBOLOGIES.find((s) => s.id === symbology).twoD;
  const opts = {
    bcid: symbology,
    text: String(text),
    scale: 3,
    barcolor: color.replace('#', ''),
    textcolor: color.replace('#', ''),
    rotate: ['N', 'R', 'L', 'I'].includes(rotate) ? rotate : 'N',
  };
  if (!twoD) {
    opts.height = 12;
    opts.includetext = !!showText;
    opts.textxalign = 'center';
  }
  if (symbology === 'qrcode') opts.eclevel = 'M';
  if (symbology === 'qrcode' || symbology === 'datamatrix' || symbology === 'azteccode') opts.paddingwidth = 0;
  let svg = bwip.toSVG(opts);
  svg = svg.replace('<svg ', `<svg preserveAspectRatio="${twoD ? 'xMidYMid meet' : 'none'}" width="100%" height="100%" `);
  return svg;
}
