"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

type Kind = "expense" | "refund" | "income" | "transfer";
type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  payment: string;
  source: string;
  kind: Kind;
  orderId?: string;
  note?: string;
};

const STORE_KEY = "koin.transactions.v1";
const CATEGORY_COLORS: Record<string, string> = {
  餐饮: "#ef825f",
  购物: "#7559d9",
  交通: "#43a68b",
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
  if (/会员|电影|游戏|抖音|音乐/.test(text)) return "娱乐";
  if (/书|课程|教育|培训/.test(text)) return "学习";
  if (/超市|商城|淘宝|京东|拼多多|商店/.test(text)) return "购物";
  return "其他";
}

function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = { home: "⌂", list: "≡", chart: "⌁", settings: "⚙", plus: "+", lock: "●", upload: "↥", back: "‹", next: "›", wallet: "◒", close: "×", download: "↓" };
  return <span aria-hidden="true">{icons[name] ?? "·"}</span>;
}

export default function KoinApp() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [rangeStart, setRangeStart] = useState(startOfCurrentMonth());
  const [rangeEnd, setRangeEnd] = useState(dateValue());
  const [periodOpen, setPeriodOpen] = useState(false);
  const [view, setView] = useState<"overview" | "records" | "insights" | "settings">("overview");
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
      setTransactions(parsed.filter((item) => !item.id.startsWith("demo-")).map((item) => ({ ...item, note: cleanImportedNote(item.note) })));
    } catch {
      setTransactions([]);
    }
    setLoaded(true);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
  const expenses = visible.filter((item) => item.kind === "expense");
  const refunds = visible.filter((item) => item.kind === "refund");
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
    setTransactions((current) => editing ? current.map((old) => old.id === item.id ? item : old) : [item, ...current]);
    setEditorOpen(false);
    setEditing(null);
    setToast(editing ? "记录已更新" : "已记入本月消费");
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

  function completeImport(items: Transaction[], skipped: number) {
    setTransactions((current) => [...items.map((item) => ({ ...item, note: cleanImportedNote(item.note) })), ...current]);
    setImportOpen(false);
    setToast(`已导入 ${items.length} 笔${skipped ? `，跳过 ${skipped} 笔重复` : ""}`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">K</span><span>Koin</span></div>
        <nav aria-label="主导航">
          <NavItem active={view === "overview"} icon="home" label="本月" onClick={() => setView("overview")} />
          <NavItem active={view === "records"} icon="list" label="明细" onClick={() => setView("records")} />
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
              <RecordsPanel items={visible} onOpen={openEditor} limit={6} />
            </>}
          </>}

          {view === "records" && <RecordsPanel items={visible} onOpen={openEditor} />}
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
      const searchable = [item.merchant, item.note, item.payment, item.source, item.orderId].filter(Boolean).join(" ").toLowerCase();
      return (!keyword || searchable.includes(keyword))
        && (kind === "all" || item.kind === kind)
        && (category === "all" || item.category === category)
        && (source === "all" || item.source === source);
    });
  }, [items, query, kind, category, source]);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  const totalExpense = filtered.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amount, 0);
  const totalIncome = filtered.filter((item) => item.kind === "income" || item.kind === "refund").reduce((sum, item) => sum + item.amount, 0);
  const filtering = Boolean(query || kind !== "all" || category !== "all" || source !== "all");
  const resetFilters = () => { setQuery(""); setKind("all"); setCategory("all"); setSource("all"); };

  return <section className="panel records-panel">
    <PanelTitle title="消费明细" subtitle={items.length ? `所选账期共 ${items.length} 条记录` : "所选账期还没有记录"} />
    <div className="records-summary" aria-label="明细收支汇总">
      <div><span>总支出</span><strong className="summary-expense">− ¥{money(totalExpense)}</strong></div>
      <div><span>总收入 <small>含退款</small></span><strong className="summary-income">+ ¥{money(totalIncome)}</strong></div>
    </div>
    {items.length > 0 && <div className="record-filters">
      <label className="record-search"><span className="sr-only">搜索明细</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商家、备注或订单号" /></label>
      <label><span className="sr-only">收支类型</span><select value={kind} onChange={(event) => setKind(event.target.value as Kind | "all")}><option value="all">全部收支</option><option value="expense">支出</option><option value="income">收入</option><option value="refund">退款</option><option value="transfer">不计消费</option></select></label>
      <label><span className="sr-only">消费分类</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">全部分类</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span className="sr-only">账目来源</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部来源</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
      {filtering && <button className="clear-filters" onClick={resetFilters}>清除筛选</button>}
    </div>}
    {filtering && <div className="filter-result">筛选到 {filtered.length} 条记录</div>}
    {sorted.length ? <div className="records">{sorted.map((item) => {
      const note = cleanImportedNote(item.note);
      return <button className="record" key={item.id} onClick={() => onOpen(item)}><span className="category-icon" style={{ background: `${CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.其他}22`, color: CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.其他 }}>{item.category.slice(0, 1)}</span><span className="record-main"><strong>{item.merchant}</strong><small>{Number(item.date.slice(5, 7))} 月 {Number(item.date.slice(8, 10))} 日 · {item.payment} · {item.source}{note ? ` · ${note}` : ""}</small></span><span className={item.kind === "refund" || item.kind === "income" ? "amount positive" : "amount"}>{item.kind === "refund" || item.kind === "income" ? "+" : "−"} ¥{money(item.amount)}</span></button>;
    })}</div> : <div className="small-empty">{filtering ? "没有符合筛选条件的记录" : "所选账期还没有记录"}</div>}
  </section>;
}

