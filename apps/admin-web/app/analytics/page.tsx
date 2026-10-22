"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell, DataTable, MetricCard, SectionHeader } from "../components";

type Ratio = { numerator: number; denominator: number; rate: number | null };
type Envelope = {
  asOf: string;
  period: { from: string; to: string };
  formulas: Record<string, string>;
};
type CustomerBoard = Envelope & {
  summary: {
    newCustomers: number;
    newCustomerRecharge: Ratio;
    newCustomerFirstOrder: Ratio;
    payingCustomers: number;
    repeatInPeriod: Ratio;
    returningCustomers: Ratio;
    orderCount: number;
    orderAmount: string;
    averageOrderAmount: string;
    amountPerPayingCustomer: string;
    rechargePrincipal: string;
    rechargeBonus: string;
    rechargeCount: number;
    balanceAvailable: string;
    balanceFrozen: string;
    customersWithBalance: number;
  };
  tierBreakdown: Array<{ key: string; orders: number; hours: string; amount: string }>;
  topCustomers: Array<{ id: string; name: string; orders: number; amount: string; returning: boolean; isNew: boolean }>;
  trend: Array<{ day: string; newCustomers: number; orders: number; orderAmount: string; rechargePrincipal: string }>;
};
type CompanionBoard = Envelope & {
  summary: {
    listedCompanions: number;
    onlineNow: number;
    busyNow: number;
    activeCompanions: number;
    orderCount: number;
    completedCount: number;
    serviceHours: string;
    companionIncome: string;
    platformFee: string;
    acceptMinutes: { sample: number; median: number | null; p90: number | null };
    complaintOrders: Ratio;
    upheldComplaintOrders: Ratio;
    reviews: { count: number; averageStars: number | null };
    withdrawalRequested: string;
    withdrawalRequestedCount: number;
    withdrawalPaid: string;
    withdrawalPaidCount: number;
    withdrawalOpen: string;
    withdrawalOpenCount: number;
  };
  recruitment: { joined: number; byStatus: Record<string, number> };
  topCompanions: Array<{
    id: string;
    name: string;
    orders: number;
    completed: number;
    serviceHours: string;
    income: string;
    averageStars: number | null;
    complaintOrders: number;
    openComplaintOrders: number;
    repeatCustomers: number;
  }>;
  trend: Array<{ day: string; orders: number; serviceHours: string; companionIncome: string }>;
};
type Tab = "customers" | "companions";

