import assert from "node:assert/strict";
import test from "node:test";
import { assignGroup, counts, createBook, deleteTransaction, detachTransactions, displayTransaction, groupsInRange, groupTransactionsByDay, linkTransactions, mergeGroups, monthEnd, monthlyPaymentSummary, netExpense, planImport, readBook, relatedTransactions, relationIndex, retainMonthlyGroups, setCounted, transactionSources } from "../app/billModel.ts";

const expense = (id, date, extra = {}) => ({ id, date, merchant: "美团", amount: 28, category: "餐饮", kind: "expense", note: "晚餐", tags: ["外卖"], counted: true, ...extra });

test("links cross-month refunds and attachments without changing monthly accounting or metadata", () => {
  const rows = [expense("ticket", "2026-09-30", { amount: 500, source: "支付宝", groupIds: ["sept"] }), expense("refund", "2026-10-01", { amount: 450, kind: "refund", source: "微信", groupIds: ["oct"] }), expense("fee", "2026-10-01", { amount: 20 }), expense("ignored", "2026-10-02", { counted: false })];
  const linked = linkTransactions(linkTransactions(rows, ["refund"], "ticket", "followup"), ["fee", "ignored"], "ticket", "attachment");
  assert.equal(netExpense(relatedTransactions(relationIndex(linked), "ticket")), 70);
  assert.equal(netExpense(linked.filter((item) => item.date.startsWith("2026-09"))), 500);
  assert.equal(netExpense(linked.filter((item) => item.date.startsWith("2026-10"))), -430);
  assert.equal(linked[1].relation, "followup");
  assert.equal(linked[2].relation, "attachment");
  assert.equal(linked[3].counted, false);
  for (let i = 0; i < rows.length; i++) {
    const unchanged = { ...linked[i] };
    delete unchanged.parentId; delete unchanged.relation;
    assert.deepEqual(unchanged, rows[i]);
  }
  assert.equal(rows[1].parentId, undefined);
});

test("whole and separate monthly JSON backups retain relation IDs and restore in either order", () => {
  const linked = linkTransactions([expense("ticket", "2026-09-30", { amount: 500 }), expense("refund", "2026-10-01", { kind: "refund", amount: 450 })], ["refund"], "ticket", "followup");
  const backup = JSON.parse(JSON.stringify(createBook(linked)));
  assert.equal(backup.version, 7);
  const whole = readBook(backup).transactions;
  assert.equal(relatedTransactions(relationIndex(whole), "ticket").length, 2);
  for (const months of [["2026-09", "2026-10"], ["2026-10", "2026-09"]]) {
    let restored = [];
    for (const month of months) restored.push(...planImport(restored, createBook(linked.filter((item) => item.date.startsWith(month)))).added);
    assert.equal(restored.find((item) => item.id === "refund").parentId, "ticket");
    assert.equal(netExpense(relatedTransactions(relationIndex(restored), "ticket")), 50);
  }
  const old = readBook({ version: 5, transactions: [expense("old", "2026-09-01")] });
  assert.equal(old.transactions.length, 1);
});

test("duplicate import preserves local relinking and detaching", () => {
  const rows = [expense("one", "2026-09-01"), expense("two", "2026-09-02"), expense("child", "2026-10-01")];
  const incoming = linkTransactions(rows, ["child"], "one", "followup");
  const local = linkTransactions(incoming, ["child"], "two", "attachment");
  assert.equal(planImport(local, createBook(incoming)).added.length, 0);
  assert.equal(local[2].parentId, "two");
  const detached = detachTransactions(local, ["child"]);
  assert.equal(detached[2].parentId, undefined);
  assert.equal(detached[2].relation, undefined);
  assert.equal(planImport(detached, createBook(incoming)).added.length, 0);
  assert.equal(netExpense(detached), netExpense(rows));
});

test("rejects cycles, self links and import cycles across existing and incoming months", () => {
  const rows = [expense("a", "2026-09-01"), expense("b", "2026-10-01"), expense("c", "2026-10-02")];
  const linked = linkTransactions(linkTransactions(rows, ["b"], "a", "followup"), ["c"], "b", "attachment");
  assert.throws(() => linkTransactions(linked, ["a"], "c", "followup"), /循环/);
  assert.throws(() => linkTransactions(rows, ["a"], "a", "followup"), /主账单/);
  assert.throws(() => linkTransactions(rows, ["b"], "missing", "followup"), /不存在/);
  assert.equal(relatedTransactions(relationIndex(linked), "a").length, 3);
  const a = { ...rows[0], parentId: "b", relation: "followup" };
  const b = { ...rows[1], parentId: "a", relation: "followup" };
  assert.throws(() => readBook(createBook([a, b])), /循环/);
  assert.throws(() => planImport([a], createBook([b])), /循环/);
  assert.equal(readBook(createBook([{ ...rows[2], parentId: "a", relation: "unknown" }])).invalid, 1);
});

