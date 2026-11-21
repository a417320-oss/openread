import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { readStoreOnlyZip } from "../packages/core/src/utils/store-only-zip.ts";

test("the mobile OCR asset ships its compatibility worker and language data offline", async () => {
  const archive = await readFile(new URL("../packages/app-expo/assets/ocr-runtime.bin", import.meta.url));
  const files = new Map([...readStoreOnlyZip(archive)].map(({ name, data }) => [name, data]));
  const require = createRequire(new URL("../packages/app/package.json", import.meta.url));
  const legacyWorker = await readFile(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"));
  assert.deepEqual(files.get("pdfjs-local/pdf.worker.mjs"), legacyWorker);

  for (const language of ["chi_sim", "chi_tra", "eng"]) {
    const model = files.get(`ocr/lang/${language}.traineddata.gz`);
    assert.ok(model, `Missing local ${language} model`);
    assert.equal(model.readUInt16BE(0), 0x1f8b, `Invalid ${language} model`);
  }
  for (const file of ["index.html", "engine.js", "ocr/worker.min.js"]) {
    assert.ok(files.get(file)?.length, `Missing local ${file}`);
  }
  assert.ok([...files.keys()].some(name => name.startsWith("ocr/core/") && name.endsWith(".wasm")));
});
