import { createRequire } from 'node:module';
import { cp, mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'packages/app/package.json'));
const output = path.join(root, 'packages/app/public/vendor/ocr');
await mkdir(path.join(output, 'core'), { recursive: true });
await mkdir(path.join(output, 'lang'), { recursive: true });
await mkdir(path.join(output, 'licenses'), { recursive: true });
const packageDir = name => path.dirname(require.resolve(`${name}/package.json`));
const tesseract = packageDir('tesseract.js');
const core = packageDir('tesseract.js-core');
await copyFile(path.join(tesseract, 'dist/worker.min.js'), path.join(output, 'worker.min.js'));
for (const file of await readdir(core)) {
  if (/\.wasm(\.js)?$/.test(file)) await copyFile(path.join(core, file), path.join(output, 'core', file));
}
for (const language of ['eng', 'chi_sim', 'chi_tra']) {
  const dir = packageDir(`@tesseract.js-data/${language}`);
  await copyFile(path.join(dir, 'package.json'), path.join(output, 'licenses', `${language}-package.json`));
  await copyFile(path.join(dir, '4.0.0_best_int', `${language}.traineddata.gz`), path.join(output, 'lang', `${language}.traineddata.gz`));
  for (const file of await readdir(dir)) {
    if (/^license/i.test(file)) await copyFile(path.join(dir, file), path.join(output, 'licenses', `${language}-${file}`));
  }
}
for (const [name, dir] of [['tesseract.js', tesseract], ['tesseract.js-core', core]]) {
  for (const file of await readdir(dir)) {
    if (/^license/i.test(file)) await copyFile(path.join(dir, file), path.join(output, 'licenses', `${name}-${file}`));
  }
}
await writeFile(path.join(output, 'NOTICE.txt'), 'OpenRead local OCR assets: Tesseract.js, tesseract.js-core and Tesseract language data. Apache-2.0. See licenses/ and project NOTICE.md.\n');
// Match the PDF.js runtime version, including fonts for rendering scanned/mixed documents offline.
const pdfjs = packageDir('pdfjs-dist');
await mkdir(path.join(root, 'packages/app/public/vendor/pdfjs-local'), { recursive: true });
await copyFile(path.join(pdfjs, 'build/pdf.worker.mjs'), path.join(root, 'packages/app/public/vendor/pdfjs-local/pdf.worker.mjs'));
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(pdfjs, folder), path.join(root, 'packages/app/public/vendor/pdfjs-local', folder), { recursive: true });
}
console.log('Bundled local OCR engine, 3 languages and PDF rendering assets.');
