import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds a self-contained desktop renderer", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Koin · 看清每个月的钱花在哪里<\/title>/i);
  assert.match(html, /<div id="root"><\/div>/i);
  assert.match(html, /assets\/[^"']+\.js/i);
  assert.doesNotMatch(html, /localhost|codex-preview/i);
});

test("shows the three-page JSON workflow", async () => {
  const app = await readFile(new URL("../app/KoinApp.tsx", import.meta.url), "utf8");
  assert.match(app, /label="概览"/);
  assert.match(app, /label="明细"/);
  assert.match(app, /label="数据"/);
  assert.match(app, /导入 Koin JSON/);
  assert.match(app, /导出整理后的 JSON/);
  assert.match(app, /勾选当前结果/);
  assert.match(app, /商家累计/);
  assert.match(app, /标签排行/);
  assert.doesNotMatch(app, /XLSX|parseMatrix|自动关联|导出 CSV|消费整理/);
});
