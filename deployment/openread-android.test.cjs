const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const mobileDirectory = path.join(__dirname, "..", "packages", "app-expo");

function readExpoConfig(variant) {
  const output = execFileSync(
    process.execPath,
    ["-p", 'JSON.stringify(require("./app.config.js").expo)'],
    { cwd: mobileDirectory, env: { ...process.env, APP_VARIANT: variant }, encoding: "utf8" },
  );
  return JSON.parse(output);
}

test("OpenRead APK has its own name, application ID and links", () => {
  const config = readExpoConfig("openread");
  assert.equal(config.name, "OpenRead");
  assert.equal(config.slug, "openread");
  assert.equal(config.scheme, "openread");
  assert.equal(config.android.package, "io.github.a417320oss.openread");
  assert.equal(config.android.versionCode, 2);
  assert.equal(config.version, "1.4.1");
  assert.notEqual(config.android.package, readExpoConfig("production").android.package);
  assert.equal(config.extra.eas, undefined);
});

test("the existing Expo development variant remains independently installable", () => {
  const config = readExpoConfig("development");
  assert.equal(config.android.package, "com.readany.app.dev");
  assert.equal(config.scheme, "readany-dev");
});