function Insights({ total, items, expenses, rangeStart, rangeEnd }: { total: number; items: { category: string; amount: number }[]; expenses: Transaction[]; rangeStart: string; rangeEnd: string }) {
  const days = Math.round((parseDate(rangeEnd).getTime() - parseDate(rangeStart).getTime()) / 86400000) + 1;
  return <section className="insights-view"><div className="view-heading"><span className="eyebrow">消费分析</span><h1>{rangeLabel(rangeStart, rangeEnd)}</h1><p>只统计真实消费，不包含花呗还款与账户互转。</p></div><div className="stat-row"><div><span>日均消费</span><strong>¥{money(total / Math.max(days, 1))}</strong></div><div><span>单笔平均</span><strong>¥{money(total / Math.max(expenses.length, 1))}</strong></div><div><span>消费笔数</span><strong>{expenses.length} 笔</strong></div></div><section className="panel insight-list"><PanelTitle title="分类排行" subtitle="金额由高到低" />{items.length ? items.map((item) => <div className="rank" key={item.category}><span className="dot" style={{ background: CATEGORY_COLORS[item.category] }} /><strong>{item.category}</strong><div><span style={{ width: `${item.amount / Math.max(items[0].amount, 1) * 100}%`, background: CATEGORY_COLORS[item.category] }} /></div><b>¥{money(item.amount)}</b></div>) : <div className="small-empty">导入账单后，这里会生成消费分析</div>}</section></section>;
}

