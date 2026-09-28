import assert from "node:assert/strict";
import test from "node:test";
import { counts, createBook, displayTransaction, monthEnd, netExpense, planImport, readBook } from "../app/billModel.ts";

const expense = (id, date, extra = {}) => ({ id, date, merchant: "美团", amount: 28, category: "餐饮", kind: "expense", note: "晚餐", tags: ["外卖"], counted: true, ...extra });

test("imports one or multiple months by ID and preserves local edits", () => {
  const local = expense("order-1", "2026-07-11", { note: "我改过的晚餐", tags: ["聚餐"] });
  const incoming = [expense("order-1", "2026-07-11"), expense("order-2", "2026-08-01"), expense("order-3", "2026-09-01")];
  const plan = planImport([local], { version: 3, transactions: incoming });
  assert.deepEqual(plan.months, ["2026-07", "2026-08", "2026-09"]);
  assert.equal(plan.added.length, 2);
  assert.equal(plan.duplicates, 1);
  assert.equal(local.note, "我改过的晚餐");
  assert.equal(planImport([local, ...plan.added], { version: 3, transactions: incoming }).added.length, 0);
});

test("accepts legacy backup and preserves excluded and linked fields", () => {
  const excluded = expense("legacy-review", "2026-07-10", { counted: false, matchStatus: "review", possibleMatchId: "legacy-other", evidence: [{ id: "source-1" }] });
  const book = { version: 2, transactions: [excluded] };
  const restored = readBook(book).transactions[0];
  assert.equal(restored.counted, false);
  assert.equal(restored.matchStatus, "review");
  assert.equal(restored.possibleMatchId, "legacy-other");
  assert.deepEqual(restored.evidence, [{ id: "source-1" }]);
  assert.equal(counts(restored), false);
});

test("refund reduces selected net total and transfers never count", () => {
  const rows = [expense("e", "2026-07-01"), expense("r", "2026-07-02", { kind: "refund", amount: 8 }), expense("t", "2026-07-03", { kind: "transfer", amount: 100 }), expense("x", "2026-07-04", { counted: false, amount: 12 })];
  assert.equal(netExpense(rows), 20);
  assert.equal(netExpense(rows.slice(1)), -8);
});

test("month and whole-book exports round-trip manual edits", () => {
  const july = expense("july", "2026-07-31", { note: "改过的名称", tags: ["晚餐"] });
  const august = expense("august", "2026-08-01");
  const selected = [july, august].filter((item) => item.date >= "2026-07-01" && item.date <= monthEnd("2026-07"));
  const monthly = readBook(JSON.parse(JSON.stringify(createBook(selected)))).transactions;
  const whole = readBook(JSON.parse(JSON.stringify(createBook([july, august])))).transactions;
  assert.deepEqual(monthly.map((item) => item.id), ["july"]);
  assert.equal(monthly[0].note, "改过的名称");
  assert.deepEqual(monthly[0].tags, ["晚餐"]);
  assert.deepEqual(whole.map((item) => item.id), ["july", "august"]);
});

test("rejects invalid records without silently creating duplicates", () => {
  const plan = planImport([], [expense("id", "2026-07-01"), expense("id", "2026-07-02"), expense("bad", "2026-02-30"), expense("missing", "2026-07-03", { amount: Number.NaN })]);
  assert.equal(plan.added.length, 1);
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.invalid, 2);
  assert.throws(() => readBook({ version: 99, transactions: [] }), /不支持/);
});

test("meaningful note is the title, generic note is not", () => {
  assert.deepEqual(displayTransaction(expense("one", "2026-07-01")), { title: "晚餐", merchant: "美团" });
  assert.deepEqual(displayTransaction(expense("two", "2026-07-01", { note: "扫码支付" })), { title: "美团", merchant: undefined });
});