test("deleting a parent retains child records and their remaining descendants", () => {
  const linked = linkTransactions(linkTransactions([expense("a", "2026-09-01"), expense("b", "2026-10-01"), expense("c", "2026-10-02")], ["b"], "a", "followup"), ["c"], "b", "attachment");
  const deleted = deleteTransaction(linked, "a");
  assert.equal(deleted.length, 2);
  assert.equal(deleted[0].parentId, undefined);
  assert.equal(deleted[1].parentId, "b");
  assert.equal(netExpense(deleted), 56);
  assert.equal(linked[1].parentId, "a");
});

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

test("refund reduces selected net total and transfers default to excluded", () => {
  const rows = [expense("e", "2026-07-01"), expense("r", "2026-07-02", { kind: "refund", amount: 8 }), expense("t", "2026-07-03", { kind: "transfer", amount: 100, counted: undefined }), expense("x", "2026-07-04", { counted: false, amount: 12 })];
  assert.equal(netExpense(rows), 20);
  assert.equal(netExpense(rows.slice(1)), -8);
});

test("batch inclusion changes totals and round-trips without losing group, source or local edits", () => {
  const rows = [expense("buy", "2026-09-02", { amount: 100, groupIds: ["kitchen"], source: "支付宝", note: "我改过的炒锅" }), expense("refund", "2026-09-02", { kind: "refund", amount: 20 }), expense("income", "2026-09-02", { kind: "income", amount: 300 }), expense("transfer", "2026-09-02", { kind: "transfer", counted: false })];
  const groups = [{ id: "kitchen", name: "厨具", month: "2026-09" }];
  const excluded = setCounted(rows, ["buy", "refund", "income"], false);
  assert.equal(netExpense(excluded), 0);
  assert.equal(netExpense(rows), 80);
  const restored = readBook(JSON.parse(JSON.stringify(createBook(excluded, groups)))).transactions;
  const purchase = restored.find((item) => item.id === "buy");
  assert.equal(purchase.counted, false);
  assert.deepEqual(purchase.groupIds, ["kitchen"]);
  assert.equal(purchase.source, "支付宝");
  assert.equal(purchase.note, "我改过的炒锅");
  assert.deepEqual(purchase.tags, ["外卖"]);
  const reenabled = setCounted(restored, restored.map((item) => item.id), true);
  assert.equal(netExpense(reenabled), 108);
  assert.equal(reenabled.find((item) => item.id === "transfer").counted, true);
  assert.equal(counts(reenabled.find((item) => item.id === "income")), true);
  assert.equal(planImport(excluded, createBook(rows, groups), groups).added.length, 0);
  assert.equal(excluded[0].counted, false);
});

test("exclusions sink within their own day while months and days stay newest first", () => {
  const rows = [expense("excluded", "2026-09-30", { counted: false }), expense("older", "2026-09-29"), expense("included", "2026-09-30"), expense("oct", "2026-10-01"), expense("transfer", "2026-09-30", { kind: "transfer", counted: undefined })];
  const days = groupTransactionsByDay(rows);
  assert.deepEqual(days.map((day) => day.date), ["2026-10-01", "2026-09-30", "2026-09-29"]);
  assert.deepEqual(days[1].records.map((item) => item.id), ["included", "excluded", "transfer"]);
  assert.equal(netExpense(days[1].records), 28);
  assert.equal(rows[0].id, "excluded");
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
  const original = [expense("pan", "2026-09-01", { amount: 100, category: "购物" }), expense("refund", "2026-10-01", { amount: 20, kind: "refund" }), expense("transfer", "2026-09-02", { kind: "transfer", amount: 500, counted: false }), expense("other", "2026-09-03")];
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
  const groups = [{ id: "kitchen", name: "厨具购买", month: "2026-09" }, { id: "empty", name: "旅行", month: "2026-09" }, { id: "oct-kitchen", name: "厨具购买", month: "2026-10" }];
  const records = [expense("sept", "2026-09-01", { groupIds: ["kitchen"] }), expense("oct", "2026-10-01", { groupIds: ["oct-kitchen"] })];
  const monthly = readBook(JSON.parse(JSON.stringify(createBook(records.slice(0, 1), groupsInRange(groups, "2026-09")))));
  assert.deepEqual(monthly.groups, groups.slice(0, 2));
  assert.deepEqual(monthly.transactions[0].groupIds, ["kitchen"]);
  const whole = readBook(createBook(records, groups));
  assert.equal(netExpense(whole.transactions), 56);
  assert.deepEqual(whole.groups, groups);
  const localGroups = [{ ...groups[0], name: "我改过的组名" }];
  const plan = planImport(assignGroup(records, ["sept"], "empty"), createBook(records, groups), localGroups);
  assert.equal(plan.added.length, 0);
  assert.equal(plan.duplicates, 2);
  assert.deepEqual(mergeGroups(localGroups, plan.groups), [localGroups[0], ...groups.slice(1)]);
  assert.deepEqual(planImport([], createBook([], groups)).groups, groups);
  assert.equal(readBook({ version: 4, transactions: [{ ...records[0], groupIds: ["missing"] }], groups }).invalid, 1);
});

