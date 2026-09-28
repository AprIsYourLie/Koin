export type Kind = "expense" | "refund" | "income" | "repayment" | "transfer";

export type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  kind: Kind;
  note?: string;
  tags?: string[];
  source?: string;
  payment?: string;
  fundingAccount?: string;
  counted?: boolean;
  matchStatus?: string;
  possibleMatchId?: string;
  orderId?: string;
  evidence?: unknown[];
};

export type ImportPreview = {
  added: Transaction[];
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
const GENERIC_NOTES = /^(?:消费|支付订单(?:\(.*\))?|付款码支付(?:[—-]+购买商品)?|网上快捷支付|扫码支付|收钱码收款|收款方备注[:：]?二维码收款|先用后付|先骑后付|京东-订单编号|订单编号[:：]?|tradeDesc)$/i;

export function displayTransaction(item: Transaction) {
  const note = item.note?.replace(/^导入行\s*\d+\s*(?:[·•｜|—-]\s*)?/, "").trim();
  const product = (item.kind === "expense" || item.kind === "refund") && note && !GENERIC_NOTES.test(note) && note !== item.merchant ? note : undefined;
  return { title: product ?? item.merchant, merchant: product ? item.merchant : undefined };
}

export function counts(item: Transaction) {
  return item.counted !== false && item.kind !== "repayment" && item.kind !== "transfer";
}

export function netExpense(items: Transaction[]) {
  return items.reduce((sum, item) => sum + (counts(item) ? item.kind === "expense" ? item.amount : item.kind === "refund" ? -item.amount : 0 : 0), 0);
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
  return {
    ...item,
    id: item.id.trim(),
    merchant: item.merchant.trim(),
    category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : "其他",
    tags: [...new Set(((item.tags as string[] | undefined) ?? []).map((tag) => tag.trim()).filter(Boolean))],
    source: typeof item.source === "string" ? item.source : "整理导入",
    payment: typeof item.payment === "string" ? item.payment : "",
    note: typeof item.note === "string" ? item.note : undefined,
  } as Transaction;
}

export function readBook(value: unknown): { transactions: Transaction[]; invalid: number; total: number } {
  const document = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (document?.version !== undefined && (typeof document.version !== "number" || document.version > 3)) throw new Error("不支持此 JSON 版本");
  const rows = Array.isArray(value) ? value : document?.transactions;
  if (!Array.isArray(rows)) throw new Error("JSON 中没有 transactions 记录列表");
  const parsed = rows.map(record);
  return { transactions: parsed.filter((item): item is Transaction => item !== null), invalid: parsed.filter((item) => item === null).length, total: rows.length };
}

export function planImport(existing: Transaction[], document: unknown): ImportPreview {
  const parsed = readBook(document);
  const known = new Set(existing.map((item) => item.id));
  const added: Transaction[] = [];
  let duplicates = 0;
  for (const item of parsed.transactions) {
    if (known.has(item.id)) duplicates++;
    else { added.push(item); known.add(item.id); }
  }
  return { added, duplicates, invalid: parsed.invalid, months: [...new Set(parsed.transactions.map((item) => item.date.slice(0, 7)))].sort(), total: parsed.total };
}

export function createBook(items: Transaction[]) {
  return { version: 3, exportedAt: new Date().toISOString(), transactions: [...items].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)) };
}
