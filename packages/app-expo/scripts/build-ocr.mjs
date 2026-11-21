import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildStoreOnlyZip } from "../../core/src/utils/store-only-zip.ts";

const app = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(app, "../..");
const staging = path.join(root, ".cache", "mobile-ocr-assets");
await mkdir(staging, { recursive: true });
execFileSync(process.execPath, [path.join(root, "scripts/prepare-ocr.mjs"), staging, "--legacy-pdf"], { stdio: "inherit" });
const [engine] = (await build({
  entryPoints: [path.join(app, "scripts/ocr-webview.ts")],
  platform: "browser",
  target: "es2022",
  // Older Android WebViews need the Promise and URL polyfills from the legacy PDF.js build.
  alias: { "pdfjs-dist": "pdfjs-dist/legacy/build/pdf.mjs" },
  bundle: true,
  minify: true,
  write: false,
})).outputFiles;

const files = {
  "index.html": new TextEncoder().encode(`<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'self' data: blob:">
<title>OpenRead OCR</title><script defer src="engine.js"></script>`),
  "engine.js": engine.contents,
};
async function addDirectory(relative) {
  for (const item of await readdir(path.join(staging, relative), { withFileTypes: true })) {
    const entry = `${relative}/${item.name}`;
    if (item.isDirectory()) await addDirectory(entry);
    else files[entry] = await readFile(path.join(staging, entry));
  }
}
await addDirectory("ocr");
await addDirectory("pdfjs-local");
const archive = buildStoreOnlyZip(Object.entries(files).map(([name, data]) => ({ name, data })));
await writeFile(path.join(app, "assets", "ocr-runtime.bin"), archive);
console.log(`Built offline mobile OCR assets (${Math.round(archive.length / 1024 / 1024)} MiB)`);