test("monthly groups isolate moves, renames, deletion and empty-month exports", () => {
  const groups = [{ id: "sept", name: "厨具", month: "2026-09" }, { id: "oct", name: "厨具", month: "2026-10" }, { id: "empty", name: "旅行", month: "2026-11" }];
  const rows = [expense("pan", "2026-09-01"), expense("refund", "2026-09-02", { kind: "refund", amount: 8 }), expense("oct-pan", "2026-10-01", { groupIds: ["oct"] })];
  const moved = assignGroup(rows, rows.map((item) => item.id), "sept", false, "2026-09");
  assert.deepEqual(moved[2].groupIds, ["oct"]);
  assert.equal(netExpense(moved.filter((item) => item.groupIds?.includes("sept"))), 20);
  assert.deepEqual(groupsInRange(groups, "2026-09").map((group) => group.id), ["sept"]);
  assert.deepEqual(groupsInRange(groups, "2026-09", "2026-10").map((group) => group.id), ["oct", "sept"]);
  const renamed = groups.map((group) => group.id === "sept" ? { ...group, name: "锅具" } : group);
  assert.equal(renamed[1].name, "厨具");
  const deleted = assignGroup(moved, moved.map((item) => item.id), "sept", true);
  assert.deepEqual(deleted[2].groupIds, ["oct"]);
  assert.equal(netExpense(deleted), netExpense(rows));
  const emptyBackup = createBook([], groupsInRange(groups, "2026-11"));
  assert.deepEqual(readBook(emptyBackup).groups, [groups[2]]);
  assert.deepEqual(planImport([], emptyBackup).months, ["2026-11"]);
  assert.equal(retainMonthlyGroups({ ...moved[0], date: "2026-10-01" }, groups).groupIds.length, 0);
  assert.deepEqual(retainMonthlyGroups(moved[0], groups).groupIds, ["sept"]);
});

test("legacy global groups split deterministically by month without changing transactions or totals", () => {
  const old = { version: 4, groups: [{ id: "kitchen", name: "厨具" }, { id: "empty", name: "旅行" }], transactions: [expense("pan", "2026-09-01", { groupIds: ["kitchen"] }), expense("refund", "2026-10-01", { groupIds: ["kitchen"], kind: "refund", amount: 8 }), expense("excluded", "2026-09-02", { groupIds: ["kitchen"], counted: false })] };
  const migrated = readBook(old);
  assert.equal(migrated.invalid, 0);
  assert.equal(migrated.groups.length, 3);
  assert.equal(migrated.transactions.length, 3);
  assert.equal(netExpense(migrated.transactions), netExpense(old.transactions));
  assert.equal(migrated.transactions[2].counted, false);
  for (const item of migrated.transactions) assert.equal(migrated.groups.find((group) => group.id === item.groupIds[0]).month, item.date.slice(0, 7));
  const reimport = planImport(migrated.transactions, old, migrated.groups);
  assert.equal(reimport.added.length, 0);
  assert.equal(reimport.groups.length, 0);
  assert.deepEqual(readBook(createBook(migrated.transactions, migrated.groups)).groups, migrated.groups);
  const single = readBook({ ...old, transactions: old.transactions.slice(0, 1) });
  assert.equal(single.groups[0].id, migrated.groups[0].id);
  assert.equal(readBook({ version: 4, groups: old.groups, transactions: [] }, "2026-09").groups[0].month, "2026-09");
  assert.throws(() => readBook({ version: 5, groups: old.groups, transactions: [] }), /格式无效/);
  assert.equal(readBook({ version: 5, groups: [{ id: "sept", name: "厨具", month: "2026-09" }], transactions: [expense("bad", "2026-10-01", { groupIds: ["sept"] })] }).invalid, 1);
});


