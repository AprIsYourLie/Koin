export type Kind = "expense" | "refund" | "income" | "repayment" | "transfer";
export type MonthlyAccounting = "details" | "repayments";
export type RelationKind = "followup" | "attachment" | "monthly";
export type PurposeGroup = { id: string; name: string; month: string };

export type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  kind: Kind;
  note?: string;
  tags?: string[];
  groupIds?: string[];
  source?: string;
  payment?: string;
  fundingAccount?: string;
  counted?: boolean;
  matchStatus?: string;
  possibleMatchId?: string;
  orderId?: string;
  evidence?: unknown[];
  parentId?: string;
  relation?: RelationKind;
};

export type ImportPreview = {
  added: Transaction[];
  groups: PurposeGroup[];
  duplicates: number;
  invalid: number;
  months: string[];
  total: number;
};

export const STORE_KEY = "koin.transactions.v1";
export const CATEGORIES = ["餐饮", "生活", "购物", "交通", "游戏", "娱乐", "居住", "医疗", "学习", "其他"];
export const CATEGORY_COLORS: Record<string, string> = {
  餐饮: "#d69178", 生活: "#7f9b8d", 购物: "#8f86ae", 交通: "#6e9e96", 游戏: "#9988ad",
  娱乐: "#c9a76b", 居住: "#7890a8", 医疗: "#c98a9a", 学习: "#9a8b7c", 其他: "#9da39f",
};

const KINDS: Kind[] = ["expense", "refund", "income", "repayment", "transfer"];
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const GENERIC_NOTES = /^(?:消费|支付订单(?:\(.*\))?|付款码支付(?:[—-]+购买商品)?|网上快捷支付|扫码支付|收钱码收款|收款方备注[:：]?二维码收款|先用后付|先骑后付|京东-订单编号|订单编号[:：]?|tradeDesc)$/i;

export function displayTransaction(item: Transaction) {
  const note = item.note?.replace(/^导入行\s*\d+\s*(?:[·•｜|—-]\s*)?/, "").trim();
  const product = (item.kind === "expense" || item.kind === "refund") && note && !GENERIC_NOTES.test(note) && note !== item.merchant ? note : undefined;
  return { title: product ?? item.merchant, merchant: product ? item.merchant : undefined };
}

export function transactionSources(item: Transaction) {
  const aliases: Record<string, string> = { 微信支付: "微信", WeChat: "微信", 支付宝支付: "支付宝", Alipay: "支付宝", 抖音支付: "抖音", 手动: "手动记录" };
  const sources = [item.source, ...(item.evidence ?? []).map((entry) => entry && typeof entry === "object" && "source" in entry ? entry.source : undefined)]
    .filter((source): source is string => typeof source === "string" && Boolean(source.trim()))
    .map((source) => aliases[source.trim()] ?? source.trim());
  return [...new Set(sources.length ? sources : ["整理导入"])];
}

export function counts(item: Transaction) {
  return item.counted ?? (item.kind !== "repayment" && item.kind !== "transfer");
}

export function setCounted(items: Transaction[], ids: string[], counted: boolean) {
  const selected = new Set(ids);
  return items.map((item) => selected.has(item.id) ? { ...item, counted } : item);
}

export function groupTransactionsByDay(items: Transaction[]) {
  const days = new Map<string, Transaction[]>();
  const sorted = [...items].sort((left, right) => right.date.localeCompare(left.date) || Number(!counts(left)) - Number(!counts(right)) || left.id.localeCompare(right.id));
  for (const item of sorted) {
    if (!days.has(item.date)) days.set(item.date, []);
    days.get(item.date)!.push(item);
  }
  return [...days].map(([date, records]) => ({ date, records }));
}

export function netExpense(items: Transaction[]) {
  return items.reduce((sum, item) => sum + (counts(item) ? item.kind === "refund" ? -item.amount : item.kind === "income" ? 0 : item.amount : 0), 0);
}

export function relationIndex(items: Transaction[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const children = new Map<string, Transaction[]>();
  for (const item of items) if (item.parentId && byId.has(item.parentId)) {
    if (!children.has(item.parentId)) children.set(item.parentId, []);
    children.get(item.parentId)!.push(item);
  }
  for (const rows of children.values()) rows.sort((a, b) => a.date.localeCompare(b.date) || Number(!counts(a)) - Number(!counts(b)) || a.id.localeCompare(b.id));
  return { byId, children };
}

export function relatedTransactions(index: ReturnType<typeof relationIndex>, id: string) {
  const found: Transaction[] = [];
  const pending = [id];
  const seen = new Set<string>();
  while (pending.length) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const item = index.byId.get(next);
    if (item) found.push(item);
    pending.push(...(index.children.get(next) ?? []).map((child) => child.id));
  }
  return found;
}

