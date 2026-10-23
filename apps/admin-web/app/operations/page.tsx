"use client";

import { useEffect, useState } from "react";
import { evidenceKindLabel, guaranteeProgressText, type OrderEvidenceView } from "@dfc/ui";
import { NotificationReconciliation } from "./notification-reconciliation";
import { LazyImage } from "../lazy-image";
import {
  AdminShell,
  DataTable,
  MetricCard,
  SectionHeader,
} from "../components";

type Evidence = {
  id: string;
  orderNo: string;
  store: string;
  game: string;
  tier: string;
  hours: string;
  paid: string;
  refund: string;
  platformFee: string;
  companionIncome: string;
  status: string;
  includedInRevenue: boolean;
};
type Report = {
  asOf: string;
  period: { from: string; to: string };
  formulas: Record<string, string>;
  financial: Record<string, string | number>;
  cohorts: Array<{
    key: string;
    sample: number;
    hours: string;
    serviceRevenue: string;
    grossCommission: string;
    orderIds: string[];
  }>;
  companionMetrics: Array<{
    id: string;
    name: string;
    sample: number;
    completed: number;
    completionDenominator: number;
    serviceHours: string;
    repeatCustomers: number;
    uniqueCustomers: number;
    verifiedComplaintOrders: number;
    avgServiceMinutes?: number | null;
    avgGuaranteeMinutes?: number | null;
    guaranteeCompleted?: number;
    blownRuns?: number;
    complaintRate?: number;
    qualityFlags?: string[];
    sampleWarning: string | null;
    orderIds: string[];
  }>;
  serviceMetrics: Array<{
    id: string;
    name: string;
    demands: number;
    paidDemands: number;
    pendingDemands: number;
    sampleWarning: string;
    draftIds: string[];
  }>;
  draftEvidence: Array<{
    id: string;
    draftNo: string;
    status: string;
    owner: string;
    createdAt: string;
    orderIds: string[];
  }>;
  exceptions: {
    totalOrders: number;
    orders: Array<{
      id: string;
      orderNo: string;
      status: string;
      owner: string;
      nextAction: string;
    }>;
    integrationJobs: Array<{
      id: string;
      kind: string;
      status: string;
      attempts: number;
      lastError: string | null;
    }>;
  };
  orderEvidence: Evidence[];
};
type Detail = {
  groupLedgerIncludesSiblingOrders: boolean;
  order: {
    id: string;
    orderNo: string;
    status: string;
    complaints: Array<{
      id: string;
      status: string;
      reason: string;
      resolution: string | null;
    }>;
    statusLogs: Array<{
      id: string;
      createdAt: string;
      reason: string;
      toStatus: string;
    }>;
  };
  transactions: Array<{
    id: string;
    type: string;
    direction: string;
    amount: string;
    balanceAfter: string;
    note: string;
  }>;
};
const statusName: Record<string, string> = {
  PAID: "待派单",
  ASSIGNED: "待接单",
  ACCEPTED: "已接单",
  IN_PROGRESS: "服务中",
  AWAITING_ACCEPTANCE: "待验收",
  DISPUTED: "争议待裁决",
  COMPLETED: "已完成",
  REFUNDED: "已退余额",
};

