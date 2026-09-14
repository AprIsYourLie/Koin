import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop shell uses a persistent isolated Koin origin", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /koin:\/\/app/);
  assert.match(main, /registerSchemesAsPrivileged/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /protocol\.handle\(APP_SCHEME, fetchAsset\)/);
  assert.match(main, /ready-to-show/);
});