export function monthlyPaymentSummary(index: ReturnType<typeof relationIndex>, id: string) {
  const bill = index.byId.get(id);
  const entries = new Map<string, Transaction>();
  for (const child of index.children.get(id) ?? []) if (child.relation === "monthly") {
    for (const row of relatedTransactions(index, child.id)) entries.set(row.id, row);
  }
  const records = [...entries.values()];
  const paymentIds = new Set(records.filter((row) => row.kind === "repayment" || row.kind === "transfer" || index.children.get(row.id)?.some((child) => child.relation === "monthly")).map((row) => row.id));
  const details = records.filter((row) => !paymentIds.has(row.id));
  const total = netExpense(details.map((row) => ({ ...row, counted: true })));
  const earlyRepayments = records.filter((row) => paymentIds.has(row.id)).reduce((sum, row) => sum + row.amount, 0);
  const paid = (bill?.amount ?? 0) + earlyRepayments;
  return { records, details, total, earlyRepayments, paid, difference: paid - total };
}

export function applyMonthlyAccounting(items: Transaction[], mode: MonthlyAccounting, rootIds?: string[]) {
  const index = relationIndex(items);
  const roots = [...index.children].filter(([, children]) => children.some((child) => child.relation === "monthly")).map(([id]) => id);
  const billIds = new Set(roots);
  const included = new Map<string, boolean>();
  for (const id of rootIds ?? roots) {
    included.set(id, mode === "repayments");
    for (const row of monthlyPaymentSummary(index, id).records) {
      const payment = billIds.has(row.id) || row.kind === "repayment" || row.kind === "transfer";
      included.set(row.id, mode === "repayments" ? payment : !payment && row.kind !== "income");
    }
  }
  return items.map((item) => included.has(item.id) ? { ...item, counted: included.get(item.id)! } : item);
}

export function contextTransactionIds(items: Transaction[], selected: Set<string>, clickedId: string) {
  return items.filter((item) => selected.has(clickedId) ? selected.has(item.id) : item.id === clickedId).map((item) => item.id);
}

