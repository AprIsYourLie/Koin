import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Koin application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Koin · 看清每个月的钱花在哪里<\/title>/i);
  assert.match(html, /所选期间实际消费/);
  assert.match(html, /花呗消费正常计入/);
  assert.match(html, /仅保存在本机/);
  assert.match(html, /计算器/);
  assert.match(html, /calculator-glyph/);
  assert.match(html, /当前账期/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(html, /看看示例数据|demo-/i);
});

test("includes source tracking and period CSV export", async () => {
  const app = await readFile(new URL("../app/KoinApp.tsx", import.meta.url), "utf8");
  assert.match(app, /账目来源/);
  assert.match(app, /导出期间账单/);
  assert.match(app, /本周/);
  assert.match(app, /自定义/);
  assert.match(app, /Koin账单_/);
  assert.match(app, /用 ¥/);
  assert.match(app, /记账计算器/);
  assert.match(app, /近 7 天/);
  assert.match(app, /选择账期/);
  assert.match(app, /PeriodPicker/);
  assert.match(app, /拖入或粘贴账单/);
  assert.match(app, /addEventListener\("paste"/);
  assert.match(app, /XLSX\.read/);
  assert.match(app, /parseMatrix/);
  assert.match(app, /总收入/);
  assert.match(app, /总支出/);
  assert.match(app, /全部来源/);
  assert.match(app, /搜索商家、备注或订单号/);
  assert.match(app, /note \? ` · \$\{note\}`/);
  assert.match(app, /cleanImportedNote/);
  assert.doesNotMatch(app, /note: `导入行/);
  assert.match(app, /dailySpendLevel/);
  assert.match(app, /¥500\+/);
});