function DataSettings({ transactions, onImport, onExport, onClear }: { transactions: Transaction[]; onImport: () => void; onExport: () => void; onClear: () => void }) {
  function backup() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), transactions }, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Koin-backup-${localDate(1).slice(0, 7)}.json`; link.click(); URL.revokeObjectURL(link.href);
  }
  return <section className="settings-view"><div className="view-heading"><span className="eyebrow">本机数据</span><h1>你的账本，只属于你</h1><p>Koin 不需要账号，账单解析和保存都在当前浏览器完成。</p></div><div className="settings-grid"><button className="setting-card" onClick={onImport}><span className="setting-icon"><Icon name="upload" /></span><div><strong>导入账单</strong><small>微信、支付宝及通用 CSV / TXT</small></div><Icon name="next" /></button><button className="setting-card" onClick={onExport}><span className="setting-icon"><Icon name="download" /></span><div><strong>导出期间账单</strong><small>按本周、本月或自定义日期导出 CSV</small></div><Icon name="next" /></button><button className="setting-card" onClick={backup}><span className="setting-icon"><Icon name="download" /></span><div><strong>导出完整备份</strong><small>保存 {transactions.length} 条记录为可恢复的 JSON</small></div><Icon name="next" /></button><button className="setting-card danger" onClick={() => { if (confirm("确定清空当前浏览器中的所有 Koin 记录吗？此操作无法撤销。")) onClear(); }}><span className="setting-icon"><Icon name="close" /></span><div><strong>清空本机账本</strong><small>删除当前浏览器中的全部记录</small></div><Icon name="next" /></button></div><div className="privacy-card"><span><Icon name="lock" /></span><div><strong>本地优先</strong><p>关闭页面后数据仍会保留，但清理浏览器数据可能导致丢失。建议定期导出备份。</p></div></div></section>;
}

function TransactionEditor({ initial, initialAmount, onClose, onSave, onDelete }: { initial: Transaction | null; initialAmount?: number; onClose: () => void; onSave: (item: Transaction) => void; onDelete?: () => void }) {
  const [form, setForm] = useState<Transaction>(initial ?? { id: crypto.randomUUID(), date: localDate(new Date().getDate()), merchant: "", amount: initialAmount ?? 0, category: "餐饮", payment: "支付宝", source: "手动", kind: "expense", note: "" });
  const [mobileCalculator, setMobileCalculator] = useState(false);
  function change(field: keyof Transaction, value: string | number) { setForm((current) => ({ ...current, [field]: value })); }
  function submit(event: FormEvent) { event.preventDefault(); if (!form.merchant.trim() || form.amount <= 0) return; onSave({ ...form, merchant: form.merchant.trim(), amount: Number(form.amount) }); }
  return <Modal title={initial ? "编辑记录" : "记一笔"} onClose={onClose}><form className="transaction-form" onSubmit={submit}><label className="amount-field"><span>金额</span><div><b>¥</b><input autoFocus type="number" min="0.01" step="0.01" value={form.amount || ""} onChange={(event) => change("amount", Number(event.target.value))} placeholder="0.00" required /></div></label><button type="button" className="inline-calculator-toggle" onClick={() => setMobileCalculator((open) => !open)}>⌗ {mobileCalculator ? "收起计算器" : "计算金额"}</button>{mobileCalculator && <div className="inline-calculator"><Calculator onUse={(amount) => { change("amount", amount); setMobileCalculator(false); }} /></div>}<div className="kind-tabs">{([ ["expense", "支出"], ["refund", "退款"], ["income", "收入"], ["transfer", "不计消费"] ] as [Kind, string][]).map(([value, label]) => <button type="button" className={form.kind === value ? "active" : ""} key={value} onClick={() => change("kind", value)}>{label}</button>)}</div><label><span>商家 / 用途</span><input value={form.merchant} onChange={(event) => change("merchant", event.target.value)} placeholder="例如：午间食堂" required /></label><div className="field-row"><label><span>日期</span><input type="date" value={form.date} onChange={(event) => change("date", event.target.value)} required /></label><label><span>分类</span><select value={form.category} onChange={(event) => change("category", event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="field-row"><label><span>账目来源</span><select value={form.source} onChange={(event) => change("source", event.target.value)}>{["手动", "微信", "支付宝", "抖音", "美团", "京东", "淘宝", "其他"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>支付方式</span><select value={form.payment} onChange={(event) => change("payment", event.target.value)}>{["支付宝", "花呗", "微信支付", "银行卡", "现金", "其他"].map((item) => <option key={item}>{item}</option>)}</select></label></div><label><span>备注</span><input value={form.note ?? ""} onChange={(event) => change("note", event.target.value)} placeholder="选填" /></label><div className="source-help">账目来源表示订单来自哪里，支付方式表示钱通过哪里付出。例如：来源“美团”，支付方式“花呗”。</div><div className="form-actions">{onDelete && <button type="button" className="delete-button" onClick={onDelete}>删除</button>}<button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" type="submit">保存记录</button></div></form></Modal>;
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
    const kindLabels: Record<Kind, string> = { expense: "支出", refund: "退款", income: "收入", transfer: "不计消费" };
    const escape = (value: string | number | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const headers = ["日期", "类型", "商家/用途", "金额（元）", "分类", "账目来源", "支付方式", "订单号", "备注"];
    const rows = selected.map((item) => [item.date, kindLabels[item.kind], item.merchant, item.amount.toFixed(2), item.category, item.source, item.payment, item.orderId, item.note].map(escape).join(","));
    const summary = [`导出期间,${escape(`${start} 至 ${end}`)}`, `实际消费合计,${escape((expense - refund).toFixed(2))}`, ""];
    const blob = new Blob(["\uFEFF", [...summary, headers.map(escape).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Koin账单_${start}_${end}.csv`; link.click(); URL.revokeObjectURL(link.href); onExported(selected.length);
  }

  return <Modal title="导出期间账单" onClose={onClose}><div className="export-dialog"><div className="range-tabs"><button className={range === "week" ? "active" : ""} onClick={() => choose("week")}>本周</button><button className={range === "month" ? "active" : ""} onClick={() => choose("month")}>当前月份</button><button className={range === "custom" ? "active" : ""} onClick={() => choose("custom")}>自定义</button></div><div className="export-dates"><label><span>开始日期</span><input type="date" value={start} onChange={(event) => { setRange("custom"); setStart(event.target.value); }} /></label><span>至</span><label><span>结束日期</span><input type="date" value={end} min={start} onChange={(event) => { setRange("custom"); setEnd(event.target.value); }} /></label></div><div className="export-summary"><div><span>记录数量</span><strong>{selected.length} 条</strong></div><div><span>实际消费</span><strong>¥{money(expense - refund)}</strong></div></div><p className="export-note">导出为 Excel 可直接打开的 CSV，包含账目来源、支付方式、订单号和备注。不修改或删除本机记录。</p><div className="form-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!selected.length || end < start} onClick={exportCsv}>导出 CSV</button></div></div></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>{children}</section></div>;
}