test("imported monthly repayment can be restored, edited and backed up without changing its type", () => {
  const raw = expense("monthly-pay", "2026-09-30", { kind: "repayment", amount: 530.41, counted: false, source: "美团", note: "月付还款" });
  const imported = planImport([], createBook([raw])).added;
  assert.equal(counts(imported[0]), false);
  const restored = setCounted(imported, [raw.id], true);
  assert.equal(counts(restored[0]), true);
  assert.equal(netExpense(restored), 530.41);
  assert.equal(restored[0].kind, "repayment");
  const backup = readBook(JSON.parse(JSON.stringify(createBook(restored))));
  assert.equal(netExpense(backup.transactions), 530.41);
  assert.equal(planImport(restored, createBook([raw])).added.length, 0);
  assert.equal(netExpense(setCounted(restored, [raw.id], false)), 0);
  assert.equal(counts({ ...raw, counted: undefined }), false);
});


test("monthly payments count purchases and refunds on original dates while excluding repayment", () => {
  const rows = [expense("payment", "2026-10-10", { kind: "repayment", amount: 210, counted: true }), expense("meal", "2026-09-30", { amount: 100, counted: false, source: "美团", groupIds: ["sept"], orderId: "meal-order" }), expense("pan", "2026-09-29", { amount: 150 }), expense("refund", "2026-10-01", { kind: "refund", amount: 50, counted: false }), expense("other", "2026-09-30", { counted: false })];
  const linked = linkTransactions(rows, ["meal", "pan", "refund"], "payment", "monthly");
  assert.equal(linked[0].counted, false);
  assert.equal(linked[1].counted, true);
  assert.equal(linked[3].counted, true);
  assert.equal(linked[4].counted, false);
  assert.equal(netExpense(linked), 200);
  assert.equal(netExpense(linked.filter((item) => item.date.startsWith("2026-09"))), 250);
  assert.equal(netExpense(linked.filter((item) => item.date.startsWith("2026-10"))), -50);
  assert.equal(linked[1].date, rows[1].date);
  assert.equal(linked[1].orderId, "meal-order");
  assert.deepEqual(linked[1].groupIds, ["sept"]);
  assert.equal(rows[0].counted, true);
  const summary = monthlyPaymentSummary(relationIndex(linked), "payment");
  assert.equal(summary.records.length, 3);
  assert.equal(summary.total, 200);
  assert.equal(summary.difference, 10);
  const detached = detachTransactions(linked, ["meal"]);
  assert.equal(detached[1].counted, true);
  assert.equal(monthlyPaymentSummary(relationIndex(detached), "payment").total, 100);
});

test("monthly payment backups restore in either order and preserve later inclusion edits", () => {
  const rows = linkTransactions([expense("payment", "2026-10-10", { kind: "repayment", amount: 100 }), expense("order", "2026-09-30", { amount: 100 })], ["order"], "payment", "monthly");
  for (const dates of [["2026-09", "2026-10"], ["2026-10", "2026-09"]]) {
    let restored = [];
    for (const month of dates) restored.push(...planImport(restored, createBook(rows.filter((item) => item.date.startsWith(month)))).added);
    assert.equal(netExpense(restored), 100);
    assert.equal(monthlyPaymentSummary(relationIndex(restored), "payment").difference, 0);
  }
  const local = setCounted(rows, ["order"], false);
  const imported = planImport(local, createBook(rows));
  assert.equal(imported.duplicates, 2);
  assert.equal(imported.added.length, 0);
  assert.equal(netExpense(local), 0);
  assert.equal(readBook({ version: 6, transactions: [expense("old", "2026-09-30")] }).transactions.length, 1);
});

test("monthly payment summary includes refund followups once and validates payment roles", () => {
  const original = [expense("payment", "2026-10-10", { kind: "repayment", amount: 100 }), expense("buy", "2026-09-30", { amount: 100 }), expense("refund", "2026-10-01", { kind: "refund", amount: 20 })];
  const linked = linkTransactions(linkTransactions(original, ["refund"], "buy", "followup"), ["buy"], "payment", "monthly");
  assert.equal(monthlyPaymentSummary(relationIndex(linked), "payment").total, 80);
  const regrouped = linkTransactions(linked, ["refund"], "payment", "monthly");
  assert.equal(monthlyPaymentSummary(relationIndex(regrouped), "payment").total, 80);
  assert.equal(monthlyPaymentSummary(relationIndex(regrouped), "payment").records.length, 2);
  assert.throws(() => linkTransactions(original, ["payment"], "buy", "monthly"), /消费或退款/);
  assert.throws(() => linkTransactions(original, ["buy"], "refund", "monthly"), /主账单/);
  assert.throws(() => linkTransactions(regrouped, ["buy"], "refund", "monthly"), /主账单/);
  assert.throws(() => linkTransactions(regrouped, ["payment"], "buy", "monthly"), /主账单/);
});