const profileStatusName: Record<string, string> = {
  PENDING_REVIEW: "待审核",
  LISTED: "已上架",
  UNLISTED: "已下架",
  BANNED: "已封禁",
};
const pct = (r: Ratio) => (r.rate === null ? "—" : `${r.rate}%`);
const frac = (r: Ratio) => `${r.numerator} / ${r.denominator}`;
const minutes = (value: number | null) =>
  value === null ? "—" : value < 60 ? `${Math.round(value)} 分钟` : `${(value / 60).toFixed(1)} 小时`;

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("customers");
  const [customers, setCustomers] = useState<CustomerBoard>();
  const [companions, setCompanions] = useState<CompanionBoard>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [store, setStore] = useState("");
  const [tier, setTier] = useState("");

  async function api(path: string) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) throw new Error("请先登录管理员账号");
    const response = await fetch(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        Array.isArray(data.message)
          ? data.message.join("；")
          : data.message || "加载失败，请重试",
      );
    return data;
  }
  async function load(target: Tab = tab) {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (from) query.set("from", `${from}T00:00:00Z`);
      if (to) query.set("to", `${to}T00:00:00Z`);
      if (store.trim()) query.set("store", store.trim());
      if (tier) query.set("tier", tier);
      const data = await api(`/api/admin/analytics/${target}?${query}`);
      if (target === "customers") setCustomers(data);
      else setCompanions(data);
    } catch (e) {
      // Drop the stale board so a failed query never looks like current data.
      if (target === "customers") setCustomers(undefined);
      else setCompanions(undefined);
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load("customers");
  }, []);
  function switchTab(next: Tab) {
    setTab(next);
    if (next === "customers" ? !customers : !companions) void load(next);
  }

  const board = tab === "customers" ? customers : companions;

  return (
    <AdminShell>
      <SectionHeader
        title="客户 / 陪玩数据看板"
        eyebrow="Business Analytics"
        desc="只读经营趋势：拉新、转化、复购、供给与服务质量。财务确认收入和冻结对账请看「经营与绩效」。"
      />
      <div className="mb-4 flex gap-2" role="tablist">
        {(
          [
            ["customers", "客户看板"],
            ["companions", "陪玩看板"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => switchTab(key)}
            className={`rounded-dfc-control border px-4 py-2 text-sm font-black ${
              tab === key
                ? "border-cyan-300/60 bg-cyan-300 text-slate-950"
                : "border-cyan-300/20 bg-[#101827] text-dfc-subtext"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="admin-panel mb-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <Field label="起始日（UTC）">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="结束日（不含，UTC）">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="门店归属">
          <input
            placeholder="全部；MAIN / UNASSIGNED"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          />
        </Field>
        <Field label="服务价档">
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">全部</option>
            {["ENTERTAINMENT", "RANKED", "HIGH_RANKED", "CUSTOM"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <button
          disabled={busy}
          className="rounded border border-cyan-200 px-4 py-2 disabled:opacity-50"
        >
          {busy ? "查询中…" : "查询"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mb-4 rounded border border-red-300 p-3 text-red-200">
          {error}
        </p>
      )}
      {!board && !error && busy && <p className="text-sm text-dfc-muted">加载中…</p>}
      {board && (
        <p className="mb-4 text-xs text-dfc-muted">
          数据快照 {new Date(board.asOf).toLocaleString("zh-CN")} ·{" "}
          {board.period.from.slice(0, 10)} 至 {board.period.to.slice(0, 10)}（结束不含）
        </p>
      )}
      {tab === "customers" && customers && <CustomerView board={customers} />}
      {tab === "companions" && companions && <CompanionView board={companions} />}
      {board && (
        <details className="admin-panel mt-5 text-sm text-dfc-subtext">
          <summary className="cursor-pointer font-bold text-white">统计口径</summary>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {Object.values(board.formulas).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <p className="mt-3">
            对账请前往 <Link className="text-cyan-200 underline" href="/operations">经营与绩效</Link>。
          </p>
        </details>
      )}
    </AdminShell>
  );
}

function CustomerView({ board }: { board: CustomerBoard }) {
  const s = board.summary;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="新增客户" value={String(s.newCustomers)} hint={`首充 ${pct(s.newCustomerRecharge)} · 首单 ${pct(s.newCustomerFirstOrder)}`} />
        <MetricCard label="下单客户" value={String(s.payingCustomers)} hint={`期内复购 ${pct(s.repeatInPeriod)}（${frac(s.repeatInPeriod)}）`} />
        <MetricCard label="回头客占比" value={pct(s.returningCustomers)} hint={`${frac(s.returningCustomers)}；窗口前已有有效订单`} />
        <MetricCard label="下单额（扣退款）" value={`¥${s.orderAmount}`} hint={`${s.orderCount} 单 · 客单价 ¥${s.averageOrderAmount}`} />
        <MetricCard label="人均消费" value={`¥${s.amountPerPayingCustomer}`} hint="下单额 / 下单客户" />
        <MetricCard label="已审核充值本金" value={`¥${s.rechargePrincipal}`} hint={`${s.rechargeCount} 笔；预付余额，不是收入`} />
        <MetricCard label="充值赠送" value={`¥${s.rechargeBonus}`} hint="优惠码赠送金额" />
        <MetricCard label="客户余额（可用 / 冻结）" value={`¥${s.balanceAvailable}`} hint={`冻结 ¥${s.balanceFrozen} · ${s.customersWithBalance} 位有余额；当前快照`} />
      </div>
      <TrendPanel
        title="每日趋势"
        rows={board.trend}
        series={[
          { key: "orderAmount", label: "下单额", money: true },
          { key: "rechargePrincipal", label: "充值本金", money: true },
          { key: "orders", label: "订单数" },
          { key: "newCustomers", label: "新增客户" },
        ]}
      />
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <section className="admin-panel">
          <h2 className="mb-3 text-lg font-bold">消费 TOP 10</h2>
          <DataTable
            columns={["客户", "订单", "下单额", "标记"]}
            rows={board.topCustomers.map((c) => [
              c.name,
              c.orders,
              `¥${c.amount}`,
              [c.isNew && "新客", c.returning && "回头客"].filter(Boolean).join(" · ") || "—",
            ])}
          />
        </section>
        <section className="admin-panel">
          <h2 className="mb-3 text-lg font-bold">价档 / 模式对比</h2>
          <DataTable
            columns={["价档 / 模式", "订单", "时长", "下单额"]}
            rows={board.tierBreakdown.map((t) => [t.key, t.orders, `${t.hours}h`, `¥${t.amount}`])}
          />
        </section>
      </div>
    </>
  );
}

function CompanionView({ board }: { board: CompanionBoard }) {
  const s = board.summary;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="上架陪玩" value={String(s.listedCompanions)} hint={`当前在线 ${s.onlineNow} · 忙碌 ${s.busyNow}`} />
        <MetricCard label="期内接单陪玩" value={String(s.activeCompanions)} hint={`${s.orderCount} 单，已完成 ${s.completedCount}`} />
        <MetricCard label="完成服务时长" value={`${s.serviceHours}h`} hint={`陪玩收入 ¥${s.companionIncome} · 平台佣金 ¥${s.platformFee}`} />
        <MetricCard label="下单到接单" value={minutes(s.acceptMinutes.median)} hint={`中位数；P90 ${minutes(s.acceptMinutes.p90)} · 样本 ${s.acceptMinutes.sample} 单`} />
        <MetricCard label="投诉订单率" value={pct(s.complaintOrders)} hint={`${frac(s.complaintOrders)}；成立 ${pct(s.upheldComplaintOrders)}`} />
        <MetricCard label="客户评分" value={s.reviews.averageStars === null ? "—" : `${s.reviews.averageStars.toFixed(1)} 星`} hint={`${s.reviews.count} 条公开评价`} />
        <MetricCard label="期内提现申请" value={`¥${s.withdrawalRequested}`} hint={`${s.withdrawalRequestedCount} 笔；已打款 ¥${s.withdrawalPaid}（${s.withdrawalPaidCount} 笔）`} />
        <MetricCard label="待处理提现" value={`¥${s.withdrawalOpen}`} hint={`${s.withdrawalOpenCount} 笔待审核或待打款；当前快照`} />
      </div>
      <TrendPanel
        title="每日趋势"
        rows={board.trend}
        series={[
          { key: "orders", label: "订单数" },
          { key: "serviceHours", label: "完成时长" },
          { key: "companionIncome", label: "陪玩收入", money: true },
        ]}
      />
      <div className="mt-5 grid gap-5 xl:grid-cols-[2fr_1fr]">
        <section className="admin-panel">
          <h2 className="mb-3 text-lg font-bold">陪玩 TOP 10（按完成时长）</h2>
          <DataTable
            columns={["陪玩", "订单 / 完成", "时长", "收入", "评分", "投诉（未决）", "复购客户"]}
            rows={board.topCompanions.map((c) => [
              c.name,
              `${c.orders} / ${c.completed}`,
              `${c.serviceHours}h`,
              `¥${c.income}`,
              c.averageStars === null ? "—" : c.averageStars.toFixed(1),
              `${c.complaintOrders}（${c.openComplaintOrders}）`,
              c.repeatCustomers,
            ])}
          />
          <p className="mt-3 text-xs text-dfc-muted">
            仅供运营复核，不作为自动扣薪或任用依据；样本少于 10 单时请逐单核对。
          </p>
        </section>
        <section className="admin-panel">
          <h2 className="mb-3 text-lg font-bold">期内入驻 · {board.recruitment.joined} 人</h2>
          <DataTable
            columns={["当前状态", "人数"]}
            rows={Object.entries(board.recruitment.byStatus).map(([status, count]) => [
              profileStatusName[status] ?? status,
              count,
            ])}
          />
        </section>
      </div>
    </>
  );
}

function TrendPanel<T extends { day: string }>({
  title,
  rows,
  series,
}: {
  title: string;
  rows: T[];
  series: Array<{ key: keyof T & string; label: string; money?: boolean }>;
}) {
  const [active, setActive] = useState(series[0].key);
  const current = series.find((s) => s.key === active) ?? series[0];
  const values = rows.map((row) => Number(row[current.key]));
  const max = Math.max(...values, 0);
  const format = (v: number) => (current.money ? `¥${v.toFixed(2)}` : String(v));
  return (
    <section className="admin-panel mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="flex flex-wrap gap-2">
          {series.map((s) => (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              aria-pressed={s.key === current.key}
              className={`rounded-dfc-control border px-3 py-1 text-xs font-bold ${
                s.key === current.key
                  ? "border-cyan-300/60 text-cyan-100"
                  : "border-cyan-300/15 text-dfc-muted"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex h-40 items-end gap-[2px]" style={{ minWidth: rows.length * 8 }}>
          {rows.map((row, index) => (
            <div
              key={row.day}
              title={`${row.day} · ${current.label} ${format(values[index])}`}
              className="flex-1 rounded-t bg-cyan-300/70 hover:bg-cyan-200"
              style={{ height: max ? `${Math.max((values[index] / max) * 100, values[index] ? 2 : 0)}%` : 0 }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-xs text-dfc-muted">
        <span>{rows[0]?.day}</span>
        <span>
          合计 {format(values.reduce((a, b) => a + b, 0))} · 峰值 {format(max)}
        </span>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-dfc-subtext [&_input]:rounded [&_input]:bg-slate-950 [&_input]:p-2 [&_select]:rounded [&_select]:bg-slate-950 [&_select]:p-2">
      {label}
      {children}
    </label>
  );
}
