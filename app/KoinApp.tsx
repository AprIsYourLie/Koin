import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

type Kind = "expense" | "refund" | "income" | "repayment" | "transfer";
type MatchStatus = "single" | "linked" | "review" | "excluded";
type Evidence = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  source: string;
  payment: string;
  fundingAccount: string;
  kind: Kind;
  orderId?: string;
};
type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  payment: string;
  source: string;
  kind: Kind;
  fundingAccount?: string;
  evidence?: Evidence[];
  matchStatus?: MatchStatus;
  possibleMatchId?: string;
  counted?: boolean;
  orderId?: string;
  note?: string;
};

type ImportPlan = {
  transactions: Transaction[];
  preview: Transaction[];
  imported: number;
  added: number;
  linked: number;
  excluded: number;
  review: number;
  skipped: number;
};

const STORE_KEY = "koin.transactions.v1";
const CATEGORY_COLORS: Record<string, string> = {
  餐饮: "#ef825f",
  生活: "#6f9a85",
  购物: "#7559d9",
  交通: "#43a68b",
  游戏: "#9a65cf",
  娱乐: "#e9b949",
  居住: "#497cc4",
  医疗: "#dc6683",
  学习: "#8b6f5a",
  其他: "#9b9a96",
};
const CATEGORIES = Object.keys(CATEGORY_COLORS);
function localDate(day: number) {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(Math.min(day, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())).padStart(2, "0")}`;
}

function money(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cleanImportedNote(note?: string) {
  const cleaned = note?.replace(/^导入行\s*\d+\s*(?:[·•｜|—-]\s*)?/, "").trim();
  return cleaned || undefined;
}

const GENERIC_PRODUCT_NOTES = /^(?:消费|支付订单(?:\(.*\))?|付款码支付(?:[—-]+购买商品)?|网上快捷支付|扫码支付|收钱码收款|收款方备注[:：]?二维码收款|先用后付|先骑后付|京东-订单编号|订单编号[:：]?|tradeDesc)$/i;

function transactionDisplay(item: Pick<Transaction, "merchant" | "note" | "kind">) {
  const note = cleanImportedNote(item.note);
  const product = (item.kind === "expense" || item.kind === "refund") && note && !GENERIC_PRODUCT_NOTES.test(note) ? note : undefined;
  return {
    primary: product ?? item.merchant,
    merchant: product && product !== item.merchant ? item.merchant : undefined,
    note: product ? undefined : note,
  };
}

function detectSource(sourceHint: string) {
  if (/微信|财付通/.test(sourceHint)) return "微信";
  if (/支付宝/.test(sourceHint)) return "支付宝";
  if (/美团月付/.test(sourceHint)) return "美团月付";
  if (/抖音月付/.test(sourceHint)) return "抖音月付";
  if (/抖音/.test(sourceHint)) return "抖音";
  if (/美团/.test(sourceHint)) return "美团";
  if (/京东|白条/.test(sourceHint)) return "京东";
  if (/银行|银行卡|信用卡|储蓄卡|招商|工商|建设|农业|邮储|浦发|中信|民生|平安|广发|光大/.test(sourceHint)) return "银行卡";
  return "账单导入";
}

function normalizePaymentChannel(payment: string, source: string, text = "") {
  const combined = `${payment} ${text}`;
  if (/微信|财付通/.test(combined) || source === "微信") return "微信支付";
  if (/支付宝/.test(combined) || source === "支付宝") return "支付宝";
  if (/美团月付/.test(combined) || source === "美团月付") return "美团月付";
  if (/抖音月付/.test(combined) || source === "抖音月付") return "抖音月付";
  if (/白条/.test(combined)) return "京东白条";
  if (/银行卡|信用卡|储蓄卡|银联/.test(combined) || source === "银行卡") return "银行卡";
  return payment || source;
}

function inferFundingAccount(payment: string, source: string, text = "") {
  const combined = `${payment} ${text}`;
  const monthly = combined.match(/花呗|京东白条|白条|美团月付|抖音月付/);
  if (monthly) return monthly[0] === "白条" ? "京东白条" : monthly[0];
  const card = combined.match(/(?:招商|工商|建设|农业|中国|交通|邮储|浦发|中信|民生|平安|广发|光大)?(?:银行)?(?:信用卡|储蓄卡|银行卡)(?:\([^)]*\)|尾号\d+)?/);
  if (card) return card[0];
  if (/零钱/.test(combined)) return "微信零钱";
  if (/支付宝余额|余额宝/.test(combined)) return "支付宝余额";
  if (source === "银行卡") return "银行卡";
  return "未识别";
}

function inferKind(text: string, flow = ""): Kind {
  if (/退款|退回|退货/.test(text)) return "refund";
  if (/还款|偿还|自动扣款.*(?:花呗|白条|月付|信用卡)/.test(text)) return "repayment";
  if (/收入|收款/.test(flow) || /收益到账|工资|利息收入/.test(text)) return "income";
  if (/不计收支|中性/.test(flow) || /转账|提现|充值|账户互转|零钱通存取|理财申购|理财赎回/.test(text)) return "transfer";
  return "expense";
}

function kindLabel(kind: Kind) {
  return ({ expense: "消费", refund: "退款", income: "收入", repayment: "还款", transfer: "转账/不计" } as Record<Kind, string>)[kind];
}

function evidenceFrom(item: Transaction): Evidence {
  return { id: crypto.randomUUID(), date: item.date, merchant: item.merchant, amount: item.amount, source: item.source, payment: item.payment, fundingAccount: item.fundingAccount ?? inferFundingAccount(item.payment, item.source, item.merchant), kind: item.kind, orderId: item.orderId };
}

function rawEvidenceKey(item: Evidence) {
  if (item.orderId) return `${item.source}|${item.orderId}|${item.kind}`;
  return `${item.source}|${item.date}|${item.merchant.replace(/\s/g, "").toLowerCase()}|${item.amount.toFixed(2)}|${item.kind}`;
}

function normalizeTransaction(item: Transaction): Transaction {
  const fundingAccount = item.fundingAccount ?? inferFundingAccount(item.payment, item.source, `${item.merchant} ${item.note ?? ""}`);
  const kind = item.kind === "transfer" && /还款|偿还/.test(`${item.merchant} ${item.note ?? ""}`) ? "repayment" : item.kind;
  const excluded = kind === "repayment" || kind === "transfer";
  const base: Transaction = { ...item, fundingAccount, kind, counted: excluded || item.matchStatus === "review" ? false : item.counted ?? true, matchStatus: item.matchStatus ?? (excluded ? "excluded" : "single") };
  return { ...base, evidence: item.evidence?.length ? item.evidence : [evidenceFrom(base)] };
}

function sourceLayer(source: string) {
  if (source === "银行卡") return 3;
  if (/微信|支付宝|美团月付|抖音月付|花呗|白条/.test(source)) return 2;
  if (/美团|抖音|京东|淘宝/.test(source)) return 1;
  return 0;
}

function dateDistance(left: string, right: string) {
  return Math.abs(parseDate(left).getTime() - parseDate(right).getTime()) / 86400000;
}

function channelRelated(left: Transaction, right: Transaction) {
  const text = `${left.source} ${left.payment} ${left.fundingAccount} ${left.merchant} ${right.source} ${right.payment} ${right.fundingAccount} ${right.merchant}`;
  const sourceBridge = ["微信", "支付宝", "美团", "抖音", "京东"].some((channel) => (left.source.includes(channel) && `${right.payment} ${right.merchant}`.includes(channel)) || (right.source.includes(channel) && `${left.payment} ${left.merchant}`.includes(channel)));
  const bankBridge = (left.source === "银行卡" || right.source === "银行卡") && /微信|财付通|支付宝|美团|抖音|京东/.test(text);
  return sourceBridge || bankBridge;
}

function sameEconomicEvent(left: Transaction, right: Transaction) {
  if (left.kind !== right.kind || Math.abs(left.amount - right.amount) > 0.005) return false;
  if (left.orderId && right.orderId && left.orderId === right.orderId) return true;
  return left.source !== right.source && dateDistance(left.date, right.date) <= 2 && sourceLayer(left.source) !== sourceLayer(right.source) && channelRelated(left, right);
}

function possibleEconomicEvent(left: Transaction, right: Transaction) {
  return left.kind === right.kind && left.source !== right.source && sourceLayer(left.source) !== sourceLayer(right.source) && Math.abs(left.amount - right.amount) <= 0.005 && dateDistance(left.date, right.date) <= 1;
}

function mergeTransactions(current: Transaction, incoming: Transaction): Transaction {
  const evidence = [...(current.evidence ?? [evidenceFrom(current)]), ...(incoming.evidence ?? [evidenceFrom(incoming)])].filter((item, index, all) => all.findIndex((candidate) => rawEvidenceKey(candidate) === rawEvidenceKey(item)) === index);
  const currentLayer = sourceLayer(current.source);
  const incomingLayer = sourceLayer(incoming.source);
  const incomingIsBetterDescription = incomingLayer > 0 && (currentLayer === 0 || incomingLayer < currentLayer);
  return {
    ...current,
    merchant: incomingIsBetterDescription ? incoming.merchant : current.merchant,
    source: incomingIsBetterDescription ? incoming.source : current.source,
    payment: current.payment === current.source ? incoming.payment : current.payment,
    fundingAccount: current.fundingAccount === "未识别" ? incoming.fundingAccount : current.fundingAccount,
    category: current.category === "其他" ? incoming.category : current.category,
    orderId: current.orderId ?? incoming.orderId,
    note: current.note ?? incoming.note,
    evidence,
    counted: true,
    matchStatus: "linked",
    possibleMatchId: undefined,
  };
}

function buildImportPlan(existing: Transaction[], incoming: Transaction[]): ImportPlan {
  const transactions = existing.map(normalizeTransaction);
  const known = new Set(transactions.flatMap((item) => (item.evidence ?? []).map(rawEvidenceKey)));
  const preview: Transaction[] = [];
  let added = 0; let linked = 0; let excluded = 0; let review = 0; let skipped = 0;
  for (const raw of incoming) {
    const item = normalizeTransaction(raw);
    const evidence = item.evidence?.[0] ?? evidenceFrom(item);
    const key = rawEvidenceKey(evidence);
    if (known.has(key)) { skipped++; continue; }
    known.add(key);
    if (item.matchStatus === "review" && item.counted === false) {
      transactions.push(item); preview.push(item); review++; continue;
    }
    if (item.kind === "repayment" || item.kind === "transfer") {
      const excludedItem = { ...item, counted: false, matchStatus: "excluded" as MatchStatus };
      transactions.push(excludedItem); preview.push(excludedItem); excluded++; continue;
    }
    const exactIndex = transactions.findIndex((candidate) => candidate.counted !== false && sameEconomicEvent(candidate, item));
    if (exactIndex >= 0) {
      transactions[exactIndex] = mergeTransactions(transactions[exactIndex], item);
      preview.push({ ...item, counted: false, matchStatus: "linked" }); linked++; continue;
    }
    const possible = transactions.find((candidate) => candidate.counted !== false && possibleEconomicEvent(candidate, item));
    if (possible) {
      const reviewItem = { ...item, counted: false, matchStatus: "review" as MatchStatus, possibleMatchId: possible.id };
      transactions.push(reviewItem); preview.push(reviewItem); review++; continue;
    }
    transactions.push(item); preview.push(item); added++;
  }
  return { transactions, preview, imported: preview.length, added, linked, excluded, review, skipped };
}

function dailySpendLevel(amount: number) {
  if (amount <= 0) return "empty";
  if (amount < 50) return "low";
  if (amount < 200) return "regular";
  if (amount < 500) return "high";
  return "peak";
}

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function dateValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return dateValue(date);
}

function startOfCurrentMonth() {
  const now = new Date();
  return dateValue(new Date(now.getFullYear(), now.getMonth(), 1));
}

function rangeLabel(start: string, end: string) {
  if (start === end) {
    const date = parseDate(start);
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }
  const first = parseDate(start); const last = parseDate(end);
  const monthEnd = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  if (first.getDate() === 1 && last.getDate() === monthEnd && first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) return `${first.getFullYear()} 年 ${first.getMonth() + 1} 月`;
  if (first.getFullYear() === last.getFullYear()) return `${first.getMonth() + 1} 月 ${first.getDate()} 日 — ${last.getMonth() + 1} 月 ${last.getDate()} 日`;
  return `${start} — ${end}`;
}

function classify(merchant: string) {
  const text = merchant.toLowerCase();
  if (/餐|饭|咖啡|茶|外卖|食品|美团|饿了么/.test(text)) return "餐饮";
  if (/地铁|公交|滴滴|出行|打车|铁路|航空|加油/.test(text)) return "交通";
  if (/药|医院|诊所|医疗/.test(text)) return "医疗";
  if (/房租|物业|水费|电费|燃气/.test(text)) return "居住";
  if (/游戏|steam|playstation|xbox|任天堂|米哈游|腾讯游戏/.test(text)) return "游戏";
  if (/会员|电影|抖音|音乐|演出/.test(text)) return "娱乐";
  if (/日用|便利店|洗衣|理发|清洁|快递/.test(text)) return "生活";
  if (/书|课程|教育|培训/.test(text)) return "学习";
  if (/超市|商城|淘宝|京东|拼多多|商店/.test(text)) return "购物";
  return "其他";
}

function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = { home: "⌂", list: "≡", link: "⇄", chart: "⌁", settings: "⚙", plus: "+", lock: "●", upload: "↥", back: "‹", next: "›", wallet: "◒", close: "×", download: "↓" };
  return <span aria-hidden="true">{icons[name] ?? "·"}</span>;
}

export default function KoinApp() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [rangeStart, setRangeStart] = useState(startOfCurrentMonth());
  const [rangeEnd, setRangeEnd] = useState(dateValue());
  const [periodOpen, setPeriodOpen] = useState(false);
  const [view, setView] = useState<"overview" | "records" | "reconcile" | "insights" | "settings">("overview");
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [draftAmount, setDraftAmount] = useState<number | undefined>();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      const parsed: Transaction[] = saved ? JSON.parse(saved) : [];
      setTransactions(parsed.filter((item) => !item.id.startsWith("demo-")).map((item) => normalizeTransaction({ ...item, note: cleanImportedNote(item.note) })));
    } catch {
      setTransactions([]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORE_KEY, JSON.stringify(transactions));
  }, [transactions, loaded]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visible = useMemo(() => transactions.filter((item) => item.date >= rangeStart && item.date <= rangeEnd), [transactions, rangeStart, rangeEnd]);
  const expenses = visible.filter((item) => item.kind === "expense" && item.counted !== false);
  const refunds = visible.filter((item) => item.kind === "refund" && item.counted !== false);
  const total = Math.max(0, expenses.reduce((sum, item) => sum + item.amount, 0) - refunds.reduce((sum, item) => sum + item.amount, 0));
  const categoryTotals = useMemo(() => CATEGORIES.map((category) => ({ category, amount: expenses.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount, 0) })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount), [expenses]);
  const daily = useMemo(() => {
    const result: { date: string; amount: number }[] = [];
    for (let date = rangeStart; date <= rangeEnd && result.length < 370; date = addDays(date, 1)) result.push({ date, amount: expenses.filter((item) => item.date === date).reduce((sum, item) => sum + item.amount, 0) });
    return result;
  }, [expenses, rangeStart, rangeEnd]);
  const maxDaily = Math.max(...daily.map((item) => item.amount), 1);

  function shiftPeriod(delta: number) {
    const days = Math.round((parseDate(rangeEnd).getTime() - parseDate(rangeStart).getTime()) / 86400000) + 1;
    setRangeStart(addDays(rangeStart, days * delta));
    setRangeEnd(addDays(rangeEnd, days * delta));
  }

  function saveTransaction(item: Transaction) {
    const normalized = normalizeTransaction(item);
    setTransactions((current) => editing ? current.map((old) => old.id === item.id ? normalized : old) : [normalized, ...current]);
    setEditorOpen(false);
    setEditing(null);
    setToast(editing ? "记录已更新" : "已记入本月消费");
  }

  function moveTransactionToCategory(id: string, category: string) {
    setTransactions((current) => current.map((item) => item.id === id ? { ...item, category } : item));
    setToast(`已移入“${category}”分区`);
  }

  function openEditor(item?: Transaction, amount?: number) {
    setEditing(item ?? null);
    setDraftAmount(amount);
    setEditorOpen(true);
  }

  function removeTransaction(id: string) {
    setTransactions((current) => current.filter((item) => item.id !== id));
    setEditorOpen(false);
    setEditing(null);
    setToast("记录已删除");
  }

  function completeImport(plan: ImportPlan) {
    setTransactions(plan.transactions);
    setImportOpen(false);
    setToast(`已读取 ${plan.imported} 条流水，关联 ${plan.linked} 条，待确认 ${plan.review} 条`);
  }

  function confirmMatch(candidateId: string) {
    setTransactions((current) => {
      const candidate = current.find((item) => item.id === candidateId);
      if (!candidate?.possibleMatchId) return current;
      const targetIndex = current.findIndex((item) => item.id === candidate.possibleMatchId);
      if (targetIndex < 0) return current;
      const next = current.filter((item) => item.id !== candidateId);
      const adjustedIndex = next.findIndex((item) => item.id === current[targetIndex].id);
      next[adjustedIndex] = mergeTransactions(next[adjustedIndex], { ...candidate, counted: true, matchStatus: "single", possibleMatchId: undefined });
      return next;
    });
    setToast("两条流水已合并为一笔消费");
  }

  function keepSeparate(candidateId: string) {
    setTransactions((current) => current.map((item) => item.id === candidateId ? { ...item, counted: true, matchStatus: "single", possibleMatchId: undefined } : item));
    setToast("已保留为两笔独立记录");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">K</span><span>Koin</span></div>
        <nav aria-label="主导航">
          <NavItem active={view === "overview"} icon="home" label="本月" onClick={() => setView("overview")} />
          <NavItem active={view === "records"} icon="list" label="明细" onClick={() => setView("records")} />
          <NavItem active={view === "reconcile"} icon="link" label="对账" onClick={() => setView("reconcile")} />
          <NavItem active={view === "insights"} icon="chart" label="分析" onClick={() => setView("insights")} />
          <NavItem active={view === "settings"} icon="settings" label="数据" onClick={() => setView("settings")} />
        </nav>
        <div className="local-note"><Icon name="lock" /><div><strong>仅保存在本机</strong><span>账单不会上传</span></div></div>
      </aside>

      <main>
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">K</span><span>Koin</span></div>
          <div className="month-switcher">
            <button onClick={() => shiftPeriod(-1)} aria-label="上一个账期"><Icon name="back" /></button>
            <button className="period-trigger" onClick={() => setPeriodOpen((open) => !open)} aria-expanded={periodOpen}><span className="eyebrow">当前账期</span><span>{rangeLabel(rangeStart, rangeEnd)}</span><small>▾</small></button>
            <button onClick={() => shiftPeriod(1)} aria-label="下一个账期"><Icon name="next" /></button>
            {periodOpen && <PeriodPicker start={rangeStart} end={rangeEnd} onApply={(start, end) => { setRangeStart(start); setRangeEnd(end); setPeriodOpen(false); }} onClose={() => setPeriodOpen(false)} />}
          </div>
          <div className="top-actions"><button className="secondary" onClick={() => setImportOpen(true)}><Icon name="upload" /> 导入账单</button><button className="primary" onClick={() => openEditor()}><Icon name="plus" /> 记一笔</button></div>
        </header>

        <section className="content">
          {view === "overview" && <>
            <section className="hero-card">
              <div><span className="eyebrow">所选期间实际消费</span><h1><small>¥</small>{money(total)}</h1><p>共 {expenses.length} 笔消费{refunds.length ? `，含 ${refunds.length} 笔退款` : ""}</p></div>
              <div className="hero-stamp"><Icon name="wallet" /><span>花呗消费正常计入</span><small>还款不会重复统计</small></div>
            </section>

            {transactions.length === 0 ? <EmptyState onImport={() => setImportOpen(true)} onAdd={() => openEditor()} /> : <>
              <div className="dashboard-grid">
                <section className="panel trend-panel"><PanelTitle title="每日消费" subtitle="颜色越暖，当日消费越高" /><div className="spend-legend" aria-label="每日消费颜色分级"><span><i className="low" />¥1–49</span><span><i className="regular" />¥50–199</span><span><i className="high" />¥200–499</span><span><i className="peak" />¥500+</span></div><div className="bars" aria-label="每日消费柱状图">{daily.map((item) => <div className="bar-slot" key={item.date} title={`${item.date}：¥${money(item.amount)}`}><span className={`bar ${dailySpendLevel(item.amount)}`} style={{ height: `${Math.max(item.amount ? 8 : 2, item.amount / maxDaily * 100)}%` }} /></div>)}</div><div className="axis"><span>{rangeStart.slice(5)}</span><span>{daily[Math.floor(daily.length / 2)]?.date.slice(5) ?? ""}</span><span>{rangeEnd.slice(5)}</span></div></section>
                <section className="panel category-panel"><PanelTitle title="消费分类" subtitle="按订单用途统计" /><CategoryRing items={categoryTotals} total={total} /></section>
              </div>
              <CategoryOrganizer items={expenses} onMove={moveTransactionToCategory} onOpen={openEditor} />
              <RecordsPanel items={visible} onOpen={openEditor} limit={6} />
            </>}
          </>}

          {view === "records" && <RecordsPanel items={visible} onOpen={openEditor} />}
          {view === "reconcile" && <ReconciliationView transactions={transactions} onConfirm={confirmMatch} onSeparate={keepSeparate} />}
          {view === "insights" && <Insights total={total} items={categoryTotals} expenses={expenses} rangeStart={rangeStart} rangeEnd={rangeEnd} />}
          {view === "settings" && <DataSettings transactions={transactions} onImport={() => setImportOpen(true)} onExport={() => setExportOpen(true)} onClear={() => { setTransactions([]); setToast("本机账本已清空"); }} />}
        </section>
      </main>

      <aside className={calculatorOpen ? "calculator-drawer open" : "calculator-drawer"} aria-label="右侧记账工具">
        <button className="calculator-drawer-toggle" onClick={() => setCalculatorOpen((open) => !open)} aria-expanded={calculatorOpen} aria-label={calculatorOpen ? "收起计算器" : "展开计算器"}><span className="calculator-glyph" aria-hidden="true"><i>12</i><i>••••</i></span><em>计算器</em><b>{calculatorOpen ? "›" : "‹"}</b></button>
        {calculatorOpen && <div className="calculator-drawer-body"><div className="calculator-drawer-title"><span>快速计算</span><small>结果可直接记账</small></div><Calculator compact onUse={(amount) => openEditor(undefined, amount)} /></div>}
      </aside>

      <nav className="mobile-nav" aria-label="移动端导航">
        <NavItem active={view === "overview"} icon="home" label="本月" onClick={() => setView("overview")} />
        <NavItem active={view === "records"} icon="list" label="明细" onClick={() => setView("records")} />
        <NavItem active={view === "reconcile"} icon="link" label="对账" onClick={() => setView("reconcile")} />
        <button className="mobile-add" onClick={() => openEditor()} aria-label="记一笔"><Icon name="plus" /></button>
        <NavItem active={view === "insights"} icon="chart" label="分析" onClick={() => setView("insights")} />
        <NavItem active={view === "settings"} icon="settings" label="数据" onClick={() => setView("settings")} />
      </nav>

      {editorOpen && <TransactionEditor initial={editing} initialAmount={draftAmount} onClose={() => { setEditorOpen(false); setEditing(null); setDraftAmount(undefined); }} onSave={saveTransaction} onDelete={editing ? () => removeTransaction(editing.id) : undefined} />}
      {importOpen && <ImportDialog existing={transactions} onClose={() => setImportOpen(false)} onComplete={completeImport} />}
      {exportOpen && <ExportDialog transactions={transactions} selectedStart={rangeStart} selectedEnd={rangeEnd} onClose={() => setExportOpen(false)} onExported={(count) => { setExportOpen(false); setToast(`已导出 ${count} 条记录`); }} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}><Icon name={icon} /><span>{label}</span></button>;
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="panel-title"><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function PeriodPicker({ start, end, onApply, onClose }: { start: string; end: string; onApply: (start: string, end: string) => void; onClose: () => void }) {
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const [calendarMonth, setCalendarMonth] = useState(monthValue(parseDate(end)));
  const [selectingEnd, setSelectingEnd] = useState(false);
  const today = dateValue();
  const weekDay = new Date().getDay() || 7;
  const thisMonday = addDays(today, 1 - weekDay);
  const first = parseDate(`${calendarMonth}-01`);
  const leading = (first.getDay() || 7) - 1;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: leading + daysInMonth }, (_, index) => index < leading ? null : `${calendarMonth}-${String(index - leading + 1).padStart(2, "0")}`);

  function quick(kind: "7" | "30" | "week" | "month") {
    if (kind === "7") onApply(addDays(today, -6), today);
    if (kind === "30") onApply(addDays(today, -29), today);
    if (kind === "week") onApply(thisMonday, addDays(thisMonday, 6));
    if (kind === "month") { const current = monthValue(); onApply(`${current}-01`, today); }
  }
  function chooseDate(date: string) {
    if (!selectingEnd) { setDraftStart(date); setDraftEnd(date); setSelectingEnd(true); }
    else { setDraftStart(date < draftStart ? date : draftStart); setDraftEnd(date < draftStart ? draftStart : date); setSelectingEnd(false); }
  }
  function shiftCalendar(delta: number) { setCalendarMonth(monthValue(new Date(first.getFullYear(), first.getMonth() + delta, 1))); }

  return <div className="period-popover" role="dialog" aria-label="选择账期"><div className="period-shortcuts"><strong>快捷选择</strong><button onClick={() => quick("7")}>近 7 天</button><button onClick={() => quick("30")}>近 30 天</button><button onClick={() => quick("week")}>本周</button><button onClick={() => quick("month")}>本月</button></div><div className="period-calendar"><div className="calendar-head"><button onClick={() => shiftCalendar(-1)} aria-label="上个月">‹</button><strong>{monthLabel(calendarMonth)}</strong><button onClick={() => shiftCalendar(1)} aria-label="下个月">›</button></div><div className="weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map((date, index) => date ? <button key={date} className={`${date >= draftStart && date <= draftEnd ? "in-range" : ""} ${date === draftStart || date === draftEnd ? "edge" : ""} ${date === today ? "today" : ""}`} onClick={() => chooseDate(date)}>{Number(date.slice(8))}</button> : <span key={`empty-${index}`} />)}</div><div className="period-selection"><span>{selectingEnd ? "请选择结束日期" : draftStart === draftEnd ? "已选择一天" : "已选择日期范围"}</span><strong>{rangeLabel(draftStart, draftEnd)}</strong></div><div className="period-actions"><button onClick={onClose}>取消</button><button className="apply" onClick={() => onApply(draftStart, draftEnd)}>应用账期</button></div></div></div>;
}

function EmptyState({ onImport, onAdd }: { onImport: () => void; onAdd: () => void }) {
  return <section className="empty-state"><div className="empty-coin">¥</div><h2>从第一笔消费开始</h2><p>导入微信或支付宝账单，Koin 会自动排除还款和转账；也可以先手动记一笔。</p><div><button className="primary" onClick={onImport}>导入账单</button><button className="secondary" onClick={onAdd}>手动记账</button></div></section>;
}

function CategoryRing({ items, total }: { items: { category: string; amount: number }[]; total: number }) {
  if (!items.length) return <div className="small-empty">本月还没有分类数据</div>;
  let cursor = 0;
  const stops = items.map((item) => { const start = cursor; cursor += item.amount / Math.max(total, 1) * 100; return `${CATEGORY_COLORS[item.category]} ${start}% ${cursor}%`; }).join(",");
  return <div className="category-content"><div className="donut" style={{ background: `conic-gradient(${stops})` }}><div><span>最高分类</span><strong>{items[0].category}</strong></div></div><div className="legend">{items.slice(0, 4).map((item) => <div key={item.category}><span className="dot" style={{ background: CATEGORY_COLORS[item.category] }} /><span>{item.category}</span><strong>¥{money(item.amount)}</strong></div>)}</div></div>;
}

function CategoryOrganizer({ items, onMove, onOpen }: { items: Transaction[]; onMove: (id: string, category: string) => void; onOpen: (item: Transaction) => void }) {
  const categoriesWithItems = CATEGORIES.filter((category) => items.some((item) => item.category === category));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(categoriesWithItems.slice(0, 3)));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const groups = useMemo(() => CATEGORIES.map((category) => {
    const records = items.filter((item) => item.category === category).sort((a, b) => b.date.localeCompare(a.date));
    return { category, records, total: records.reduce((sum, item) => sum + item.amount, 0) };
  }), [items]);

  function toggle(category: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  }

  function drop(event: DragEvent<HTMLElement>, category: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    if (id) onMove(id, category);
    setExpanded((current) => new Set(current).add(category));
    setDraggingId(null);
    setDropTarget(null);
  }

  return <section className="panel category-organizer">
    <div className="organizer-heading"><div><h2>消费分区</h2><p>拖动账目到其他分区；手机上可直接选择分类</p></div><span>共 {items.length} 笔消费</span></div>
    <div className="category-board">
      {groups.map(({ category, records, total }) => {
        const open = expanded.has(category);
        return <section
          className={`category-bucket${dropTarget === category ? " drop-target" : ""}`}
          key={category}
          onDragEnter={(event) => { event.preventDefault(); setDropTarget(category); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(category); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); }}
          onDrop={(event) => drop(event, category)}
        >
          <button className="bucket-toggle" onClick={() => toggle(category)} aria-expanded={open}>
            <span className="bucket-color" style={{ background: CATEGORY_COLORS[category] }} />
            <span><strong>{category}</strong><small>{records.length} 笔</small></span>
            <b>¥{money(total)}</b>
            <i aria-hidden="true">{open ? "⌃" : "⌄"}</i>
          </button>
          {open && <div className="bucket-records">
            {records.length ? records.map((item) => {
              const display = transactionDisplay(item);
              return <article
              className={`bucket-record${draggingId === item.id ? " dragging" : ""}`}
              draggable
              key={item.id}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setDraggingId(item.id); }}
              onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
            >
              <span className="drag-handle" title="拖动到其他分区" aria-hidden="true">⠿</span>
              <button className="bucket-record-main" onClick={() => onOpen(item)}><strong>{display.primary}</strong><small>{display.merchant ? `商家：${display.merchant} · ` : ""}{Number(item.date.slice(5, 7))} 月 {Number(item.date.slice(8, 10))} 日 · {item.source}</small></button>
              <b className="bucket-amount">¥{money(item.amount)}</b>
              <label><span className="sr-only">将 {display.primary} 移动到分类</span><select aria-label={`将 ${display.primary} 移动到分类`} value={item.category} onChange={(event) => onMove(item.id, event.target.value)}>{CATEGORIES.map((option) => <option key={option}>{option}</option>)}</select></label>
            </article>;
            }) : <div className="bucket-empty">拖到这里即可归类</div>}
          </div>}
        </section>;
      })}
    </div>
  </section>;
}

function RecordsPanel({ items, onOpen, limit }: { items: Transaction[]; onOpen: (item: Transaction) => void; limit?: number }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [category, setCategory] = useState("all");
  const [source, setSource] = useState("all");
  const categories = useMemo(() => [...new Set(items.map((item) => item.category))].sort(), [items]);
  const sources = useMemo(() => [...new Set(items.map((item) => item.source))].sort(), [items]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items.filter((item) => {
      const searchable = [item.merchant, item.note, item.payment, item.source, item.fundingAccount, item.orderId].filter(Boolean).join(" ").toLowerCase();
      return (!keyword || searchable.includes(keyword))
        && (kind === "all" || item.kind === kind)
        && (category === "all" || item.category === category)
        && (source === "all" || item.source === source);
    });
  }, [items, query, kind, category, source]);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  const totalExpense = filtered.filter((item) => item.kind === "expense" && item.counted !== false).reduce((sum, item) => sum + item.amount, 0);
  const totalIncome = filtered.filter((item) => (item.kind === "income" || item.kind === "refund") && item.counted !== false).reduce((sum, item) => sum + item.amount, 0);
  const filtering = Boolean(query || kind !== "all" || category !== "all" || source !== "all");
  const resetFilters = () => { setQuery(""); setKind("all"); setCategory("all"); setSource("all"); };

  return <section className="panel records-panel">
    <PanelTitle title="消费明细" subtitle={items.length ? `所选账期共 ${items.length} 条记录` : "所选账期还没有记录"} />
    <div className="records-summary" aria-label="明细收支汇总">
      <div><span>总支出</span><strong className="summary-expense">− ¥{money(totalExpense)}</strong></div>
      <div><span>总收入 <small>含退款</small></span><strong className="summary-income">+ ¥{money(totalIncome)}</strong></div>
    </div>
    {items.length > 0 && <div className="record-filters">
      <label className="record-search"><span className="sr-only">搜索明细</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品、商家或订单号" /></label>
      <label><span className="sr-only">收支类型</span><select value={kind} onChange={(event) => setKind(event.target.value as Kind | "all")}><option value="all">全部收支</option><option value="expense">支出</option><option value="income">收入</option><option value="refund">退款</option><option value="repayment">还款</option><option value="transfer">转账/不计</option></select></label>
      <label><span className="sr-only">消费分类</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">全部分类</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span className="sr-only">账目来源</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部来源</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
      {filtering && <button className="clear-filters" onClick={resetFilters}>清除筛选</button>}
    </div>}
    {filtering && <div className="filter-result">筛选到 {filtered.length} 条记录</div>}
    {sorted.length ? <div className="records">{sorted.map((item) => {
      const display = transactionDisplay(item);
      const amountClass = item.counted === false ? "amount not-counted" : item.kind === "refund" || item.kind === "income" ? "amount positive" : "amount";
      return <button className="record" key={item.id} onClick={() => onOpen(item)}><span className="category-icon" style={{ background: `${CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.其他}22`, color: CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.其他 }}>{item.category.slice(0, 1)}</span><span className="record-main"><strong>{display.primary}{item.matchStatus === "review" ? <em className="review-tag">待确认</em> : null}</strong><small>{display.merchant ? `商家：${display.merchant} · ` : ""}{Number(item.date.slice(5, 7))} 月 {Number(item.date.slice(8, 10))} 日 · {item.payment} · {item.source} · {item.fundingAccount ?? "未识别"}{display.note ? ` · ${display.note}` : ""}</small></span><span className={amountClass}>{item.kind === "refund" || item.kind === "income" ? "+" : "−"} ¥{money(item.amount)}</span></button>;
    })}</div> : <div className="small-empty">{filtering ? "没有符合筛选条件的记录" : "所选账期还没有记录"}</div>}
  </section>;
}

function Insights({ total, items, expenses, rangeStart, rangeEnd }: { total: number; items: { category: string; amount: number }[]; expenses: Transaction[]; rangeStart: string; rangeEnd: string }) {
  const days = Math.round((parseDate(rangeEnd).getTime() - parseDate(rangeStart).getTime()) / 86400000) + 1;
  return <section className="insights-view"><div className="view-heading"><span className="eyebrow">消费分析</span><h1>{rangeLabel(rangeStart, rangeEnd)}</h1><p>只统计真实消费，不包含花呗还款与账户互转。</p></div><div className="stat-row"><div><span>日均消费</span><strong>¥{money(total / Math.max(days, 1))}</strong></div><div><span>单笔平均</span><strong>¥{money(total / Math.max(expenses.length, 1))}</strong></div><div><span>消费笔数</span><strong>{expenses.length} 笔</strong></div></div><section className="panel insight-list"><PanelTitle title="分类排行" subtitle="金额由高到低" />{items.length ? items.map((item) => <div className="rank" key={item.category}><span className="dot" style={{ background: CATEGORY_COLORS[item.category] }} /><strong>{item.category}</strong><div><span style={{ width: `${item.amount / Math.max(items[0].amount, 1) * 100}%`, background: CATEGORY_COLORS[item.category] }} /></div><b>¥{money(item.amount)}</b></div>) : <div className="small-empty">导入账单后，这里会生成消费分析</div>}</section></section>;
}

function ReconciliationView({ transactions, onConfirm, onSeparate }: { transactions: Transaction[]; onConfirm: (id: string) => void; onSeparate: (id: string) => void }) {
  const pending = transactions.filter((item) => item.matchStatus === "review" && item.possibleMatchId);
  const linked = transactions.filter((item) => (item.evidence?.length ?? 0) > 1);
  const excluded = transactions.filter((item) => item.kind === "repayment" || item.kind === "transfer");
  const byId = new Map(transactions.map((item) => [item.id, item]));
  return <section className="reconcile-view">
    <div className="view-heading"><span className="eyebrow">统一对账</span><h1>一笔消费，只统计一次</h1><p>订单、支付和银行卡流水都会保留；能够确认的记录会归入同一消费组。</p></div>
    <div className="reconcile-stats">
      <div><span>已关联消费</span><strong>{linked.length} 组</strong></div>
      <div><span>排除还款/转账</span><strong>{excluded.length} 条</strong></div>
      <div className={pending.length ? "needs-review" : ""}><span>等待确认</span><strong>{pending.length} 组</strong></div>
    </div>

    <section className="panel review-panel">
      <PanelTitle title="等待确认" subtitle="金额和时间相近，但缺少足够的共同编号" />
      {pending.length ? <div className="review-list">{pending.map((candidate) => {
        const target = byId.get(candidate.possibleMatchId!);
        if (!target) return null;
        return <article className="review-card" key={candidate.id}>
          <div className="review-pair"><EvidenceSummary item={target} label="已存在" /><span className="review-link">可能是同一笔</span><EvidenceSummary item={candidate} label="新流水" /></div>
          <div className="review-actions"><button className="secondary" onClick={() => onSeparate(candidate.id)}>保留为两笔</button><button className="primary" onClick={() => onConfirm(candidate.id)}>合并，只统计一次</button></div>
        </article>;
      })}</div> : <div className="reconcile-empty">✓ 暂无需要确认的疑似重复流水</div>}
    </section>

    <section className="panel linked-panel">
      <PanelTitle title="已关联的消费" subtitle="展开后可以查看订单、支付渠道与资金账户凭证" />
      {linked.length ? <div className="linked-groups">{linked.slice(0, 30).map((item) => { const display = transactionDisplay(item); return <details key={item.id}><summary><span><strong>{display.primary}</strong><small>{display.merchant ? `商家：${display.merchant} · ` : ""}{item.date} · {item.source} · {item.payment}</small></span><b>¥{money(item.amount)}</b><em>{item.evidence?.length} 条凭证</em></summary><div className="evidence-list">{item.evidence?.map((evidence) => <div key={evidence.id}><span>{evidence.source}</span><p><strong>{evidence.merchant}</strong><small>{evidence.date} · {evidence.payment} · {evidence.fundingAccount}</small></p><b>¥{money(evidence.amount)}</b></div>)}</div></details>; })}</div> : <div className="small-empty">继续导入不同平台账单后，这里会显示自动关联结果</div>}
    </section>

    <section className="panel excluded-panel">
      <PanelTitle title="不计入消费" subtitle="还款、转账、提现和账户互转会保留，但不会重复计算" />
      {excluded.length ? <div className="excluded-list">{excluded.slice(0, 30).map((item) => <div key={item.id}><span>{kindLabel(item.kind)}</span><p><strong>{item.merchant}</strong><small>{item.date} · {item.source} · {item.fundingAccount}</small></p><b>¥{money(item.amount)}</b></div>)}</div> : <div className="small-empty">目前没有被排除的还款或转账记录</div>}
    </section>
  </section>;
}

function EvidenceSummary({ item, label }: { item: Transaction; label: string }) {
  const display = transactionDisplay(item);
  return <div className="evidence-summary"><span>{label} · {item.source}</span><strong>{display.primary}</strong><small>{display.merchant ? `商家：${display.merchant} · ` : ""}{item.date} · {item.payment} · {item.fundingAccount}{display.note ? ` · ${display.note}` : ""}</small><b>¥{money(item.amount)}</b></div>;
}

function DataSettings({ transactions, onImport, onExport, onClear }: { transactions: Transaction[]; onImport: () => void; onExport: () => void; onClear: () => void }) {
  function backup() {
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), transactions }, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Koin-backup-${localDate(1).slice(0, 7)}.json`; link.click(); URL.revokeObjectURL(link.href);
  }
  return <section className="settings-view"><div className="view-heading"><span className="eyebrow">本机数据</span><h1>你的账本，只属于你</h1><p>Koin 不需要账号，账单解析和保存都在当前浏览器完成。</p></div><div className="settings-grid"><button className="setting-card" onClick={onImport}><span className="setting-icon"><Icon name="upload" /></span><div><strong>导入账单</strong><small>微信、支付宝、月付和银行卡账单</small></div><Icon name="next" /></button><button className="setting-card" onClick={onExport}><span className="setting-icon"><Icon name="download" /></span><div><strong>导出期间账单</strong><small>按本周、本月或自定义日期导出 CSV</small></div><Icon name="next" /></button><button className="setting-card" onClick={backup}><span className="setting-icon"><Icon name="download" /></span><div><strong>导出完整备份</strong><small>保存 {transactions.length} 条记录为可恢复的 JSON</small></div><Icon name="next" /></button><button className="setting-card danger" onClick={() => { if (confirm("确定清空当前浏览器中的所有 Koin 记录吗？此操作无法撤销。")) onClear(); }}><span className="setting-icon"><Icon name="close" /></span><div><strong>清空本机账本</strong><small>删除当前浏览器中的全部记录</small></div><Icon name="next" /></button></div><div className="privacy-card"><span><Icon name="lock" /></span><div><strong>本地优先</strong><p>关闭页面后数据仍会保留，但清理浏览器数据可能导致丢失。建议定期导出备份。</p></div></div></section>;
}