export default function OperationsPage() {
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [store, setStore] = useState("");
  const [game, setGame] = useState("");
  const [tier, setTier] = useState("");
  const [focus, setFocus] = useState<string[] | null>(null);
  const [draftFocus, setDraftFocus] = useState<string[] | null>(null);
  const [detail, setDetail] = useState<Detail>();
  const [evidence, setEvidence] = useState<OrderEvidenceView>();
  const [note, setNote] = useState("");
  const [refund, setRefund] = useState("");
  const [notice, setNotice] = useState("");

  async function api(path: string, options: RequestInit = {}) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) throw new Error("请先登录管理员账号");
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        Array.isArray(data.message)
          ? data.message.join("；")
          : data.message || "操作未完成，请重试",
      );
    return data;
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (from) query.set("from", `${from}T00:00:00Z`);
      if (to) query.set("to", `${to}T00:00:00Z`);
      if (store.trim()) query.set("store", store.trim());
      if (game) query.set("game", game);
      if (tier) query.set("tier", tier);
      setReport(await api(`/api/admin/operations?${query}`));
      setFocus(null);
      setDraftFocus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function inspect(id: string) {
    setError("");
    setNote("");
    setRefund("");
    setNotice("");
    setDetail(undefined);
    setEvidence(undefined);
    try {
      setDetail(await api(`/api/admin/operations/orders/${id}`));
      setEvidence(await api(`/api/orders/${id}/evidence`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取原单");
    }
  }
  async function resolve(disputed: boolean) {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api(
        disputed
          ? `/api/admin/orders/${detail.order.id}/resolve-dispute`
          : `/api/orders/${detail.order.id}/confirm-completion`,
        {
          method: "PATCH",
          body: JSON.stringify({
            note,
            ...(disputed ? { refundAmount: refund } : {}),
          }),
        },
      );
      setNotice("已记录裁决与资金分录，可在原单核对。");
      setDetail(await api(`/api/admin/operations/orders/${detail.order.id}`));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，未确认完成");
    } finally {
      setBusy(false);
    }
  }
  const money = (key: string) => `¥${report?.financial[key] ?? "—"}`;
  const showOrders = (ids: string[]) => {
    setFocus(ids);
    document
      .getElementById("order-evidence")
      ?.scrollIntoView({ behavior: "smooth" });
  };
  const drill = (ids: string[]) => (
    <button className="text-cyan-200 underline" onClick={() => showOrders(ids)}>
      查看 {ids.length} 单
    </button>
  );
  const rows =
    report?.orderEvidence.filter((o) => !focus || focus.includes(o.id)) ?? [];

  return (
    <AdminShell>
      <SectionHeader
        title="店长经营总览"
        eyebrow="Operations & Evidence"
        desc="先看待办，再核对账务与服务表现。每项统计公开口径，并能回到原单；不生成自动绩效处分。"
      />
      <form
        className="admin-panel mb-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <Field label="起始日（UTC）">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="结束日（不含，UTC）">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="门店归属">
          <input
            placeholder="全部；MAIN / UNASSIGNED"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          />
        </Field>
        <Field label="游戏">
          <select value={game} onChange={(e) => setGame(e.target.value)}>
            <option value="">全部</option>
            {[
              "DELTA_FORCE",
              "LEAGUE_OF_LEGENDS",
              "VALORANT",
              "COUNTER_STRIKE_2",
              "PUBG",
              "APEX_LEGENDS",
              "NARAKA_BLADEPOINT",
              "CALL_OF_DUTY",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
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
        <p
          role="alert"
          className="mb-4 rounded border border-red-300 p-3 text-red-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 text-green-200">
          {notice}
        </p>
      )}
      {report && (
        <>
          <p className="mb-4 text-xs text-dfc-muted">
            数据快照 {new Date(report.asOf).toLocaleString("zh-CN")} ·{" "}
            {report.period.from.slice(0, 10)} 至 {report.period.to.slice(0, 10)}
            （结束不含）
          </p>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              label="已验收净服务收入"
              value={money("serviceRevenue")}
              hint={`${report.financial.recognizedOrderCount} 单；实付减订单退款`}
            />
            <MetricCard
              label="平台毛佣金"
              value={money("grossCommission")}
              hint="已确认订单分配的平台份额"
            />
            <MetricCard
              label="已知直接成本后贡献"
              value={money("knownCostContribution")}
              hint="扣订单推荐佣金；不代表净利润"
            />
            <MetricCard
              label="陪玩待结算"
              value={money("companionPending")}
              hint="全平台快照；未验收不能提现"
            />
          </div>
          <section className="admin-panel mt-5">
            <h2 className="mb-3 text-lg font-bold">账务核对</h2>
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <p>
                期间充值本金：{money("rechargePrincipal")}（预付余额，不是收入）
              </p>
              <p>
                期间退回平台余额：{money("refundToPlatformBalance")}
                （非对外退款）
              </p>
              <p>
                客户可用 / 冻结：{money("customerAvailable")} /{" "}
                {money("customerFrozen")}
              </p>
              <p>
                陪玩已确认 / 提现冻结：
                {money("companionAvailableBeforeDisputeReserve")} /{" "}
                {money("companionWithdrawalFrozen")}
              </p>
              <p>
                冻结钱包与未结订单差额：
                <strong
                  className={
                    report.financial.frozenReconciliationDifference === "0.00"
                      ? "text-green-200"
                      : "text-red-200"
                  }
                >
                  {money("frozenReconciliationDifference")}
                </strong>
              </p>
              <p>
                历史完成但无验收记录：
                {report.financial.historicalUnverifiedCount} 单，待核实
              </p>
              <p>
                已验收收入中申诉待复核：{money("recognizedRevenueUnderReview")}
                （未裁决前不冲销）
              </p>
            </div>
            <p className="mt-3 text-xs text-dfc-muted">
              已确认收益仍需扣除关联未决投诉预留后才可提现；流水是全平台范围。
            </p>
          </section>
          <section className="admin-panel mt-5">
            <h2 className="mb-3 text-lg font-bold">
              异常待办 · {report.exceptions.totalOrders} 单
            </h2>
            <p className="mb-3 text-xs text-dfc-muted">
              按最久未更新优先，最多显示100单。点订单查看分录、证据和下一步。
            </p>
            <DataTable
              columns={["订单", "当前状态", "责任人", "下一步"]}
              rows={report.exceptions.orders.map((o) => [
                <button
                  className="text-cyan-200 underline"
                  key={o.id}
                  onClick={() => void inspect(o.id)}
                >
                  {o.orderNo}
                </button>,
                statusName[o.status] || o.status,
                o.owner,
                o.nextAction,
              ])}
            />
            {report.exceptions.integrationJobs.length > 0 && (
              <details className="mt-4">
                <summary>
                  通知与事件异常 {report.exceptions.integrationJobs.length}{" "}
                  条（最多50条，需人工复核）
                </summary>
                <DataTable
                  columns={["任务", "状态", "尝试", "错误类别"]}
                  rows={report.exceptions.integrationJobs.map((j) => [
                    j.kind,
                    j.status,
                    String(j.attempts),
                    j.lastError || "尚未处理",
                  ])}
                />
              </details>
            )}
          </section>
          <section className="admin-panel mt-5">
            <h2 className="mb-3 text-lg font-bold">
              按门店、游戏、价档、单价和工时比较
            </h2>
            <DataTable
              columns={[
                "同组条件",
                "样本",
                "工时",
                "净服务收入",
                "毛佣金",
                "原单",
              ]}
              rows={report.cohorts.map((c) => [
                c.key,
                String(c.sample),
                c.hours,
                `¥${c.serviceRevenue}`,
                `¥${c.grossCommission}`,
                drill(c.orderIds),
              ])}
            />
          </section>
          <section className="admin-panel mt-5">
            <h2 className="mb-3 text-lg font-bold">陪玩服务表现</h2>
            <DataTable
              columns={[
                "陪玩",
                "有效完成/样本",
                "服务工时",
                "平均结单",
                "保底平均结单",
                "炸单",
                "投诉率",
                "复购客/独立客",
                "已核实投诉单",
                "提示",
                "原单",
              ]}
              rows={report.companionMetrics.map((c) => [
                c.name,
                `${c.completed}/${c.completionDenominator}`,
                c.serviceHours,
                c.avgServiceMinutes != null ? `${c.avgServiceMinutes} 分钟` : "—",
                c.avgGuaranteeMinutes != null ? `${c.avgGuaranteeMinutes} 分钟 · ${c.guaranteeCompleted ?? 0} 单` : "—",
                c.guaranteeCompleted ? `${c.blownRuns ?? 0} 次` : "—",
                c.complaintRate != null ? `${Math.round(c.complaintRate * 100)}%` : "—",
                `${c.repeatCustomers}/${c.uniqueCustomers}`,
                String(c.verifiedComplaintOrders),
                c.qualityFlags?.length
                  ? <span className="font-bold text-dfc-danger">{c.qualityFlags.join("；")}</span>
                  : c.sampleWarning || "请在相同分组内比较",
                drill(c.orderIds),
              ])}
            />
          </section>
          <section className="admin-panel mt-5">
            <h2 className="mb-3 text-lg font-bold">客服需求处理</h2>
            <DataTable
              columns={[
                "负责人",
                "有效付费/需求",
                "待处理",
                "响应时长与样本",
                "依据",
              ]}
              rows={report.serviceMetrics.map((c) => [
                c.name,
                `${c.paidDemands}/${c.demands}`,
                String(c.pendingDemands),
                c.sampleWarning,
                <button
                  key={c.id}
                  className="text-cyan-200 underline"
                  onClick={() => setDraftFocus(c.draftIds)}
                >
                  查看需求
                </button>,
              ])}
            />
            <p className="mt-3 text-xs text-dfc-muted">
              全店草稿负责人归属；转接与离岗时间尚未采集。本表不作为薪酬或任用自动决策。
            </p>
            {draftFocus && (
              <DataTable
                columns={["需求单", "状态", "负责人", "创建时间", "关联订单"]}
                rows={report.draftEvidence
                  .filter((d) => draftFocus.includes(d.id))
                  .map((d) => [
                    d.draftNo,
                    d.status,
                    d.owner,
                    new Date(d.createdAt).toLocaleString("zh-CN"),
                    <span key={d.id}>
                      {d.orderIds.map((id) => (
                        <button
                          key={id}
                          className="mr-3 text-cyan-200 underline"
                          onClick={() => void inspect(id)}
                        >
                          {id.slice(-8)}
                        </button>
                      ))}
                    </span>,
                  ])}
              />
            )}
          </section>
          <details className="admin-panel mt-5">
            <summary className="cursor-pointer font-bold">
              统计公式、范围与申诉
            </summary>
            {Object.values(report.formulas).map((text) => (
              <p className="mt-3 text-sm text-dfc-subtext" key={text}>
                {text}
              </p>
            ))}
            <p className="mt-3 text-sm">
              有异议时保留原单编号，由管理员从“投诉”记录申诉及复核结论。
            </p>
          </details>
          <section className="admin-panel mt-5" id="order-evidence">
            <h2 className="mb-3 text-lg font-bold">
              原单与计算依据{" "}
              {focus && (
                <button
                  className="ml-3 text-sm text-cyan-200"
                  onClick={() => setFocus(null)}
                >
                  清除下钻筛选
                </button>
              )}
            </h2>
            <DataTable
              columns={[
                "订单",
                "门店 / 游戏",
                "状态",
                "实付",
                "退款",
                "佣金 / 陪玩",
                "计入收入",
              ]}
              rows={rows.map((o) => [
                <button
                  key={o.id}
                  className="text-cyan-200 underline"
                  onClick={() => void inspect(o.id)}
                >
                  {o.orderNo}
                </button>,
                `${o.store} / ${o.game}`,
                statusName[o.status] || o.status,
                o.paid,
                o.refund,
                `${o.platformFee} / ${o.companionIncome}`,
                o.includedInRevenue ? "是" : "否，见状态与口径",
              ])}
            />
          </section>
        </>
      )}
      <NotificationReconciliation />
      {detail && (
        <section className="admin-panel mt-5" aria-label="订单证据">
          <h2 className="mb-3 text-lg font-bold">
            {detail.order.orderNo} ·{" "}
            {statusName[detail.order.status] || detail.order.status}
          </h2>
          {detail.groupLedgerIncludesSiblingOrders && (
            <p className="mb-3 text-sm text-amber-200">
              此订单属于组合单，下方 ORDER_GROUP
              流水包含同组其他订单，不能全部归入本单。
            </p>
          )}
          {evidence && evidence.evidence.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 font-bold">服务凭证</h3>
              {evidence.progress && (
                <p className={evidence.progress.reached ? "mb-2 text-green-200" : "mb-2 text-amber-200"}>
                  {guaranteeProgressText(evidence.targetWan, evidence.progress)}
                </p>
              )}
              <DataTable
                columns={["时间", "类型", "仓库（万）", "上传方", "凭证", "备注"]}
                rows={evidence.evidence.map((e) => [
                  new Date(e.createdAt).toLocaleString("zh-CN"),
                  evidenceKindLabel[e.kind],
                  e.vaultValueWan ?? "—",
                  e.uploader,
                  <span key={e.id} className="flex gap-2">
                    {e.hasImage && <LazyImage path={`/api/orders/${encodeURIComponent(evidence.orderId)}/evidence/${encodeURIComponent(e.id)}/image`} field="imageUrl" label="查看截图" />}
                    {e.linkUrl && <a className="text-cyan-200 underline" href={e.linkUrl} target="_blank" rel="noopener noreferrer">录屏</a>}
                  </span>,
                  e.note || "—",
                ])}
              />
            </div>
          )}
          {detail.order.complaints.length > 0 && (
            <DataTable
              columns={["投诉 / 申诉编号", "状态", "问题描述", "人工处理结论"]}
              rows={detail.order.complaints.map((c) => [
                c.id,
                c.status,
                c.reason,
                c.resolution || "待复核",
              ])}
            />
          )}
          <DataTable
            columns={["分录", "方向", "金额", "对应账户余额", "说明"]}
            rows={detail.transactions.map((t) => [
              t.type,
              t.direction,
              t.amount,
              t.balanceAfter,
              t.note,
            ])}
          />
          <DataTable
            columns={["时间", "状态", "依据"]}
            rows={detail.order.statusLogs.map((l) => [
              new Date(l.createdAt).toLocaleString("zh-CN"),
              statusName[l.toStatus] || l.toStatus,
              l.reason,
            ])}
          />
          {["AWAITING_ACCEPTANCE", "DISPUTED"].includes(
            detail.order.status,
          ) && (
            <div className="mt-4 grid gap-3">
              <label>
                人工核实的验收或裁决依据
                <textarea
                  className="mt-1 block w-full rounded border border-cyan-200/30 bg-slate-950 p-3"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {detail.order.status === "DISPUTED" && (
                <label>
                  明确退回客户平台余额的金额（元）
                  <input
                    className="ml-3 rounded bg-slate-950 p-2"
                    inputMode="decimal"
                    value={refund}
                    onChange={(e) => setRefund(e.target.value)}
                    placeholder="例如 40.00；不退款填 0"
                  />
                </label>
              )}
              <button
                className="justify-self-start rounded border border-amber-200 px-4 py-2 disabled:opacity-40"
                disabled={
                  busy ||
                  !note.trim() ||
                  (detail.order.status === "DISPUTED" && !refund)
                }
                onClick={() => void resolve(detail.order.status === "DISPUTED")}
              >
                {detail.order.status === "DISPUTED"
                  ? "按填写金额裁决并记账"
                  : "确认验收并释放待结算收益"}
              </button>
            </div>
          )}
        </section>
      )}
    </AdminShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs text-dfc-subtext [&_input]:rounded [&_input]:bg-slate-950 [&_input]:p-2 [&_select]:rounded [&_select]:bg-slate-950 [&_select]:p-2">
      {label}
      {children}
    </label>
  );
}