function validateRelations(items: Transaction[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const complete = new Set<string>();
  for (const item of items) {
    const path = new Set<string>();
    let current: Transaction | undefined = item;
    while (current && !complete.has(current.id)) {
      if (path.has(current.id)) throw new Error("关联不能形成循环，也不能关联到自己");
      path.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const id of path) complete.add(id);
  }
}

export function linkTransactions(items: Transaction[], ids: string[], parentId: string, relation: RelationKind, monthlyMode: MonthlyAccounting = "details") {
  if (!items.some((item) => item.id === parentId)) throw new Error("主账单不存在");
  if (relation !== "followup" && relation !== "attachment" && relation !== "monthly") throw new Error("关联类型无效");
  const selected = new Set(ids);
  if (!selected.size || ids.some((id) => !items.some((item) => item.id === id))) throw new Error("请选择有效的关联账单");
  if (selected.has(parentId)) throw new Error("主账单不能同时被选为它的关联记录");
  if (relation === "monthly") {
    const parent = items.find((item) => item.id === parentId)!;
    if (parent.kind === "income" || parent.kind === "refund") throw new Error("请选择月付还款账单作为主账单");
    if (items.some((item) => selected.has(item.id) && item.kind === "income")) throw new Error("月付关联可包含消费、退款或提前还款，不能包含收入");
  }
  const result = items.map((item) => selected.has(item.id) ? { ...item, parentId, relation } : item);
  validateRelations(result);
  if (relation !== "monthly") return result;
  const index = relationIndex(result);
  let root = index.byId.get(parentId)!;
  while (root.relation === "monthly" && root.parentId && index.byId.has(root.parentId)) root = index.byId.get(root.parentId)!;
  return applyMonthlyAccounting(result, monthlyMode, [root.id]);
}

export function detachTransactions(items: Transaction[], ids: string[]) {
  const selected = new Set(ids);
  return items.map((item) => selected.has(item.id) ? { ...item, parentId: undefined, relation: undefined } : item);
}

export function deleteTransaction(items: Transaction[], id: string) {
  return detachTransactions(items.filter((item) => item.id !== id), items.filter((item) => item.parentId === id).map((item) => item.id));
}

export function monthEnd(month: string) {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}`;
}

function validDate(date: unknown): date is string {
  if (typeof date !== "string" || !DATE.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day;
}

function record(value: unknown): Transaction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim() || !validDate(item.date) || typeof item.merchant !== "string" || !item.merchant.trim()) return null;
  if (typeof item.amount !== "number" || !Number.isFinite(item.amount) || item.amount <= 0 || !KINDS.includes(item.kind as Kind)) return null;
  if (item.counted !== undefined && typeof item.counted !== "boolean") return null;
  if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string"))) return null;
  if (item.groupIds !== undefined && (!Array.isArray(item.groupIds) || item.groupIds.some((id) => typeof id !== "string" || !id.trim()))) return null;
  if (item.parentId !== undefined && (typeof item.parentId !== "string" || !item.parentId.trim() || !["followup", "attachment", "monthly"].includes(item.relation as string))) return null;
  if (item.parentId === undefined && item.relation !== undefined) return null;
  return {
    ...item,
    id: item.id.trim(),
    merchant: item.merchant.trim(),
    category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : "其他",
    tags: [...new Set(((item.tags as string[] | undefined) ?? []).map((tag) => tag.trim()).filter(Boolean))],
    groupIds: [...new Set((item.groupIds as string[] | undefined) ?? [])],
    source: typeof item.source === "string" ? item.source : "整理导入",
    payment: typeof item.payment === "string" ? item.payment : "",
    note: typeof item.note === "string" ? item.note : undefined,
    parentId: typeof item.parentId === "string" ? item.parentId.trim() : undefined,
  } as Transaction;
}

export function mergeGroups(existing: PurposeGroup[], incoming: PurposeGroup[]) {
  const merged = new Map(existing.map((group) => [group.id, group]));
  for (const group of incoming) if (!merged.has(group.id)) merged.set(group.id, group);
  return [...merged.values()];
}

export function groupsInRange(groups: PurposeGroup[], start?: string, end = start) {
  return groups.filter((group) => !start || (group.month >= start && group.month <= (end ?? start)))
    .sort((left, right) => right.month.localeCompare(left.month));
}

export function retainMonthlyGroups(item: Transaction, groups: PurposeGroup[]) {
  return { ...item, groupIds: (item.groupIds ?? []).filter((id) => groups.some((group) => group.id === id && group.month === item.date.slice(0, 7))) };
}

export function assignGroup(items: Transaction[], ids: string[], groupId: string, remove = false, month?: string) {
  const selected = new Set(ids);
  return items.map((item) => selected.has(item.id) && (remove || !month || item.date.startsWith(month)) ? { ...item, groupIds: remove ? (item.groupIds ?? []).filter((id) => id !== groupId) : [groupId] } : item);
}

export function readBook(value: unknown, legacyMonth?: string): { transactions: Transaction[]; groups: PurposeGroup[]; invalid: number; total: number } {
  const document = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (document?.version !== undefined && (typeof document.version !== "number" || document.version > 7)) throw new Error("不支持此 JSON 版本");
  const rows = Array.isArray(value) ? value : document?.transactions;
  if (!Array.isArray(rows)) throw new Error("JSON 中没有 transactions 记录列表");
  const rawGroups = document?.groups ?? [];
  if (!Array.isArray(rawGroups) || rawGroups.some((group) => !group || typeof group.id !== "string" || !group.id.trim() || typeof group.name !== "string" || !group.name.trim() || (group.month !== undefined && (typeof group.month !== "string" || !MONTH.test(group.month))) || (typeof document?.version === "number" && document.version >= 5 && group.month === undefined))) throw new Error("用途分组格式无效");
  const records = rows.map(record);
  const fallbackMonth = legacyMonth ?? records.filter((item) => item !== null).map((item) => item.date.slice(0, 7)).sort().at(-1) ?? new Date().toLocaleDateString("sv-SE").slice(0, 7);
  const legacyIds = new Set(rawGroups.filter((group) => group.month === undefined).map((group) => group.id.trim()));
  const migrated: PurposeGroup[] = rawGroups.flatMap((group) => {
    const id = group.id.trim();
    const name = group.name.trim();
    if (group.month !== undefined) return [{ id, name, month: group.month }];
    const months = [...new Set(records.flatMap((item) => item?.groupIds?.includes(id) ? [item.date.slice(0, 7)] : []))];
    return (months.length ? months : [fallbackMonth]).map((month) => ({ id: `${id}::${month}`, name, month }));
  });
  const groups = mergeGroups([], migrated);
  const knownGroups = new Map(groups.map((group) => [group.id, group]));
  const parsed = records.map((item): Transaction | null => {
    if (!item) return null;
    const month = item.date.slice(0, 7);
    const groupIds = (item.groupIds ?? []).map((id) => legacyIds.has(id) ? `${id}::${month}` : id);
    return groupIds.some((id) => knownGroups.get(id)?.month !== month) ? null : { ...item, groupIds };
  });
  const transactions = parsed.filter((item): item is Transaction => item !== null);
  validateRelations(transactions);
  return { transactions, groups, invalid: parsed.filter((item) => item === null).length, total: rows.length };
}

export function planImport(existing: Transaction[], document: unknown, existingGroups: PurposeGroup[] = []): ImportPreview {
  const parsed = readBook(document);
  const known = new Set(existing.map((item) => item.id));
  const added: Transaction[] = [];
  let duplicates = 0;
  for (const item of parsed.transactions) {
    if (known.has(item.id)) duplicates++;
    else { added.push(item); known.add(item.id); }
  }
  validateRelations([...existing, ...added]);
  return { added, groups: parsed.groups.filter((group) => !existingGroups.some((old) => old.id === group.id)), duplicates, invalid: parsed.invalid, months: [...new Set([...parsed.transactions.map((item) => item.date.slice(0, 7)), ...parsed.groups.map((group) => group.month)])].sort(), total: parsed.total };
}

export function createBook(items: Transaction[], groups: PurposeGroup[] = []) {
  return { version: 7, exportedAt: new Date().toISOString(), groups, transactions: [...items].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)) };
}
