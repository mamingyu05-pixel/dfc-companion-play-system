"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CompanionShell, MetricCard, SectionHeader, StatusBadge } from "../components";

type CompanionWalletSummary = {
  wallet: {
    availableIncome: string;
    pendingIncome: string;
    frozenIncome: string;
  } | null;
  withdrawingAmount: string;
  withdrawalRequests: Array<{
    id: string;
    amount: string;
    payoutAccount: string;
    status: string;
    note?: string | null;
    reviewNote?: string | null;
    payoutReference?: string | null;
    createdAt: string;
  }>;
};

type PayoutProfile = {
  payoutMethod?: string | null;
  payoutAccountName?: string | null;
  payoutAccountNo?: string | null;
  payoutQrCodeUrl?: string | null;
};

export default function WithdrawalsPage() {
  const [summary, setSummary] = useState<CompanionWalletSummary | null>(null);
  const [payoutProfile, setPayoutProfile] = useState<PayoutProfile | null>(null);
  const [amount, setAmount] = useState("");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadData() {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const [summaryResponse, payoutResponse] = await Promise.all([
      fetch("/api/wallet/companion-summary", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/wallet/companion-payout-profile", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!summaryResponse.ok) throw new Error("无法加载提现数据");
    const nextSummary = (await summaryResponse.json()) as CompanionWalletSummary;
    setSummary(nextSummary);

    if (payoutResponse.ok) {
      const nextPayout = (await payoutResponse.json()) as PayoutProfile;
      setPayoutProfile(nextPayout);
      setPayoutAccount(buildPayoutAccount(nextPayout));
    }
  }

  useEffect(() => {
    void loadData().catch(() => setError("无法加载提现数据，请刷新页面"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/companion/";
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/wallet/withdrawal-requests", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ amount, payoutAccount, note })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }

      setAmount("");
      setNote("");
      setStatus("提现申请已提交，请等待管理员审核。");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  const wallet = summary?.wallet;

  return (
    <CompanionShell>
      <SectionHeader eyebrow="Payout Desk" title="我的提现申请" desc="这里只显示当前陪玩账号的提现余额和记录。第一阶段由管理员审核后人工打款。" />
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <MetricCard label="可提现收益" value={`¥${formatMoney(wallet?.availableIncome ?? "0")}`} hint="当前账号可提交提现" tone="gold" />
        <MetricCard label="提现中" value={`¥${formatMoney(summary?.withdrawingAmount ?? "0")}`} hint="等待审核或打款" />
        <MetricCard label="冻结收益" value={`¥${formatMoney(wallet?.frozenIncome ?? "0")}`} hint="提现申请会先冻结" tone="green" />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="companion-card p-4">
          <h2 className="text-base font-black text-white">我的提现记录</h2>
          <div className="mt-4 space-y-3">
            {summary?.withdrawalRequests.length ? (
              summary.withdrawalRequests.map((request) => (
                <div key={request.id} className="companion-queue-item">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-lg font-black tabular-nums text-dfc-gold">¥{formatMoney(request.amount)}</div>
                    <StatusBadge tone={withdrawalTone(request.status)}>{toWithdrawalStatus(request.status)}</StatusBadge>
                  </div>
                  <div className="mt-1 text-xs text-dfc-subtext">{formatDateTime(request.createdAt)}</div>
                  <div className="mt-2 break-all text-xs text-dfc-muted">收款：{request.payoutAccount}</div>
                  {request.reviewNote ? <div className="mt-2 text-xs text-dfc-warning">审核备注：{request.reviewNote}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-dfc-control border border-cyan-300/15 bg-[#050711]/60 px-3 py-3 text-sm text-dfc-subtext">当前账号还没有提现申请。</div>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="companion-card p-4">
          <h2 className="text-base font-black text-white">提交提现申请</h2>
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-black text-dfc-muted">提现金额</span>
            <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="input" placeholder={`最多 ¥${formatMoney(wallet?.availableIncome ?? "0")}`} />
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-black text-dfc-muted">收款账户</span>
            <input required value={payoutAccount} onChange={(event) => setPayoutAccount(event.target.value)} className="input" placeholder="先到资料页设置支付宝收款资料" />
          </label>
          {!buildPayoutAccount(payoutProfile) ? (
            <div className="mt-3 rounded-dfc-control border border-dfc-warning/40 bg-dfc-warning/10 px-3 py-2 text-xs text-dfc-warning">
              你还没有保存支付宝资料，建议先到资料页填写，提现时会自动带出。
            </div>
          ) : null}
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-black text-dfc-muted">备注</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} className="input min-h-24" placeholder="例如：本次提现全部收益" />
          </label>
          {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
          {status ? <div className="mt-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}
          <button disabled={isSubmitting} className="mt-5 w-full rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60">
            {isSubmitting ? "提交中..." : "提交提现申请"}
          </button>
        </form>
      </section>
    </CompanionShell>
  );
}

function buildPayoutAccount(profile?: PayoutProfile | null) {
  if (!profile?.payoutAccountName || !profile.payoutAccountNo) return "";
  return `${profile.payoutMethod || "ALIPAY"}: ${profile.payoutAccountName} / ${profile.payoutAccountNo}`;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function withdrawalTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "PAID") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "PENDING" || status === "APPROVED") return "warning";
  return "default";
}

function toWithdrawalStatus(status: string) {
  if (status === "PENDING") return "审核中";
  if (status === "APPROVED") return "已批准";
  if (status === "REJECTED") return "已拒绝";
  if (status === "PAID") return "已打款";
  return status;
}

function toChineseError(message?: string) {
  if (!message) return "提交失败，请检查填写内容";
  if (message.includes("amount must be a valid amount")) return "请输入正确的提现金额";
  if (message.includes("amount must be greater than 0")) return "提现金额必须大于 0";
  if (message.includes("payoutAccount is required")) return "请填写收款账户，或先到资料页设置支付宝收款资料";
  if (message.includes("Insufficient available income")) return "可提现收益不足";
  return message;
}
