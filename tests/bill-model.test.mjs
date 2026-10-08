import assert from "node:assert/strict";
import test from "node:test";
import { assignGroup, counts, createBook, displayTransaction, mergeGroups, monthEnd, netExpense, planImport, readBook, transactionSources } from "../app/billModel.ts";

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

test("traces merged platform and bank sources without repeated wallet aliases", () => {
  const item = expense("linked", "2026-09-01", { source: "美团", evidence: [{ source: "微信支付" }, { source: "微信" }, { source: "建设银行" }, null, {}, { source: 3 }] });
  assert.deepEqual(transactionSources(item), ["美团", "微信", "建设银行"]);
  assert.deepEqual(transactionSources(expense("manual", "2026-09-01", { source: "手动" })), ["手动记录"]);
  assert.deepEqual(transactionSources(expense("missing", "2026-09-01")), ["整理导入"]);
});

test("moves selected purchases and refunds between folders without changing their accounting", () => {
  const original = [expense("pan", "2026-09-01", { amount: 100, category: "购物" }), expense("refund", "2026-10-01", { amount: 20, kind: "refund" }), expense("transfer", "2026-09-02", { kind: "transfer", amount: 500 }), expense("other", "2026-09-03")];
  const grouped = assignGroup(original, ["pan", "refund", "transfer"], "kitchen");
  assert.equal(netExpense(grouped.filter((item) => item.groupIds?.includes("kitchen"))), 80);
  assert.equal(grouped[0].category, "购物");
  assert.deepEqual(grouped[0].tags, original[0].tags);
  assert.equal(original[0].groupIds, undefined);
  const moved = assignGroup(grouped, ["pan", "refund"], "home");
  assert.deepEqual(moved[0].groupIds, ["home"]);
  assert.equal(netExpense(moved), netExpense(original));
  assert.equal(netExpense(moved.filter((item) => item.groupIds?.includes("kitchen"))), 0);
  assert.deepEqual(assignGroup(moved, ["pan"], "home", true)[0].groupIds, []);
});

test("folder backups restore memberships, empty folders and duplicate imports preserve local organization", () => {
  const groups = [{ id: "kitchen", name: "厨具购买" }, { id: "empty", name: "旅行" }];
  const records = assignGroup([expense("sept", "2026-09-01"), expense("oct", "2026-10-01")], ["sept", "oct"], "kitchen");
  const monthly = readBook(JSON.parse(JSON.stringify(createBook(records.slice(0, 1), groups))));
  assert.deepEqual(monthly.groups, groups);
  assert.deepEqual(monthly.transactions[0].groupIds, ["kitchen"]);
  const whole = readBook(createBook(records, groups));
  assert.equal(netExpense(whole.transactions.filter((item) => item.groupIds?.includes("kitchen"))), 56);
  const localGroups = [{ id: "kitchen", name: "我改过的组名" }];
  const plan = planImport(assignGroup(records, ["sept"], "empty"), createBook(records, groups), localGroups);
  assert.equal(plan.added.length, 0);
  assert.equal(plan.duplicates, 2);
  assert.deepEqual(mergeGroups(localGroups, plan.groups), [localGroups[0], groups[1]]);
  assert.deepEqual(planImport([], createBook([], groups)).groups, groups);
  assert.equal(readBook({ version: 4, transactions: [{ ...records[0], groupIds: ["missing"] }], groups }).invalid, 1);
});
