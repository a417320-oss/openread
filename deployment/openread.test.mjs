import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = file => readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
test('OpenRead preserves data identity and cannot install an upstream update', () => {
  const config = JSON.parse(text('packages/app/src-tauri/tauri.conf.json'));
  assert.equal(config.productName, 'OpenRead');
  assert.equal(config.app.windows[0].title, 'OpenRead');
  assert.equal(config.identifier, 'com.readany.app');
  assert.equal(config.plugins.updater, undefined);
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.match(text('LICENSE'), /Copyright \(C\) 2024 ReadAny Team/);
  assert.match(text('NOTICE.md'), /GPL-3.0-or-later/);
});
test('source does not track credentials, books or runtime state', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    assert.doesNotMatch(file, /(^|\/)(\.cache|runtime|pdf-ocr|readany-store|node_modules)(\/|$)|\.dpapi$|(^|\/)\.env$/);
  }
});
test('build and desktop entry retain local OCR and Plus startup', () => {
  const app = JSON.parse(text('packages/app/package.json'));
  assert.match(app.scripts.build, /prepare-ocr/);
  assert.ok(app.dependencies['tesseract.js']);
  assert.match(text('Start-OpenRead.cmd'), /plus-bridge\\launch.ps1/);
  assert.match(text('plus-bridge/install-shortcuts.ps1'), /OpenRead\.lnk/);
  assert.match(text('deployment/package-openread.ps1'), /Explicit allowlist/);
});
