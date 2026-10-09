import { ChangeEvent, DragEvent, FormEvent, MouseEvent, PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  CATEGORY_COLORS, CATEGORIES, STORE_KEY, counts, createBook, displayTransaction,
  assignGroup, deleteTransaction, detachTransactions, groupsInRange, groupTransactionsByDay, linkTransactions, mergeGroups, monthEnd, netExpense, planImport, readBook, relatedTransactions, relationIndex, retainMonthlyGroups, setCounted, transactionSources,
  type ImportPreview, type Kind, type Transaction, type PurposeGroup, type RelationKind,
} from "./billModel";

type View = "overview" | "details" | "data";
type DetailFilter = { category?: string; merchant?: string; tag?: string };

const KIND_NAMES: Record<Kind, string> = { expense: "支出", refund: "退款", income: "收入", repayment: "还款", transfer: "转账" };
const RELATION_NAMES: Record<RelationKind, string> = { followup: "后续", attachment: "附属" };
const FONT_SIZES = [100, 115, 130, 150];
const FONT_KEY = "koin.fontScale.v1";

function loadFontSize() {
  try {
    const value = Number(localStorage.getItem(FONT_KEY));
    return FONT_SIZES.includes(value) ? value : 100;
  } catch { return 100; }
}

function monthNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function dateNow() {
  const now = new Date();
  return `${monthNow()}-${String(now.getDate()).padStart(2, "0")}`;
}

function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month: string) {
  const [year, number] = month.split("-");
  return `${year} 年 ${Number(number)} 月`;
}

function yuan(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function loadSaved() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    const book = readBook(saved ? JSON.parse(saved) : []);
    return { ...book, transactions: book.transactions.filter((item) => !item.id.startsWith("demo-")) };
  } catch {
    return readBook([]);
  }
}

