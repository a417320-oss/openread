import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'packages/app/package.json'));
const { createCanvas } = require('@napi-rs/canvas');
const { createWorker } = require('tesseract.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

// A generated image-only PDF: no private reading material is used or distributed.
const scan = createCanvas(1400, 400);
const ctx = scan.getContext('2d');
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, scan.width, scan.height);
ctx.fillStyle = 'black'; ctx.font = '64px Arial';
ctx.fillText('OpenRead scanned PDF', 60, 120);
ctx.fillText('Local OCR test 12345', 60, 240);
const jpeg = await scan.encode('jpeg');
const stream = Buffer.from('q 700 0 0 200 0 0 cm /Scan Do Q');
const objects = [
  Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
  Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
  Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 200] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>'),
  Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1400 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
  Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
];
let pdf = Buffer.from('%PDF-1.4\n'); const offsets = [0];
for (const [index, body] of objects.entries()) {
  offsets.push(pdf.length);
  pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
}
const xref = pdf.length;
pdf = Buffer.concat([pdf, Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
const output = path.join(root, '.cache/ocr-smoke'); await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'scan.pdf'), pdf);
const document = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false }).promise;
let worker;
try {
  const page = await document.getPage(1);
  assert.equal((await page.getTextContent()).items.length, 0, 'Fixture must have no native text');
  const viewport = page.getViewport({ scale: 2 });
  const rendered = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: rendered, canvasContext: rendered.getContext('2d'), viewport }).promise;
  const png = await rendered.encode('png'); await writeFile(path.join(output, 'scan.png'), png);
  worker = await createWorker('eng', 1, { langPath: path.join(root, 'packages/app/public/vendor/ocr/lang'), cachePath: output });
  const { data } = await worker.recognize(png);
  assert.match(data.text, /OpenRead/i); assert.match(data.text, /12345/);
  console.log(JSON.stringify({ sourceHasNativeText: false, recognized: data.text.trim(), confidence: data.confidence }));
} finally { if (worker) await worker.terminate(); await document.destroy(); }