function TransactionEditor({ initial, initialAmount, onClose, onSave, onDelete }: { initial: Transaction | null; initialAmount?: number; onClose: () => void; onSave: (item: Transaction) => void; onDelete?: () => void }) {
  const [form, setForm] = useState<Transaction>(initial ?? { id: crypto.randomUUID(), date: localDate(new Date().getDate()), merchant: "", amount: initialAmount ?? 0, category: "餐饮", payment: "支付宝", fundingAccount: "未识别", source: "手动", kind: "expense", counted: true, matchStatus: "single", note: "" });
  const [mobileCalculator, setMobileCalculator] = useState(false);
  function change(field: keyof Transaction, value: string | number) { setForm((current) => ({ ...current, [field]: value })); }
  function submit(event: FormEvent) { event.preventDefault(); if (!form.merchant.trim() || form.amount <= 0) return; const excluded = form.kind === "repayment" || form.kind === "transfer"; onSave({ ...form, merchant: form.merchant.trim(), amount: Number(form.amount), counted: !excluded, matchStatus: excluded ? "excluded" : form.matchStatus === "review" ? "single" : form.matchStatus }); }
  return <Modal title={initial ? "编辑记录" : "记一笔"} onClose={onClose}><form className="transaction-form" onSubmit={submit}><label className="amount-field"><span>金额</span><div><b>¥</b><input autoFocus type="number" min="0.01" step="0.01" value={form.amount || ""} onChange={(event) => change("amount", Number(event.target.value))} placeholder="0.00" required /></div></label><button type="button" className="inline-calculator-toggle" onClick={() => setMobileCalculator((open) => !open)}>⌗ {mobileCalculator ? "收起计算器" : "计算金额"}</button>{mobileCalculator && <div className="inline-calculator"><Calculator onUse={(amount) => { change("amount", amount); setMobileCalculator(false); }} /></div>}<div className="kind-tabs">{([ ["expense", "支出"], ["refund", "退款"], ["income", "收入"], ["repayment", "还款"], ["transfer", "转账/不计"] ] as [Kind, string][]).map(([value, label]) => <button type="button" className={form.kind === value ? "active" : ""} key={value} onClick={() => change("kind", value)}>{label}</button>)}</div><label><span>商家</span><input value={form.merchant} onChange={(event) => change("merchant", event.target.value)} placeholder="例如：午间食堂" required /></label><div className="field-row"><label><span>日期</span><input type="date" value={form.date} onChange={(event) => change("date", event.target.value)} required /></label><label><span>分类</span><select value={form.category} onChange={(event) => change("category", event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="field-row"><label><span>账目来源</span><select value={form.source} onChange={(event) => change("source", event.target.value)}>{["手动", "微信", "支付宝", "抖音", "抖音月付", "美团", "美团月付", "京东", "淘宝", "银行卡", "其他"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>支付渠道</span><select value={form.payment} onChange={(event) => change("payment", event.target.value)}>{["支付宝", "微信支付", "银行卡", "美团月付", "抖音月付", "京东白条", "现金", "其他"].map((item) => <option key={item}>{item}</option>)}</select></label></div><label><span>资金账户</span><select value={form.fundingAccount ?? "未识别"} onChange={(event) => change("fundingAccount", event.target.value)}>{["未识别", "微信零钱", "支付宝余额", "银行卡", "花呗", "京东白条", "美团月付", "抖音月付", "现金", "其他"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>商品 / 用途</span><input value={form.note ?? ""} onChange={(event) => change("note", event.target.value)} placeholder="有内容时优先显示" /></label><div className="source-help">账目来源是订单在哪里产生，支付渠道是通过哪里付款，资金账户是最终从哪里出钱。月付、花呗、白条消费发生时计入，之后还款不重复计算。</div><div className="form-actions">{onDelete && <button type="button" className="delete-button" onClick={onDelete}>删除</button>}<button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" type="submit">保存记录</button></div></form></Modal>;
}

function Calculator({ compact = false, onUse }: { compact?: boolean; onUse: (amount: number) => void }) {
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const number = Number(display) || 0;

  function calculate(left: number, right: number, op: string) {
    if (op === "+") return left + right;
    if (op === "−") return left - right;
    if (op === "×") return left * right;
    return right === 0 ? left : left / right;
  }
  function digit(value: string) {
    setDisplay((current) => replace ? value : current === "0" ? value : current.length < 12 ? current + value : current);
    setReplace(false);
  }
  function decimal() {
    setDisplay((current) => replace ? "0." : current.includes(".") ? current : `${current}.`);
    setReplace(false);
  }
  function chooseOperator(next: string) {
    if (stored !== null && operator && !replace) { const result = calculate(stored, number, operator); setStored(result); setDisplay(String(Number(result.toFixed(8)))); }
    else setStored(number);
    setOperator(next); setReplace(true);
  }
  function equals() {
    if (stored === null || !operator) return;
    const result = calculate(stored, number, operator);
    setDisplay(String(Number(result.toFixed(8)))); setStored(null); setOperator(null); setReplace(true);
  }
  function clear() { setDisplay("0"); setStored(null); setOperator(null); setReplace(true); }
  function keyDown(event: React.KeyboardEvent) {
    if (/^[0-9]$/.test(event.key)) digit(event.key);
    else if (event.key === ".") decimal();
    else if (["+", "-", "*", "/"].includes(event.key)) chooseOperator({ "+": "+", "-": "−", "*": "×", "/": "÷" }[event.key]!);
    else if (event.key === "Enter" || event.key === "=") equals();
    else if (event.key === "Escape") clear();
    else return;
    event.preventDefault();
  }
  const keys = ["C", "±", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ".", "="];
  function press(key: string) {
    if (/^\d$/.test(key)) digit(key);
    else if (key === ".") decimal();
    else if (["+", "−", "×", "÷"].includes(key)) chooseOperator(key);
    else if (key === "=") equals();
    else if (key === "C") clear();
    else if (key === "±") setDisplay(String(number * -1));
    else if (key === "%") { setDisplay(String(Number((number / 100).toFixed(8)))); setReplace(true); }
  }
  return <section className={compact ? "calculator compact" : "calculator"} tabIndex={0} onKeyDown={keyDown} aria-label="记账计算器"><div className="calculator-screen"><small>{stored !== null && operator ? `${stored} ${operator}` : "金额计算"}</small><strong>{display}</strong></div><div className="calculator-keys">{keys.map((key) => <button type="button" key={key} className={`${["+", "−", "×", "÷"].includes(key) ? "operator" : ""} ${key === "0" ? "zero" : ""} ${key === "=" ? "equals" : ""}`} onClick={() => press(key)}>{key}</button>)}</div><button type="button" className="calculator-use" disabled={number <= 0} onClick={() => onUse(Number(number.toFixed(2)))}>用 ¥{money(number)} 记一笔</button></section>;
}

function ExportDialog({ transactions, selectedStart, selectedEnd, onClose, onExported }: { transactions: Transaction[]; selectedStart: string; selectedEnd: string; onClose: () => void; onExported: (count: number) => void }) {
  const today = new Date();
  const day = today.getDay() || 7;
  const monday = new Date(today); monday.setDate(today.getDate() - day + 1);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const selectedMonth = selectedStart.slice(0, 7);
  const monthLast = new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate();
  const [range, setRange] = useState<"week" | "month" | "custom">("custom");
  const [start, setStart] = useState(selectedStart);
  const [end, setEnd] = useState(selectedEnd);

  function dateString(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function choose(value: "week" | "month" | "custom") {
    setRange(value);
    if (value === "week") { setStart(dateString(monday)); setEnd(dateString(sunday)); }
    if (value === "month") { setStart(`${selectedMonth}-01`); setEnd(`${selectedMonth}-${String(monthLast).padStart(2, "0")}`); }
  }
  const selected = transactions.filter((item) => item.date >= start && item.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  const expense = selected.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amount, 0);
  const refund = selected.filter((item) => item.kind === "refund").reduce((sum, item) => sum + item.amount, 0);

  function exportCsv() {
    const kindLabels: Record<Kind, string> = { expense: "支出", refund: "退款", income: "收入", repayment: "还款", transfer: "转账/不计消费" };
    const escape = (value: string | number | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const headers = ["日期", "类型", "商家/用途", "金额（元）", "分类", "账目来源", "支付渠道", "资金账户", "是否计入消费", "关联凭证数", "订单号", "备注"];
    const rows = selected.map((item) => [item.date, kindLabels[item.kind], item.merchant, item.amount.toFixed(2), item.category, item.source, item.payment, item.fundingAccount, item.counted === false ? "否" : "是", item.evidence?.length ?? 1, item.orderId, item.note].map(escape).join(","));
    const summary = [`导出期间,${escape(`${start} 至 ${end}`)}`, `实际消费合计,${escape((expense - refund).toFixed(2))}`, ""];
    const blob = new Blob(["\uFEFF", [...summary, headers.map(escape).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Koin账单_${start}_${end}.csv`; link.click(); URL.revokeObjectURL(link.href); onExported(selected.length);
  }

  return <Modal title="导出期间账单" onClose={onClose}><div className="export-dialog"><div className="range-tabs"><button className={range === "week" ? "active" : ""} onClick={() => choose("week")}>本周</button><button className={range === "month" ? "active" : ""} onClick={() => choose("month")}>当前月份</button><button className={range === "custom" ? "active" : ""} onClick={() => choose("custom")}>自定义</button></div><div className="export-dates"><label><span>开始日期</span><input type="date" value={start} onChange={(event) => { setRange("custom"); setStart(event.target.value); }} /></label><span>至</span><label><span>结束日期</span><input type="date" value={end} min={start} onChange={(event) => { setRange("custom"); setEnd(event.target.value); }} /></label></div><div className="export-summary"><div><span>记录数量</span><strong>{selected.length} 条</strong></div><div><span>实际消费</span><strong>¥{money(expense - refund)}</strong></div></div><p className="export-note">导出为 Excel 可直接打开的 CSV，包含账目来源、支付方式、订单号和备注。不修改或删除本机记录。</p><div className="form-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!selected.length || end < start} onClick={exportCsv}>导出 CSV</button></div></div></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>{children}</section></div>;
}

function ImportDialog({ existing, onClose, onComplete }: { existing: Transaction[]; onClose: () => void; onComplete: (plan: ImportPlan) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [platform, setPlatform] = useState("自动识别");
  const [rows, setRows] = useState<Transaction[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    inputRef.current?.setAttribute("accept", ".xlsx,.csv,.txt,.tsv,.json");
  }, []);

  useEffect(() => {
    function paste(event: ClipboardEvent) {
      const file = event.clipboardData?.files?.[0];
      if (file) { event.preventDefault(); processFile(file); return; }
      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (!text || !/[\t,;]/.test(text) || !/日期|时间/.test(text)) return;
      event.preventDefault(); setFileName("粘贴的表格内容"); setError("");
      const parsed = parseDelimited(text, platform);
      if (!parsed.length) setError("粘贴内容中没有识别到交易，请确认包含表头、日期和金额列。");
      else prepare(parsed);
    }
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    await processFile(file);
    event.target.value = "";
  }

  async function processFile(file: File) {
    setFileName(file.name); setError("");
    if (file.name.toLowerCase().endsWith(".json")) {
      try { const parsed = JSON.parse(await file.text()); const items = Array.isArray(parsed) ? parsed : parsed.transactions; if (!Array.isArray(items)) throw new Error(); prepare(items); } catch { setError("无法识别这个备份文件"); }
      return;
    }
    if (/\.xlsx$/i.test(file.name)) {
      try {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd hh:mm:ss", defval: "" });
        const parsed = parseMatrix(matrix, platform === "自动识别" ? file.name : platform);
        if (!parsed.length) { setError("没有识别到微信账单交易，请确认使用微信导出的原始 XLSX 文件。"); return; }
        prepare(parsed);
      } catch { setError("无法读取这个 Excel 文件，请确认文件没有损坏或加密。"); }
      return;
    }
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) { setError("支持微信 XLSX、支付宝 CSV、TXT、TSV 和 Koin JSON 备份；压缩包请先解压。"); return; }
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buffer);
    if ((text.match(/�/g) ?? []).length > 2) text = new TextDecoder("gb18030").decode(buffer);
    const parsed = parseDelimited(text, platform === "自动识别" ? file.name : platform);
    if (!parsed.length) { setError("没有识别到可导入的交易。请保留原始表头，或提供脱敏样例以便适配。 "); return; }
    prepare(parsed);
  }

  function prepare(items: Transaction[]) {
    const next = buildImportPlan(existing, items.map((item) => normalizeTransaction({ ...item, note: cleanImportedNote(item.note) })));
    setRows(next.preview); setSkipped(next.skipped); setPlan(next);
  }

  return <Modal title="导入并统一对账" onClose={onClose}><div className="import-dialog"><div className="platforms">{["自动识别", "微信", "支付宝", "银行卡", "美团", "美团月付", "抖音", "抖音月付"].map((item) => <button key={item} className={platform === item ? "active" : ""} onClick={() => setPlatform(item)}>{item}</button>)}</div><button className={dragging ? "drop-zone dragging" : "drop-zone"} onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) processFile(file); }}><span className="upload-mark"><Icon name="upload" /></span><strong>{dragging ? "松开即可读取账单" : fileName || "选择、拖入或粘贴账单"}</strong><small>支持微信 XLSX、平台或银行卡 CSV、TXT、TSV，以及 Koin 备份</small><em>文件只在本机解析，原始流水会作为关联凭证保留</em></button><input ref={inputRef} hidden type="file" accept=".xlsx,.csv,.txt,.tsv,.json" onChange={readFile} />{error && <p className="import-error">{error}</p>}{plan && <div className="import-outcomes"><div><span>新增消费</span><strong>{plan.added}</strong></div><div><span>自动关联</span><strong>{plan.linked}</strong></div><div><span>排除还款/转账</span><strong>{plan.excluded}</strong></div><div className={plan.review ? "attention" : ""}><span>待确认</span><strong>{plan.review}</strong></div></div>}{rows.length > 0 && <div className="import-preview"><div><strong>读取 {rows.length} 条有效流水</strong><span>{skipped ? `另跳过 ${skipped} 条已导入记录` : "未发现已导入记录"}</span></div>{rows.slice(0, 3).map((item) => <p key={item.id}><span>{item.date} · {item.merchant} · {kindLabel(item.kind)}</span><b>¥{money(item.amount)}</b></p>)}</div>}<div className="import-rules"><strong>Koin 会这样统计</strong><ul><li>消费发生时计入；花呗、白条和月付还款不再计算</li><li>订单、微信/支付宝支付与银行卡扣款会尝试关联为同一消费组</li><li>证据不足的相似流水暂不计入，进入“对账”栏目等待确认</li></ul></div><div className="form-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!plan?.imported} onClick={() => plan && onComplete(plan)}>确认导入</button></div></div></Modal>;
}

function parseDelimited(raw: string, sourceHint: string): Transaction[] {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  let headerIndex = lines.findIndex((line) => /交易时间|创建时间|付款时间|时间|日期/.test(line) && /金额|实付|收入|支出/.test(line));
  if (headerIndex < 0) headerIndex = 0;
  const delimiter = [",", "\t", ";"].sort((a, b) => (lines[headerIndex].split(b).length - lines[headerIndex].split(a).length))[0];
  const headers = splitRow(lines[headerIndex], delimiter).map((item) => item.trim());
  const find = (...patterns: RegExp[]) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  const dateIndex = find(/交易时间|创建时间|付款时间|下单时间|日期|时间/);
  const merchantIndex = find(/交易对方|商户名称|商家名称|商家$/);
  const productIndex = find(/商品说明|商品名称|商品$|用途/);
  const amountIndex = find(/金额.*元|实付金额|订单金额|交易金额|金额/);
  const paymentIndex = find(/支付方式|付款方式|资金状态/);
  const accountIndex = find(/资金账户|扣款账户|付款账户|账户名称|卡号|银行卡/);
  const statusIndex = find(/交易状态|订单状态|状态/);
  const typeIndex = find(/收\s*\/?\s*支|交易类型|业务类型/);
  const categoryIndex = find(/交易分类|订单分类/);
  const orderIndex = find(/交易单号|订单号|商户单号/);
  const source = detectSource(sourceHint);
  if (dateIndex < 0 || amountIndex < 0) return [];
  return lines.slice(headerIndex + 1).map((line, index) => {
    const cells = splitRow(line, delimiter); const status = cells[statusIndex] ?? ""; const type = cells[typeIndex] ?? ""; const product = (cells[productIndex] ?? "").trim(); const merchant = (cells[merchantIndex] || product || "未命名消费").trim(); const rawPayment = (cells[paymentIndex] || source).trim();
    if (/关闭|取消|失败|未支付/.test(status)) return null;
    const combined = `${type} ${merchant} ${product} ${status} ${cells[categoryIndex] ?? ""}`;
    const kind = inferKind(combined, type);
    const number = Number((cells[amountIndex] ?? "").replace(/[¥￥,\s]/g, "").replace(/^[-+]/, ""));
    const dateMatch = (cells[dateIndex] ?? "").match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (!dateMatch || !Number.isFinite(number) || number <= 0) return null;
    const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    const payment = normalizePaymentChannel(rawPayment, source, combined);
    const fundingAccount = inferFundingAccount(`${rawPayment} ${cells[accountIndex] ?? ""}`, source, combined);
    return { id: crypto.randomUUID(), date, merchant, amount: number, category: normalizeCategory(cells[categoryIndex] ?? "", `${merchant} ${product}`), payment, fundingAccount, source, kind, counted: kind !== "repayment" && kind !== "transfer", matchStatus: kind === "repayment" || kind === "transfer" ? "excluded" : "single", orderId: cells[orderIndex]?.replace(/\t/g, "").trim() || undefined, note: product && product !== merchant ? product : undefined } satisfies Transaction;
  }).filter((item): item is Transaction => Boolean(item));
}

function parseMatrix(matrix: (string | number | Date | null)[][], sourceHint: string): Transaction[] {
  const rows = matrix.map((row) => row.map((cell) => cell instanceof Date ? `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, "0")}-${String(cell.getDate()).padStart(2, "0")} ${String(cell.getHours()).padStart(2, "0")}:${String(cell.getMinutes()).padStart(2, "0")}:${String(cell.getSeconds()).padStart(2, "0")}` : String(cell ?? "").trim()));
  const headerIndex = rows.findIndex((row) => row.some((cell) => /交易时间/.test(cell)) && row.some((cell) => /金额/.test(cell)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  const find = (...patterns: RegExp[]) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  const dateIndex = find(/交易时间|创建时间|付款时间/);
  const typeIndex = find(/交易类型|业务类型/);
  const merchantIndex = find(/交易对方|商家/);
  const productIndex = find(/商品|商品说明|用途/);
  const flowIndex = find(/收\/支|收支/);
  const amountIndex = find(/金额/);
  const paymentIndex = find(/支付方式|付款方式/);
  const accountIndex = find(/资金账户|扣款账户|付款账户|账户名称|卡号|银行卡/);
  const statusIndex = find(/当前状态|交易状态|状态/);
  const orderIndex = find(/交易单号|交易订单号|订单号/);
  const source = detectSource(sourceHint);
  return rows.slice(headerIndex + 1).map((cells, index) => {
    const dateMatch = (cells[dateIndex] ?? "").match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    const amount = Number((cells[amountIndex] ?? "").replace(/[¥￥,\s]/g, "").replace(/^[-+]/, ""));
    if (!dateMatch || !Number.isFinite(amount) || amount <= 0) return null;
    const type = cells[typeIndex] ?? ""; const merchant = cells[merchantIndex] || cells[productIndex] || "未命名消费"; const product = cells[productIndex] ?? ""; const flow = cells[flowIndex] ?? ""; const status = cells[statusIndex] ?? "";
    if (/关闭|取消|失败|未支付/.test(status)) return null;
    const combined = `${type} ${merchant} ${product}`;
    const kind = inferKind(`${combined} ${status}`, flow);
    const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    const rawPayment = cells[paymentIndex] || source;
    const payment = normalizePaymentChannel(rawPayment, source, combined);
    const fundingAccount = inferFundingAccount(`${rawPayment} ${cells[accountIndex] ?? ""}`, source, combined);
    return { id: crypto.randomUUID(), date, merchant, amount, category: normalizeCategory("", `${merchant} ${product}`), payment, fundingAccount, source, kind, counted: kind !== "repayment" && kind !== "transfer", matchStatus: kind === "repayment" || kind === "transfer" ? "excluded" : "single", orderId: cells[orderIndex]?.replace(/\t/g, "").trim() || undefined, note: product && product !== merchant ? product : undefined } satisfies Transaction;
  }).filter((item): item is Transaction => Boolean(item));
}

function normalizeCategory(platformCategory: string, merchant: string) {
  if (/餐饮|美食/.test(platformCategory)) return "餐饮";
  if (/生活|日用/.test(platformCategory)) return "生活";
  if (/百货|服饰|购物|数码|电器/.test(platformCategory)) return "购物";
  if (/交通|出行/.test(platformCategory)) return "交通";
  if (/游戏/.test(platformCategory)) return "游戏";
  if (/娱乐|休闲/.test(platformCategory)) return "娱乐";
  if (/住房|居住|物业/.test(platformCategory)) return "居住";
  if (/医疗|健康/.test(platformCategory)) return "医疗";
  if (/教育|学习/.test(platformCategory)) return "学习";
  return classify(merchant);
}

function splitRow(line: string, delimiter: string) {
  const result: string[] = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; index++) { const char = line[index]; if (char === '"') { if (quoted && line[index + 1] === '"') { current += '"'; index++; } else quoted = !quoted; } else if (char === delimiter && !quoted) { result.push(current); current = ""; } else current += char; }
  result.push(current); return result;
}

function dedupeKey(item: Transaction) {
  if (item.orderId) return `${item.source}|${item.orderId}|${item.kind}`;
  return `${item.date}|${item.merchant.replace(/\s/g, "").toLowerCase()}|${item.amount.toFixed(2)}|${item.kind}`;
}