async function downloadBook(items: Transaction[], fileName: string, groups: PurposeGroup[]): Promise<boolean> {
  const content = JSON.stringify(createBook(items, groups), null, 2);
  if (isTauri()) return invoke<boolean>("save_book_json", { fileName, content });
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function initials(value: string) {
  return value.slice(0, 1) || "账";
}

function monthItems(items: Transaction[], month: string) {
  return items.filter((item) => item.date.startsWith(month));
}

export default function KoinApp() {
  const [saved] = useState(loadSaved);
  const [transactions, setTransactions] = useState<Transaction[]>(saved.transactions);
  const [groups, setGroups] = useState<PurposeGroup[]>(saved.groups);
  const [month, setMonth] = useState(() => {
    const latest = [...saved.transactions.map((item) => item.date.slice(0, 7)), ...saved.groups.map((group) => group.month)].sort().at(-1);
    return latest ?? monthNow();
  });
  const [view, setView] = useState<View>("overview");
  const [detailFilter, setDetailFilter] = useState<DetailFilter>({});
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null | undefined>(undefined);
  const [toast, setToast] = useState("");
  const [fontSize, setFontSize] = useState(loadFontSize);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(fontSize / 100));
    localStorage.setItem(FONT_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    const header = document.querySelector(".topbar");
    if (!header) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-height", `${header.getBoundingClientRect().height}px`));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(createBook(transactions, groups)));
  }, [transactions, groups]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const current = useMemo(() => monthItems(transactions, month), [transactions, month]);

  function openDetails(filter: DetailFilter = {}) {
    setDetailFilter(filter);
    setView("details");
  }

  function save(item: Transaction) {
    const savedItem = retainMonthlyGroups(item, groups);
    const removedGroup = (savedItem.groupIds?.length ?? 0) < (item.groupIds?.length ?? 0);
    setTransactions((currentItems) => editing ? currentItems.map((old) => old.id === item.id ? savedItem : old) : [...currentItems, savedItem]);
    setEditing(undefined);
    setMonth(item.date.slice(0, 7));
    setToast(removedGroup ? "记录已更新，已移出原月份分组" : editing ? "记录已更新" : "已补记一笔");
  }

  function remove(id: string) {
    if (!window.confirm("确定删除这条记录吗？它的关联记录会保留并解除与它的关联。")) return;
    setTransactions((currentItems) => deleteTransaction(currentItems, id));
    setEditing(undefined);
    setToast("记录已删除");
  }

  function completeImport(preview: ImportPreview) {
    setGroups((currentGroups) => mergeGroups(currentGroups, preview.groups));
    setTransactions((currentItems) => {
      const known = new Set(currentItems.map((item) => item.id));
      return [...currentItems, ...preview.added.filter((item) => !known.has(item.id))];
    });
    if (preview.months.length) setMonth(preview.months.at(-1)!);
    setImportOpen(false);
    setToast(`新增 ${preview.added.length} 条，跳过重复 ${preview.duplicates} 条`);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">K</span><span>Koin</span></div>
      <nav aria-label="主导航">
        <Nav active={view === "overview"} icon="◫" label="概览" onClick={() => setView("overview")} />
        <Nav active={view === "details"} icon="≡" label="明细" onClick={() => openDetails()} />
        <Nav active={view === "data"} icon="↧" label="数据" onClick={() => setView("data")} />
      </nav>
      <p className="local-note">只在这台电脑保存 · 随时导出 JSON 备份</p>
    </aside>

    <main>
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-mark">K</span>Koin</div>
        <div className="month-switcher">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上个月">‹</button>
          <label><span>当前月份</span><input aria-label="选择月份" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下个月">›</button>
        </div>
        <div className="top-actions"><label className="font-size-control">字号<select aria-label="字体大小" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>{FONT_SIZES.map((size) => <option key={size} value={size}>{size}%</option>)}</select></label><button className="secondary" onClick={() => setEditing(null)}>补记</button><button className="primary" onClick={() => setImportOpen(true)}>导入 JSON</button></div>
      </header>

      <div className="content">
        {view === "overview" && <Overview current={current} all={transactions} month={month} onImport={() => setImportOpen(true)} onDetails={openDetails} />}
        {view === "details" && <Details items={transactions} groups={groups} month={month} onMonthVisible={setMonth} initialFilter={detailFilter} onEdit={setEditing} onAdd={() => setEditing(null)} onCounted={(ids, counted) => {
          setTransactions((old) => setCounted(old, ids, counted));
          setToast(counted ? "已恢复计入统计" : "已设为不计入统计");
        }} onLink={(ids, parentId, relation) => {
          setTransactions(linkTransactions(transactions, ids, parentId, relation));
          setToast(`已关联 ${ids.length} 条${RELATION_NAMES[relation]}记录`);
        }} onDetach={(ids) => {
          setTransactions((old) => detachTransactions(old, ids));
          setToast("已解除关联，账单内容保持不变");
        }} onGroupSave={(group) => setGroups((old) => old.some((item) => item.id === group.id) ? old.map((item) => item.id === group.id ? group : item) : [...old, group])} onGroupDelete={(id) => {
          if (!window.confirm("删除这个分组？组内账单会回到未分组列表。")) return;
          setGroups((old) => old.filter((group) => group.id !== id));
          setTransactions((old) => assignGroup(old, old.map((item) => item.id), id, true));
        }} onAssign={(ids, groupId, remove = false) => {
          const group = groups.find((group) => group.id === groupId);
          if (!group) return;
          const matching = transactions.filter((item) => ids.includes(item.id) && item.date.startsWith(group.month)).length;
          setTransactions((old) => assignGroup(old, ids, groupId, remove, group.month));
          setToast(remove ? "已移出分组" : matching < ids.length ? `仅移入 ${group.month} 的 ${matching} 条账单，其他月份保持原分组` : "已整理到分组");
        }} />}
        {view === "data" && <DataView key={month} items={transactions} groups={groups} month={month} onImport={() => setImportOpen(true)} onClear={() => {
          if (!window.confirm("确定清空本机账本吗？建议先导出整本备份，此操作无法撤销。")) return;
          setTransactions([]); setGroups([]); setToast("账本已清空");
        }} onExport={(count) => setToast(`已导出 ${count} 条记录`)} />}
      </div>
    </main>

    <nav className="mobile-nav" aria-label="移动端导航">
      <Nav active={view === "overview"} icon="◫" label="概览" onClick={() => setView("overview")} />
      <Nav active={view === "details"} icon="≡" label="明细" onClick={() => openDetails()} />
      <Nav active={view === "data"} icon="↧" label="数据" onClick={() => setView("data")} />
    </nav>

    {importOpen && <ImportDialog existing={transactions} groups={groups} onClose={() => setImportOpen(false)} onComplete={completeImport} />}
    {editing !== undefined && <Editor key={editing?.id ?? "new"} initial={editing} month={month} onClose={() => setEditing(undefined)} onSave={save} onDelete={editing ? () => remove(editing.id) : undefined} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function Nav({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={`nav-item${active ? " active" : ""}`} onClick={onClick}><span aria-hidden="true">{icon}</span><span>{label}</span></button>;
}

function Overview({ current, all, month, onImport, onDetails }: { current: Transaction[]; all: Transaction[]; month: string; onImport: () => void; onDetails: (filter?: DetailFilter) => void }) {
  const expenses = current.filter((item) => counts(item) && item.kind !== "refund" && item.kind !== "income");
  const refunds = current.filter((item) => counts(item) && item.kind === "refund");
  const income = current.filter((item) => counts(item) && item.kind === "income");
  const spent = netExpense(current);
  const refundTotal = refunds.reduce((sum, item) => sum + item.amount, 0);
  const incomeTotal = income.reduce((sum, item) => sum + item.amount, 0);
  const categories = rank(expenses.concat(refunds), (item) => item.category);
  const merchants = rank(expenses.concat(refunds), (item) => item.merchant);
  const tags = rank(expenses.concat(refunds).flatMap((item) => (item.tags ?? []).map((tag) => ({ ...item, tag }))), (item) => item.tag);
  const days = Array.from({ length: Number(monthEnd(month).slice(-2)) }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  const daily = days.map((date) => ({ date, amount: netExpense(current.filter((item) => item.date === date)) }));
  const maxDay = Math.max(...daily.map((item) => item.amount), 1);
  const monthKeys = Array.from({ length: 12 }, (_, index) => shiftMonth(month, index - 11));
  const monthly = monthKeys.map((key) => ({ key, amount: netExpense(monthItems(all, key)) }));
  const maxMonth = Math.max(...monthly.map((item) => item.amount), 1);
  const categoryTotal = categories.reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const stops = categories.map((item, index) => {
    const start = categories.slice(0, index).reduce((sum, previous) => sum + Math.max(0, previous.amount), 0) / Math.max(categoryTotal, 1) * 100;
    const end = start + Math.max(0, item.amount) / Math.max(categoryTotal, 1) * 100;
    return `${CATEGORY_COLORS[item.label] ?? CATEGORY_COLORS.其他} ${start}% ${end}%`;
  }).join(",");

  return <div className="overview-page">
    <section className="hero-card"><div><span className="eyebrow">{formatMonth(month)} · 实际消费</span><h1>¥{yuan(spent)}</h1><p>{expenses.length} 笔消费 · 已扣除 ¥{yuan(refundTotal)} 退款</p></div><div className="hero-side"><span>账单记录</span><strong>{current.length} 条</strong><small>本月全部流水</small></div></section>
    {!all.length && <section className="empty-state"><h2>从整理好的账单开始</h2><p>把原始账单发给我，确认疑问后导入我生成的 Koin JSON。</p><button className="primary" onClick={onImport}>导入 JSON</button></section>}
    <div className="summary-cards"><div><span>消费</span><strong>¥{yuan(expenses.reduce((sum, item) => sum + item.amount, 0))}</strong></div><div><span>退款</span><strong>¥{yuan(refundTotal)}</strong></div><div><span>收入</span><strong>¥{yuan(incomeTotal)}</strong></div></div>
    <div className="dashboard-grid">
      <section className="panel"><PanelTitle title="每日消费" subtitle="本月每天的净消费" /><div className="daily-bars">{daily.map((item) => <div key={item.date} title={`${item.date} · ¥${yuan(item.amount)}`}><i style={{ height: `${Math.max(3, Math.max(0, item.amount) / maxDay * 100)}%` }} /></div>)}</div><div className="chart-axis"><span>1 日</span><span>{days.length} 日</span></div></section>
      <section className="panel"><PanelTitle title="分类占比" subtitle="点击分类查看消费" />{categories.length ? <div className="category-chart"><div className="donut" style={{ background: `conic-gradient(${stops})` }}><div>¥{yuan(spent)}</div></div><div className="category-legend">{categories.slice(0, 6).map((item) => <button key={item.label} onClick={() => onDetails({ category: item.label })}><i style={{ background: CATEGORY_COLORS[item.label] ?? CATEGORY_COLORS.其他 }} /><span>{item.label}</span><b>¥{yuan(item.amount)}</b></button>)}</div></div> : <p className="small-empty">这个月还没有消费</p>}</section>
    </div>
    <section className="panel trend-panel"><PanelTitle title="近 12 个月" subtitle="从当前月份向前查看消费变化" /><div className="monthly-bars">{monthly.map((item) => <div key={item.key} title={`${formatMonth(item.key)} · ¥${yuan(item.amount)}`}><span>¥{yuan(item.amount)}</span><div><i style={{ height: `${Math.max(3, Math.max(0, item.amount) / maxMonth * 100)}%` }} /></div><small>{Number(item.key.slice(5))} 月</small></div>)}</div></section>
    <div className="rank-grid"><Ranking title="商家累计" items={merchants} onChoose={(merchant) => onDetails({ merchant })} /><Ranking title="标签排行" items={tags} onChoose={(tag) => onDetails({ tag })} /></div>
    <section className="panel recent-panel"><div className="section-heading"><PanelTitle title="最近的账单" subtitle="商品或用途优先显示" /><button onClick={() => onDetails()}>查看全部 ›</button></div>{[...current].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((item) => <TransactionLine key={item.id} item={item} onClick={() => onDetails()} />)}</section>
  </div>;
}

function rank<T extends Transaction>(items: T[], key: (item: T) => string) {
  const totals = new Map<string, number>();
  for (const item of items) {
    const label = key(item);
    if (!label) continue;
    totals.set(label, (totals.get(label) ?? 0) + (item.kind === "refund" ? -item.amount : item.amount));
  }
  return [...totals].map(([label, amount]) => ({ label, amount })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="panel-title"><h2>{title}</h2><p>{subtitle}</p></div>;
}

function Ranking({ title, items, onChoose }: { title: string; items: { label: string; amount: number }[]; onChoose: (label: string) => void }) {
  return <section className="panel ranking"><PanelTitle title={title} subtitle="点击查看对应明细" />{items.length ? items.slice(0, 8).map((item, index) => <button key={item.label} onClick={() => onChoose(item.label)}><em>{index + 1}</em><span>{item.label}</span><b>¥{yuan(item.amount)}</b></button>) : <p className="small-empty">暂无数据</p>}</section>;
}

function TransactionLine({ item, onClick }: { item: Transaction; onClick: () => void }) {
  const display = displayTransaction(item);
  return <button className="transaction-line" onClick={onClick}><span className="category-icon" style={{ color: CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.其他 }}>{initials(item.category)}</span><span className="transaction-main"><strong>{display.title}</strong><small>{display.merchant ? `${display.merchant} · ` : ""}{item.date} · {item.category}{item.counted === false ? " · 不计入" : ""}</small></span><b className={item.kind === "refund" || item.kind === "income" ? "positive" : ""}>{item.kind === "refund" || item.kind === "income" ? "+" : "−"} ¥{yuan(item.amount)}</b></button>;
}

function Details({ items, groups, month, onMonthVisible, initialFilter, onEdit, onAdd, onCounted, onLink, onDetach, onGroupSave, onGroupDelete, onAssign }: {
  items: Transaction[]; groups: PurposeGroup[]; month: string; initialFilter: DetailFilter;
  onMonthVisible: (month: string) => void;
  onEdit: (item: Transaction) => void; onAdd: () => void;
  onCounted: (ids: string[], counted: boolean) => void;
  onLink: (ids: string[], parentId: string, relation: RelationKind) => void;
  onDetach: (ids: string[]) => void;
  onGroupSave: (group: PurposeGroup) => void; onGroupDelete: (id: string) => void;
  onAssign: (ids: string[], groupId: string, remove?: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(initialFilter.category ?? "");
  const [merchant, setMerchant] = useState(initialFilter.merchant ?? "");
  const [tag, setTag] = useState(initialFilter.tag ?? "");
  const [source, setSource] = useState("");
  const [scope, setScope] = useState<"month" | "range" | "all">("all");
  const [start, setStart] = useState(month);
  const [end, setEnd] = useState(month);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedRelations, setExpandedRelations] = useState<Set<string>>(new Set());
  const [linkRequest, setLinkRequest] = useState<{ ids: string[]; parentId: string } | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const relations = useMemo(() => relationIndex(items), [items]);
  const [groupName, setGroupName] = useState("");
  const [groupMonth, setGroupMonth] = useState("");
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupError, setGroupError] = useState("");
  const [toolPanel, setToolPanel] = useState<"filters" | "group" | null>(() => Object.values(initialFilter).some(Boolean) ? "filters" : null);
  const [contextMenu, setContextMenu] = useState<{ id: string; groupId?: string; x: number; y: number; showGroups: boolean } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuOrigin = useRef<HTMLButtonElement | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dropRecordId, setDropRecordId] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{ ids: string[]; title: string } | null>(null);
  const dragPreview = useRef<HTMLDivElement>(null);
  const pointerDrag = useRef<{ ids: string[]; title: string; pointerId: number; x: number; y: number; currentX: number; currentY: number; moved: boolean } | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLElement>(null);
  const visibleMonth = useRef<string | null>(null);
  const userScrolling = useRef(false);
  const validRange = scope !== "range" || Boolean(start && end && start <= end);
  const visibleGroups = validRange ? groupsInRange(groups, scope === "all" ? undefined : scope === "month" ? month : start, scope === "month" ? month : end) : [];
  const scoped = items.filter((item) => validRange && (scope === "all" || (item.date.slice(0, 7) >= (scope === "month" ? month : start) && item.date.slice(0, 7) <= (scope === "month" ? month : end))));
  const categories = [...new Set(scoped.map((item) => item.category))].sort();
  const merchants = [...new Set(scoped.map((item) => item.merchant))].sort();
  const tags = [...new Set(scoped.flatMap((item) => item.tags ?? []))].sort();
  const sources = [...new Set(scoped.flatMap(transactionSources))].sort();
  const visible = scoped.filter((item) => {
    const names = groups.filter((group) => item.groupIds?.includes(group.id)).map((group) => group.name);
    const itemSources = transactionSources(item);
    const searchable = [item.merchant, item.note, item.category, ...itemSources, ...(item.tags ?? []), ...names].join(" ").toLowerCase();
    return (!query || searchable.includes(query.trim().toLowerCase())) && (!category || item.category === category) && (!merchant || item.merchant === merchant) && (!tag || item.tags?.includes(tag)) && (!source || itemSources.includes(source));
  }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const selectedItems = items.filter((item) => selected.has(item.id));
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));
  const timelineMonths = [...new Set([...scoped.map((item) => item.date.slice(0, 7)), ...visibleGroups.map((group) => group.month), ...(scope === "all" || scope === "month" ? [month] : [])])].sort().reverse();
  const firstTimelineMonth = timelineMonths[0];
  const canExclude = selectedItems.some(counts);
  const canRestore = selectedItems.some((item) => !counts(item));
  const filterCount = [source, category, merchant, tag].filter(Boolean).length;
  const contextItem = items.find((item) => item.id === contextMenu?.id);
  const movingIds = useMemo(() => new Set(dragged?.ids), [dragged]);
  const dropTarget = groups.find((group) => group.id === dragOver);
  const dropRecord = relations.byId.get(dropRecordId ?? "");

  useEffect(() => {
    if (!revealId) return;
    let root = relations.byId.get(revealId);
    while (root?.parentId && relations.byId.has(root.parentId)) root = relations.byId.get(root.parentId);
    const target = [...(timeline.current?.querySelectorAll<HTMLElement>("[data-record-id]") ?? [])].find((row) => row.dataset.recordId === revealId && row.closest<HTMLElement>("[data-month]")?.dataset.month === root?.date.slice(0, 7));
    if (!target) return;
    userScrolling.current = false;
    const offset = (document.querySelector(".topbar")?.getBoundingClientRect().height ?? 84) + (window.innerWidth > 980 ? toolbar.current?.getBoundingClientRect().height ?? 0 : 0) + 20;
    window.scrollTo({ top: Math.max(0, scrollY + target.getBoundingClientRect().top - offset), behavior: "auto" });
    target.querySelector<HTMLButtonElement>(".detail-select")?.focus({ preventScroll: true });
    setRevealId(null);
  }, [revealId, expanded, expandedRelations, scope, relations]);

  function revealRecord(id: string) {
    const item = relations.byId.get(id);
    if (!item) return;
    const ancestors: Transaction[] = [];
    let parent = item.parentId ? relations.byId.get(item.parentId) : undefined;
    while (parent) { ancestors.push(parent); parent = parent.parentId ? relations.byId.get(parent.parentId) : undefined; }
    setExpandedRelations((old) => new Set([...old, ...ancestors.map((record) => record.id)]));
    setExpanded((old) => new Set([...old, ...((ancestors.at(-1) ?? item).groupIds ?? [])]));
    setQuery(""); setSource(""); setCategory(""); setMerchant(""); setTag(""); setScope("all");
    onMonthVisible((ancestors.at(-1) ?? item).date.slice(0, 7));
    setRevealId(id);
  }

  function positionDragPreview(x: number, y: number) {
    if (!dragPreview.current) return;
    const left = Math.max(12, Math.min(x + 16, window.innerWidth - Math.min(260, window.innerWidth - 24) - 12));
    const top = Math.max(12, Math.min(y + 16, window.innerHeight - 108));
    dragPreview.current.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  useLayoutEffect(() => {
    const drag = pointerDrag.current;
    if (dragged && drag) positionDragPreview(drag.currentX, drag.currentY);
  }, [dragged]);

  useLayoutEffect(() => {
    if (!contextMenu || !menu.current) return;
    const bounds = menu.current.getBoundingClientRect();
    const x = Math.max(12, Math.min(contextMenu.x, window.innerWidth - bounds.width - 12));
    const y = Math.max(12, Math.min(contextMenu.y, window.innerHeight - bounds.height - 12));
    if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu({ ...contextMenu, x, y });
    menu.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    function dismiss(event: Event) { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setContextMenu(null); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); setContextMenu(null); menuOrigin.current?.focus(); } }
    function close() { setContextMenu(null); }
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", escape);
    };
  }, [contextMenu]);

  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--detail-toolbar-height", `${element.getBoundingClientRect().height}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (revealId) { visibleMonth.current = month; return; }
    if (scope !== "all" || visibleMonth.current === month) return;
    const firstVisit = visibleMonth.current === null;
    visibleMonth.current = month;
    userScrolling.current = false;
    if (firstVisit && month === firstTimelineMonth) return;
    const target = [...(timeline.current?.querySelectorAll<HTMLElement>("[data-month]") ?? [])].find((section) => section.dataset.month === month);
    const toolbarHeight = window.innerWidth > 980 ? toolbar.current?.getBoundingClientRect().height ?? 0 : 0;
    if (target) window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - (document.querySelector(".topbar")?.getBoundingClientRect().height ?? 84) - toolbarHeight - 20), behavior: "auto" });
  }, [month, scope, firstTimelineMonth, revealId]);

  useEffect(() => {
    if (scope !== "all") return;
    let frame = 0;
    function updateMonth() {
      frame = 0;
      const toolbarHeight = window.innerWidth > 980 ? toolbar.current?.getBoundingClientRect().height ?? 0 : 0;
      const marker = (document.querySelector(".topbar")?.getBoundingClientRect().height ?? 84) + toolbarHeight + 24;
      const sections = timeline.current?.querySelectorAll<HTMLElement>("[data-month]") ?? [];
      for (const section of sections) {
        const rect = section.getBoundingClientRect();
        if (rect.bottom > marker && section.dataset.month) {
          if (section.dataset.month !== visibleMonth.current) {
            visibleMonth.current = section.dataset.month;
            onMonthVisible(section.dataset.month);
          }
          break;
        }
      }
    }
    function onScroll() { if (userScrolling.current && !frame) frame = requestAnimationFrame(updateMonth); }
    function allowScroll() { userScrolling.current = true; }
    function onPointerDown(event: globalThis.PointerEvent) {
      userScrolling.current = event.clientX >= document.documentElement.clientWidth;
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest("input,select,textarea")) return;
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key)) allowScroll();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", allowScroll, { passive: true });
    window.addEventListener("touchmove", allowScroll, { passive: true });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", allowScroll); window.removeEventListener("touchmove", allowScroll);
      window.removeEventListener("pointerdown", onPointerDown); window.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [scope, onMonthVisible]);

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleVisible() {
    setSelected((current) => { const next = new Set(current); for (const item of visible) if (allVisibleSelected) next.delete(item.id); else next.add(item.id); return next; });
  }
  function toggleGroup(id: string) {
    setExpanded((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function saveGroup(event: FormEvent) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) { setGroupError("请输入分组名称"); return; }
    const targetMonth = editingGroup ? groups.find((group) => group.id === editingGroup)!.month : scope === "month" ? month : groupMonth || month;
    if (!targetMonth || !validRange || (scope === "range" && (targetMonth < start || targetMonth > end))) { setGroupError("请选择查看范围内的月份"); return; }
    if (groups.some((group) => group.month === targetMonth && group.name === name && group.id !== editingGroup)) { setGroupError("这个月已存在同名分组"); return; }
    const id = editingGroup ?? crypto.randomUUID();
    onGroupSave({ id, name, month: targetMonth });
    setEditingGroup(null); setGroupName(""); setGroupError("");
    setToolPanel(null);
  }
  function drop(event: DragEvent, groupId: string) {
    event.preventDefault(); setDragOver(null);
    try {
      const ids: unknown = JSON.parse(event.dataTransfer.getData("application/x-koin-transactions"));
      if (Array.isArray(ids) && ids.every((id) => typeof id === "string") && ids.length) onAssign(ids, groupId);
    } catch { /* Ignore files and other external drag data. */ }
  }
  function pointerStart(event: PointerEvent<HTMLButtonElement>, item: Transaction) {
    if (event.button !== 0 || !event.isPrimary || pointerDrag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ids = selected.has(item.id) ? selectedItems.map((record) => record.id) : [item.id];
    pointerDrag.current = { ids, title: displayTransaction(item).title, pointerId: event.pointerId, x: event.clientX, y: event.clientY, currentX: event.clientX, currentY: event.clientY, moved: false };
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6 && !drag.moved) return;
    if (!drag.moved) { drag.moved = true; setContextMenu(null); setDragged({ ids: drag.ids, title: drag.title }); }
    drag.currentX = event.clientX; drag.currentY = event.clientY;
    positionDragPreview(event.clientX, event.clientY);
    const folder = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-group-id]");
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-record-id]");
    const targetId = row?.dataset.recordId;
    const recordTarget = targetId && !drag.ids.includes(targetId) ? targetId : null;
    setDropRecordId(recordTarget);
    setDragOver(recordTarget ? null : folder?.dataset.groupId ?? null);
    if (event.clientY < 100) { userScrolling.current = true; window.scrollBy(0, -30); }
    else if (event.clientY > window.innerHeight - 60) { userScrolling.current = true; window.scrollBy(0, 30); }
  }
  function pointerFinish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    pointerDrag.current = null;
    setDragged(null); setDragOver(null); setDropRecordId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const folder = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-group-id]");
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-record-id]");
    const targetId = row?.dataset.recordId;
    if (!cancelled && drag.moved && targetId && !drag.ids.includes(targetId)) setLinkRequest({ ids: drag.ids, parentId: targetId });
    else if (!cancelled && drag.moved && folder?.dataset.groupId) onAssign(drag.ids, folder.dataset.groupId);
    return drag.moved;
  }
  function openContextMenu(event: MouseEvent<HTMLDivElement>, item: Transaction, groupId?: string) {
    event.preventDefault();
    menuOrigin.current = event.currentTarget.querySelector<HTMLButtonElement>(".detail-select");
    const bounds = event.currentTarget.getBoundingClientRect();
    setContextMenu({ id: item.id, groupId, x: event.clientX || bounds.left + 20, y: event.clientY || bounds.top + 20, showGroups: false });
  }
  const rowProps = { selected, movingIds, dropRecordId, relations, expandedRelations, onExpandRelation: (id: string) => setExpandedRelations((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; }), onReveal: revealRecord, onToggle: toggle, onEdit, onAssign, onPointerStart: pointerStart, onPointerMove: pointerMove, onPointerFinish: pointerFinish, onContextMenu: openContextMenu };

  return <div className={`details-page${dragged ? " is-dragging" : ""}`}>
    {contextMenu && contextItem && <div ref={menu} className="bill-context-menu" role="menu" tabIndex={-1} aria-label="账单操作" style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (event.key === "Tab") setContextMenu(null);
    }}>
      <div className="context-title">{displayTransaction(contextItem).title}</div>
      {contextMenu.showGroups ? <><button role="menuitem" onClick={() => setContextMenu({ ...contextMenu, showGroups: false })}>‹ 返回</button>{groups.filter((group) => group.month === contextItem.date.slice(0, 7)).map((group) => <button role="menuitem" key={group.id} onClick={() => { onAssign([contextItem.id], group.id); setContextMenu(null); }}>{group.name}</button>)}</> : <>
        <button role="menuitem" onClick={() => { toggle(contextItem.id); setContextMenu(null); }}>{selected.has(contextItem.id) ? "取消勾选" : "勾选这笔"}</button>
        <button role="menuitem" onClick={() => { onEdit(contextItem); setContextMenu(null); }}>编辑账单</button>
        <button role="menuitem" onClick={() => { setLinkRequest({ ids: [contextItem.id], parentId: "" }); setContextMenu(null); }}>关联到其他账单…</button>
        {relations.children.has(contextItem.id) && <button role="menuitem" onClick={() => { setSelected((old) => new Set([...old, ...relatedTransactions(relations, contextItem.id).map((item) => item.id)])); setContextMenu(null); }}>勾选关联组</button>}
        {contextItem.parentId && <><button role="menuitem" disabled={!relations.byId.has(contextItem.parentId)} onClick={() => { revealRecord(contextItem.parentId!); setContextMenu(null); }}>查看主账单</button><button role="menuitem" onClick={() => { onDetach([contextItem.id]); setContextMenu(null); }}>解除关联</button></>}
        <button role="menuitem" onClick={() => { onCounted([contextItem.id], !counts(contextItem)); setContextMenu(null); }}>{counts(contextItem) ? "设为不计入" : "恢复计入"}</button>
        <button role="menuitem" aria-haspopup="menu" disabled={!groups.some((group) => group.month === contextItem.date.slice(0, 7))} onClick={() => setContextMenu({ ...contextMenu, showGroups: true })}>移入分组 ›</button>
        {contextMenu.groupId && <button role="menuitem" onClick={() => { onAssign([contextItem.id], contextMenu.groupId!, true); setContextMenu(null); }}>移出当前分组</button>}
      </>}
    </div>}
    {linkRequest && <LinkDialog items={items} request={linkRequest} onClose={() => setLinkRequest(null)} onLink={(parentId, relation) => { onLink(linkRequest.ids, parentId, relation); setExpandedRelations((old) => new Set([...old, parentId])); setLinkRequest(null); }} />}
    {dragged && <div ref={dragPreview} className="drag-preview" role="status"><strong>正在移动 {dragged.ids.length} 条账单</strong><span>{dragged.title}{dragged.ids.length > 1 ? ` 等 ${dragged.ids.length} 条` : ""}</span><small>{dropRecord ? `松开关联到「${displayTransaction(dropRecord).title}」` : dropTarget ? `松开移入「${dropTarget.name}」` : "拖到另一笔账单建立关联，或拖入同月分组"}</small></div>}
    <section className="detail-toolbar" aria-label="明细功能栏" ref={toolbar}>
      <div className="detail-tools"><h1>明细</h1><button className="primary create-group-button" aria-expanded={toolPanel === "group"} aria-controls="detail-group-options" onClick={() => { setEditingGroup(null); setGroupName(""); setGroupMonth(""); setGroupError(""); setToolPanel(toolPanel === "group" ? null : "group"); }}><span aria-hidden="true">＋</span>新建分组</button><select aria-label="查看月份范围" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="all">连续浏览</option><option value="month">当前月份</option><option value="range">月份范围</option></select><input type="search" aria-label="搜索账单" placeholder="搜索商品、商家、来源或分组" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="secondary" aria-expanded={toolPanel === "filters"} aria-controls="detail-filter-options" onClick={() => setToolPanel(toolPanel === "filters" ? null : "filters")}>筛选{filterCount ? ` (${filterCount})` : ""}</button><button className="secondary" onClick={onAdd}>补记一笔</button></div>
      {scope === "range" && <div className="organize-period"><label>从 <input aria-label="查看起始月份" type="month" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>到 <input aria-label="查看结束月份" type="month" value={end} onChange={(event) => setEnd(event.target.value)} /></label>{!validRange && <span role="alert">请选择有效的月份范围</span>}</div>}
      <div id="detail-filter-options" className="tool-options" hidden={toolPanel !== "filters"}><div className="filters"><select aria-label="筛选来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option>{sources.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="筛选分类" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="筛选商家" value={merchant} onChange={(event) => setMerchant(event.target.value)}><option value="">全部商家</option>{merchants.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="筛选标签" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">全部标签</option>{tags.map((item) => <option key={item}>{item}</option>)}</select></div></div>
      <div id="detail-group-options" className="tool-options" hidden={toolPanel !== "group"}><form className="group-create" onSubmit={saveGroup}>{scope !== "month" && !editingGroup && <label>所属月份 <input aria-label="分组所属月份" type="month" min={scope === "range" ? start : undefined} max={scope === "range" ? end : undefined} value={groupMonth || month} onChange={(event) => setGroupMonth(event.target.value)} /></label>}<input aria-label="分组名称" maxLength={80} placeholder="例如：厨具购买" value={groupName} onChange={(event) => { setGroupName(event.target.value); setGroupError(""); }} /><button className="secondary" type="submit">{editingGroup ? "保存名称" : "创建分组"}</button><button type="button" onClick={() => { setToolPanel(null); setEditingGroup(null); setGroupName(""); setGroupError(""); }}>取消</button><span className="group-hint">每月独立，拖入同月账单整理</span></form>{groupError && <p className="import-error" role="alert">{groupError}</p>}</div>
      <div className="filter-summary"><span>当前显示 {visible.length} 条 · 净消费 ¥{yuan(netExpense(visible))}</span>{(query || filterCount > 0) && <button onClick={() => { setQuery(""); setCategory(""); setMerchant(""); setTag(""); setSource(""); }}>清除筛选</button>}</div>
    <section className="selected-summary"><div><span>已选 {selectedItems.length} 条</span><strong title="退款扣除，不计入记录按 0 元计算">净消费 ¥{yuan(netExpense(selectedItems))}</strong><small>退款扣除，“不计入”记录按 0 元计算；手动计入的转账、还款按支出计算</small></div><div><select aria-label="将已选账单移入分组" value="" disabled={!selectedItems.length || !visibleGroups.length} onChange={(event) => onAssign(selectedItems.map((item) => item.id), event.target.value)}><option value="">移入分组…</option>{visibleGroups.map((group) => <option value={group.id} key={group.id}>{scope === "month" ? group.name : `${group.month} · ${group.name}`}</option>)}</select><button disabled={!canExclude} onClick={() => onCounted(selectedItems.map((item) => item.id), false)}>设为不计入</button><button disabled={!canRestore} onClick={() => onCounted(selectedItems.map((item) => item.id), true)}>恢复计入</button><button onClick={toggleVisible}>{allVisibleSelected ? "取消当前全选" : "勾选当前结果"}</button><button disabled={!selectedItems.length} onClick={() => setSelected(new Set())}>清空勾选</button></div></section>
    </section>
    <div className="bill-timeline" ref={timeline}>{timelineMonths.map((timelineMonth) => {
      const monthly = visible.filter((item) => item.date.startsWith(timelineMonth));
      const monthlyGroups = visibleGroups.filter((group) => group.month === timelineMonth);
      const ungrouped = monthly.filter((item) => !monthlyGroups.some((group) => item.groupIds?.includes(group.id)));
      return <section className="month-ledger" key={timelineMonth} data-month={timelineMonth} aria-label={`${formatMonth(timelineMonth)}账单`}>
      <div className="month-heading"><h2>{formatMonth(timelineMonth)}</h2><span>{monthly.length} 笔 · 净消费 ¥{yuan(netExpense(monthly))}</span></div>
      <div className="folder-grid">{monthlyGroups.map((group) => {
        const records = monthly.filter((item) => item.groupIds?.includes(group.id));
        const excludedCount = records.filter((item) => !counts(item)).length;
        const total = netExpense(items.filter((item) => item.groupIds?.includes(group.id)));
        return <section key={group.id} data-group-id={group.id} className={`panel purpose-folder${dragOver === group.id ? " drag-over" : ""}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-koin-transactions")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOver(group.id); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(null); }} onDrop={(event) => drop(event, group.id)}>
          <div className="folder-heading"><button className="folder-toggle" aria-expanded={expanded.has(group.id)} onClick={() => toggleGroup(group.id)}><span aria-hidden="true">{expanded.has(group.id) ? "▾" : "▸"} ▰</span><strong>{group.name}</strong><span>{records.length} 笔</span><b>¥{yuan(netExpense(records))}</b></button><div className="folder-actions"><button onClick={() => setSelected((old) => new Set([...old, ...records.map((item) => item.id)]))} disabled={!records.length}>勾选组内</button><button onClick={() => { setEditingGroup(group.id); setGroupName(group.name); setGroupError(""); setToolPanel("group"); if (window.innerWidth <= 980) toolbar.current?.scrollIntoView({ block: "start" }); }}>改名</button><button onClick={() => onGroupDelete(group.id)}>删除分组</button></div></div>
          <div className="folder-caption">本月分组累计 ¥{yuan(total)}{excludedCount ? ` · ${excludedCount} 条不计入` : ""}{!records.length ? " · 可拖入同月账单" : ""}</div>
          {expanded.has(group.id) && records.length > 0 && <div className="folder-records"><BillRows records={records} groupId={group.id} {...rowProps} /></div>}
        </section>;
      })}</div>
    <section className="panel day-list"><div className="ungrouped-heading"><h2>未分组账单</h2><span>{ungrouped.length} 笔 · 净消费 ¥{yuan(netExpense(ungrouped))}</span></div>{ungrouped.length ? <BillRows records={ungrouped} {...rowProps} /> : <p className="small-empty">当前范围没有未分组账单</p>}</section>
    </section>;
    })}</div>
  </div>;
}
type BillRowActions = {
  movingIds: Set<string>;
  dropRecordId: string | null;
  relations: ReturnType<typeof relationIndex>;
  expandedRelations: Set<string>;
  onExpandRelation: (id: string) => void;
  onReveal: (id: string) => void;
  onToggle: (id: string) => void; onEdit: (item: Transaction) => void;
  onAssign: (ids: string[], groupId: string, remove?: boolean) => void;
  onPointerStart: (event: PointerEvent<HTMLButtonElement>, item: Transaction) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerFinish: (event: PointerEvent<HTMLButtonElement>, cancelled?: boolean) => boolean;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, item: Transaction, groupId?: string) => void;
};

function BillRows({ records, groupId, selected, ...actions }: BillRowActions & {
  records: Transaction[]; groupId?: string; selected: Set<string>;
}) {
    const recordIds = new Set(records.map((item) => item.id));
    const roots = records.filter((item) => {
      const parent = item.parentId ? actions.relations.byId.get(item.parentId) : undefined;
      return !parent || parent.date !== item.date || !recordIds.has(parent.id);
    });
    return groupTransactionsByDay(roots).map(({ date, records: daily }) => <div className="day-group" key={date}>
      <div className="day-heading"><strong>{date}</strong><span>净消费 ¥{yuan(netExpense(records.filter((item) => item.date === date)))}</span></div>
      {daily.map((item) => <BillEntry key={item.id} item={item} groupId={groupId} selected={selected} {...actions} />)}
    </div>);

}

function BillEntry({ item, groupId, selected, ...actions }: BillRowActions & { item: Transaction; groupId?: string; selected: Set<string> }) {
  const children = actions.relations.children.get(item.id) ?? [];
  const parent = item.parentId ? actions.relations.byId.get(item.parentId) : undefined;
  const opened = actions.expandedRelations.has(item.id);
  return <div className="bill-entry">
    {item.parentId && <div className="relation-caption"><span>{RELATION_NAMES[item.relation!]} · {parent && parent.date.slice(0, 7) !== item.date.slice(0, 7) ? "跨月关联" : parent && parent.date !== item.date ? "跨天关联" : "已关联"} · {item.date}</span>{parent ? <button onClick={() => actions.onReveal(parent.id)}>↗ 主账单：{displayTransaction(parent).title}</button> : <span>主账单尚未导入</span>}</div>}
    <BillRow item={item} groupId={groupId} selected={selected.has(item.id)} {...actions} />
    {children.length > 0 && <div className="relation-summary"><button aria-expanded={opened} onClick={() => actions.onExpandRelation(item.id)}>{opened ? "▾" : "▸"} {relatedTransactions(actions.relations, item.id).length - 1} 条关联记录 · 关联净花费 ¥{yuan(netExpense(relatedTransactions(actions.relations, item.id)))}</button><span>包含所有日期的关联记录</span></div>}
    {opened && children.length > 0 && <div className="attached-records">{children.map((child) => <BillEntry key={child.id} item={child} selected={selected} groupId={groupId && child.groupIds?.includes(groupId) ? groupId : undefined} {...actions} />)}</div>}
  </div>;
}

function BillRow({ item, groupId, selected, movingIds, dropRecordId, onToggle, onEdit, onAssign, onPointerStart, onPointerMove, onPointerFinish, onContextMenu }: BillRowActions & {
  item: Transaction; groupId?: string; selected: boolean;
}) {
  const display = displayTransaction(item);
  const sources = transactionSources(item).join(" · ");
  const suppressClick = useRef(false);
  return <div data-record-id={item.id} className={`detail-row${selected ? " is-selected" : ""}${!counts(item) ? " is-excluded" : ""}${movingIds.has(item.id) ? " is-moving" : ""}${dropRecordId === item.id ? " relation-drop-target" : ""}`} onContextMenu={(event) => onContextMenu(event, item, groupId)}>
    <button type="button" className="detail-select" aria-pressed={selected} aria-label={`${selected ? "取消勾选" : "勾选"} ${display.title}`} onClick={(event) => {
      if (!suppressClick.current || event.detail === 0) onToggle(item.id);
      suppressClick.current = false;
    }} onPointerDown={(event) => { suppressClick.current = false; onPointerStart(event, item); }} onPointerMove={onPointerMove} onPointerUp={(event) => { suppressClick.current = onPointerFinish(event); }} onPointerCancel={(event) => { suppressClick.current = onPointerFinish(event, true); }}>
      <span className="drag-handle" aria-hidden="true">⠿</span>
      <span className="row-check" aria-hidden="true">{selected ? "✓" : ""}</span>
      <span className="detail-content">
        <span className="category-icon" style={{ color: CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.其他 }}>{initials(item.category)}</span>
        <span className="transaction-main"><strong>{display.title}</strong><small>{display.merchant ? `${display.merchant} · ` : ""}{item.category} · {KIND_NAMES[item.kind]}{!counts(item) ? " · 不计入" : ""}</small><small className="transaction-source" title={`来源：${sources}`}>来源：{sources}</small>{item.tags?.length ? <span className="tag-list">{item.tags.map((name) => <em key={name}>#{name}</em>)}</span> : null}</span>
        <b className={item.kind === "refund" || item.kind === "income" ? "positive" : ""}>{item.kind === "refund" || item.kind === "income" ? "+" : "−"} ¥{yuan(item.amount)}</b>
      </span>
    </button>
    <div className="row-actions"><button type="button" onClick={() => onEdit(item)} aria-label={`编辑 ${display.title}`}>编辑</button>{groupId && <button type="button" onClick={() => onAssign([item.id], groupId, true)} aria-label={`将 ${display.title} 移出分组`}>移出</button>}</div>
  </div>;
}

function LinkDialog({ items, request, onClose, onLink }: { items: Transaction[]; request: { ids: string[]; parentId: string }; onClose: () => void; onLink: (parentId: string, relation: RelationKind) => void }) {
  const [parentId, setParentId] = useState(request.parentId);
  const [relation, setRelation] = useState<RelationKind>("followup");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const parent = items.find((item) => item.id === parentId);
  const selectedIds = new Set(request.ids);
  const candidates = items.filter((item) => !selectedIds.has(item.id) && [item.date, item.merchant, item.note].join(" ").toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  if (parent && !candidates.some((item) => item.id === parent.id)) candidates.unshift(parent);
  function submit(event: FormEvent) {
    event.preventDefault();
    try { onLink(parentId, relation); } catch (reason) { setError(reason instanceof Error ? reason.message : "关联失败"); }
  }
  return <Modal title="关联账单" onClose={onClose}><form className="editor-form relation-form" onSubmit={submit}><p>将 {request.ids.length} 条记录贴到主账单下面。日期、分组和计入状态保持不变。</p><label>查找主账单<input type="search" placeholder="搜索商品、商家或日期" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>主账单<select required value={parentId} onChange={(event) => { setParentId(event.target.value); setError(""); }}><option value="">选择主账单…</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.date} · {displayTransaction(item).title} · ¥{yuan(item.amount)}</option>)}</select></label>{parent && <div className="relation-parent-preview"><strong>{displayTransaction(parent).title}</strong><span>{parent.date} · {KIND_NAMES[parent.kind]} ¥{yuan(parent.amount)}</span></div>}<div className="relation-choices"><label aria-label="后续记录"><input type="radio" name="relation-kind" checked={relation === "followup"} onChange={() => setRelation("followup")} /><span><strong>后续记录</strong><small>退款、退票、改签等后续流水</small></span></label><label aria-label="附属消费"><input type="radio" name="relation-kind" checked={relation === "attachment"} onChange={() => setRelation("attachment")} /><span><strong>附属消费</strong><small>保险、配件、手续费等关联开支</small></span></label></div>{error && <p className="import-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button type="submit" className="primary" disabled={!parent}>确认关联</button></div></form></Modal>;
}

function DataView({ items, groups, month, onImport, onClear, onExport }: { items: Transaction[]; groups: PurposeGroup[]; month: string; onImport: () => void; onClear: () => void; onExport: (count: number) => void }) {
  const [scope, setScope] = useState<"month" | "range" | "all">("month");
  const [start, setStart] = useState(month);
  const [end, setEnd] = useState(month);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const validRange = scope !== "range" || start <= end;
  const selected = scope === "all" ? items : items.filter((item) => item.date.slice(0, 7) >= (scope === "month" ? month : start) && item.date.slice(0, 7) <= (scope === "month" ? month : end));
  const selectedGroups = validRange ? groupsInRange(groups, scope === "all" ? undefined : scope === "month" ? month : start, scope === "month" ? month : end) : [];

  async function exportSelected() {
    const suffix = scope === "all" ? "整本账本" : scope === "month" ? month : `${start}_至_${end}`;
    setExportError("");
    setExporting(true);
    try {
      if (await downloadBook(selected, `Koin账本_${suffix}.json`, selectedGroups)) onExport(selected.length);
    } catch (error) {
      setExportError(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(false);
    }
  }

  return <div className="data-page"><div className="view-heading"><div><span className="eyebrow">本机数据</span><h1>导入与备份</h1><p>由我整理 JSON，你导入查看；修改后再导出最终账本。</p></div></div><div className="data-grid"><section className="panel data-card"><span className="card-icon">↥</span><h2>导入 Koin JSON</h2><p>可一次导入一个或多个自然月。已有 ID 保留本机修改，只补入缺少的记录。</p><button className="primary" onClick={onImport}>选择 JSON 文件</button></section><section className="panel data-card"><span className="card-icon">↓</span><h2>导出整理后的 JSON</h2><p>包括补记和修改；导出的文件可重新导入 Koin。</p><div className="scope-options"><label><input type="radio" checked={scope === "month"} onChange={() => setScope("month")} /> 当前月份</label><label><input type="radio" checked={scope === "range"} onChange={() => setScope("range")} /> 连续多月</label><label><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> 整本账本</label></div>{scope === "range" && <div className="month-range"><label>从 <input type="month" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>到 <input type="month" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>}<div className="export-count">将导出 {validRange ? selected.length : 0} 条记录{!validRange ? " · 起始月份不能晚于结束月份" : ""}</div>{exportError && <p className="import-error" role="alert">{exportError}</p>}<button className="primary" disabled={!validRange || (!selected.length && !selectedGroups.length) || exporting} onClick={exportSelected}>{exporting ? "正在导出…" : "导出 JSON"}</button></section></div><section className="panel storage-note"><div><h2>本机账本</h2><p>当前保存 {items.length} 条记录。更换电脑或卸载前，请导出整本账本备份。</p></div><button onClick={onClear}>清空本机账本</button></section></div>;
}

function ImportDialog({ existing, groups, onClose, onComplete }: { existing: Transaction[]; groups: PurposeGroup[]; onClose: () => void; onComplete: (preview: ImportPreview) => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileNames, setFileNames] = useState("");
  const [error, setError] = useState("");

  async function readFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    setError(""); setPreview(null); setFileNames(files.map((file) => file.name).join("、"));
    try {
      const records: Transaction[] = [];
      let importedGroups: PurposeGroup[] = [];
      let invalid = 0; let total = 0;
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith(".json")) throw new Error(`${file.name} 不是 JSON 文件`);
        const parsed = readBook(JSON.parse(await file.text()));
        records.push(...parsed.transactions);
        importedGroups = mergeGroups(importedGroups, parsed.groups);
        invalid += parsed.invalid; total += parsed.total;
      }
      const plan = planImport(existing, { transactions: records, groups: importedGroups }, groups);
      setPreview({ ...plan, invalid: plan.invalid + invalid, total });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文件读取失败，请检查 JSON 格式");
    }
  }

  return <Modal title="导入 Koin JSON" onClose={onClose}><div className="import-dialog"><p>选择我整理好的 JSON，或之前从 Koin 导出的完整备份。可以同时选择多个文件。</p><label className="file-picker">选择 JSON 文件<input type="file" accept=".json,application/json" multiple onChange={readFiles} /></label>{fileNames && <small className="file-name">{fileNames}</small>}{error && <p className="import-error" role="alert">{error}</p>}{preview && <><div className="import-preview"><div><span>月份范围</span><strong>{preview.months.length ? `${formatMonth(preview.months[0])} — ${formatMonth(preview.months.at(-1)!)}` : "无有效记录"}</strong></div><div><span>新增</span><strong>{preview.added.length} 条</strong></div><div><span>重复 ID</span><strong>{preview.duplicates} 条</strong></div><div><span>无效记录</span><strong>{preview.invalid} 条</strong></div></div><p className="import-hint">重复 ID 保留 Koin 中的版本；无效记录不会导入。共读取 {preview.total} 条，新增 {preview.groups.length} 个用途分组。</p></>}<div className="modal-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!preview || (!preview.added.length && !preview.groups.length)} onClick={() => preview && onComplete(preview)}>确认导入</button></div></div></Modal>;
}

function Editor({ initial, month, onClose, onSave, onDelete }: { initial: Transaction | null; month: string; onClose: () => void; onSave: (item: Transaction) => void; onDelete?: () => void }) {
  const [form, setForm] = useState<Transaction>(initial ?? { id: crypto.randomUUID(), date: month === monthNow() ? dateNow() : `${month}-01`, merchant: "", amount: 0, category: "其他", kind: "expense", source: "手动", counted: true, tags: [] });
  const [tags, setTags] = useState((form.tags ?? []).join("、"));
  function change<K extends keyof Transaction>(field: K, value: Transaction[K]) { setForm((current) => ({ ...current, [field]: value })); }
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ ...form, merchant: form.merchant.trim(), tags: [...new Set(tags.split(/[、,，#\s]+/).map((item) => item.trim()).filter(Boolean))], counted: counts(form) });
  }
  return <Modal title={initial ? "编辑记录" : "补记一笔"} onClose={onClose}><form className="editor-form" onSubmit={submit}><div className="form-grid"><label>日期<input type="date" required value={form.date} onChange={(event) => change("date", event.target.value)} /></label><label>金额（元）<input type="number" required min="0.01" step="0.01" value={form.amount || ""} onChange={(event) => change("amount", Number(event.target.value))} /></label><label>类型<select value={form.kind} onChange={(event) => { const kind = event.target.value as Kind; setForm((current) => ({ ...current, kind, counted: kind === "repayment" || kind === "transfer" ? false : current.kind === "repayment" || current.kind === "transfer" ? true : current.counted })); }}>{(Object.keys(KIND_NAMES) as Kind[]).map((kind) => <option value={kind} key={kind}>{KIND_NAMES[kind]}</option>)}</select></label><label>分类<select value={form.category} onChange={(event) => change("category", event.target.value)}>{[...new Set([...CATEGORIES, form.category])].map((name) => <option key={name}>{name}</option>)}</select></label></div><label>商家<input required value={form.merchant} onChange={(event) => change("merchant", event.target.value)} placeholder="例如：美团" /></label><label>商品或用途<input value={form.note ?? ""} onChange={(event) => change("note", event.target.value)} placeholder="例如：晚餐" /></label><label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="例如：外卖、聚餐" /></label><label className="counted-toggle"><input type="checkbox" checked={counts(form)} onChange={(event) => change("counted", event.target.checked)} />计入统计</label><div className="modal-actions">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>删除</button>}<button type="button" className="secondary" onClick={onClose}>取消</button><button type="submit" className="primary">保存</button></div></form></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="关闭">×</button></header>{children}</section></div>;
}