function ImportDialog({ existing, onClose, onComplete }: { existing: Transaction[]; onClose: () => void; onComplete: (items: Transaction[], skipped: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [platform, setPlatform] = useState("自动识别");
  const [rows, setRows] = useState<Transaction[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState(0);
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
    const keys = new Set(existing.map(dedupeKey)); let duplicateCount = 0;
    const unique = items.filter((item) => { const key = dedupeKey(item); if (keys.has(key)) { duplicateCount++; return false; } keys.add(key); return true; });
    setRows(unique); setSkipped(duplicateCount);
  }

  return <Modal title="导入账单" onClose={onClose}><div className="import-dialog"><div className="platforms">{["自动识别", "微信", "支付宝", "抖音", "美团"].map((item) => <button key={item} className={platform === item ? "active" : ""} onClick={() => setPlatform(item)}>{item}</button>)}</div><button className={dragging ? "drop-zone dragging" : "drop-zone"} onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) processFile(file); }}><span className="upload-mark"><Icon name="upload" /></span><strong>{dragging ? "松开即可读取账单" : fileName || "选择、拖入或粘贴账单"}</strong><small>支持 CSV、TXT、TSV、Koin 备份，或按 Ctrl + V 粘贴表格</small><em>文件仅在本机读取，不会上传</em></button><input ref={inputRef} hidden type="file" accept=".csv,.txt,.tsv,.json" onChange={readFile} />{error && <p className="import-error">{error}</p>}{rows.length > 0 && <div className="import-preview"><div><strong>准备导入 {rows.length} 笔</strong><span>{skipped ? `已识别并跳过 ${skipped} 笔重复记录` : "未发现重复记录"}</span></div>{rows.slice(0, 3).map((item) => <p key={item.id}><span>{item.date} · {item.merchant}</span><b>¥{money(item.amount)}</b></p>)}</div>}<div className="import-rules"><strong>Koin 会这样统计</strong><ul><li>花呗付款计入消费，花呗和信用卡还款不计入</li><li>转账、提现和余额互转不计入消费</li><li>相同订单号或相同时间、商家、金额的记录会去重</li></ul></div><div className="form-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!rows.length} onClick={() => onComplete(rows, skipped)}>确认导入</button></div></div></Modal>;
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
  const statusIndex = find(/交易状态|订单状态|状态/);
  const typeIndex = find(/收\s*\/?\s*支|交易类型|业务类型/);
  const categoryIndex = find(/交易分类|订单分类/);
  const orderIndex = find(/交易单号|订单号|商户单号/);
  const source = /微信/.test(sourceHint) ? "微信" : /支付宝/.test(sourceHint) ? "支付宝" : /抖音/.test(sourceHint) ? "抖音" : /美团/.test(sourceHint) ? "美团" : "账单导入";
  if (dateIndex < 0 || amountIndex < 0) return [];
  return lines.slice(headerIndex + 1).map((line, index) => {
    const cells = splitRow(line, delimiter); const status = cells[statusIndex] ?? ""; const type = cells[typeIndex] ?? ""; const product = (cells[productIndex] ?? "").trim(); const merchant = (cells[merchantIndex] || product || "未命名消费").trim(); const payment = (cells[paymentIndex] || source).trim();
    if (/关闭|取消|失败|未支付/.test(status)) return null;
    let kind: Kind = "expense";
    const combined = `${type} ${merchant} ${status}`;
    if (/退款|退回/.test(`${type} ${cells[categoryIndex] ?? ""} ${merchant}`)) kind = "refund";
    else if (/收入|收款/.test(type)) kind = "income";
    else if (/不计收支|中性/.test(type) || /还款|转账|提现|充值|余额宝|账户互转/.test(combined)) kind = "transfer";
    const number = Number((cells[amountIndex] ?? "").replace(/[¥￥,\s]/g, "").replace(/^[-+]/, ""));
    const dateMatch = (cells[dateIndex] ?? "").match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (!dateMatch || !Number.isFinite(number) || number <= 0) return null;
    const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    return { id: crypto.randomUUID(), date, merchant, amount: number, category: normalizeCategory(cells[categoryIndex] ?? "", `${merchant} ${product}`), payment: /花呗/.test(payment) ? "花呗" : payment, source, kind, orderId: cells[orderIndex]?.replace(/\t/g, "").trim() || undefined, note: product && product !== merchant ? product : undefined } satisfies Transaction;
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
  const statusIndex = find(/当前状态|交易状态|状态/);
  const orderIndex = find(/交易单号|交易订单号|订单号/);
  const source = /微信/.test(sourceHint) ? "微信" : /支付宝/.test(sourceHint) ? "支付宝" : "账单导入";
  return rows.slice(headerIndex + 1).map((cells, index) => {
    const dateMatch = (cells[dateIndex] ?? "").match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    const amount = Number((cells[amountIndex] ?? "").replace(/[¥￥,\s]/g, "").replace(/^[-+]/, ""));
    if (!dateMatch || !Number.isFinite(amount) || amount <= 0) return null;
    const type = cells[typeIndex] ?? ""; const merchant = cells[merchantIndex] || cells[productIndex] || "未命名消费"; const product = cells[productIndex] ?? ""; const flow = cells[flowIndex] ?? ""; const status = cells[statusIndex] ?? "";
    if (/关闭|取消|失败|未支付/.test(status)) return null;
    const combined = `${type} ${merchant} ${product}`;
    let kind: Kind = "expense";
    if (/退款|退回/.test(`${type} ${merchant}`)) kind = "refund";
    else if (/收入/.test(flow)) kind = "income";
    else if (/还款|转账|提现|充值|理财|零钱通存取|信用卡/.test(combined) || /中性|不计收支|\/$/.test(flow)) kind = "transfer";
    const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    const payment = cells[paymentIndex] || source;
    return { id: crypto.randomUUID(), date, merchant, amount, category: normalizeCategory("", `${merchant} ${product}`), payment: /花呗/.test(payment) ? "花呗" : payment, source, kind, orderId: cells[orderIndex]?.replace(/\t/g, "").trim() || undefined, note: product && product !== merchant ? product : undefined } satisfies Transaction;
  }).filter((item): item is Transaction => Boolean(item));
}

function normalizeCategory(platformCategory: string, merchant: string) {
  if (/餐饮|美食/.test(platformCategory)) return "餐饮";
  if (/日用|百货|服饰|购物|数码|电器/.test(platformCategory)) return "购物";
  if (/交通|出行/.test(platformCategory)) return "交通";
  if (/娱乐|休闲|游戏/.test(platformCategory)) return "娱乐";
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
