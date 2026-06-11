"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CompanionShell, MetricCard, SectionHeader } from "../components";

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

export default function WithdrawalsPage() {
  const [summary, setSummary] = useState<CompanionWalletSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadSummary() {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const response = await fetch("/api/wallet/companion-summary", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载提现数据");
    setSummary((await response.json()) as CompanionWalletSummary);
  }

  useEffect(() => {
    void loadSummary().catch(() => setError("无法加载提现数据，请刷新页面"));
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
      setPayoutAccount("");
      setNote("");
      setStatus("提现申请已提交，请等待管理员审核");
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  const wallet = summary?.wallet;

  return (
    <CompanionShell>
      <SectionHeader title="我的提现申请" desc="这里只显示当前陪玩账号的提现余额和提现记录。第一阶段由管理员审核后人工打款。" />
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <MetricCard label="可提现收益" value={`¥${formatMoney(wallet?.availableIncome ?? "0")}`} hint="当前账号可提现" />
        <MetricCard label="提现中" value={`¥${formatMoney(summary?.withdrawingAmount ?? "0")}`} hint="等待审核或打款" />
        <MetricCard label="冻结收益" value={`¥${formatMoney(wallet?.frozenIncome ?? "0")}`} hint="提现申请会先冻结" />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">我的提现记录</h2>
          <div className="mt-4 space-y-3">
            {summary?.withdrawalRequests.length ? (
              summary.withdrawalRequests.map((request) => (
                <div key={request.id} className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">¥{formatMoney(request.amount)}</div>
                    <div className="text-xs text-dfc-blue">{toWithdrawalStatus(request.status)}</div>
                  </div>
                  <div className="mt-1 text-xs text-dfc-subtext">{new Date(request.createdAt).toLocaleString("zh-CN")}</div>
                  {request.reviewNote ? <div className="mt-2 text-xs text-dfc-warning">审核备注：{request.reviewNote}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-subtext">
                当前账号还没有提现申请。
              </div>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">提交我的提现申请</h2>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">提现金额</span>
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder={`最多 ¥${formatMoney(wallet?.availableIncome ?? "0")}`}
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">收款账户</span>
            <input
              required
              value={payoutAccount}
              onChange={(event) => setPayoutAccount(event.target.value)}
              className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="填写收款方式和账号"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">备注</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 min-h-24 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            />
          </label>
          {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
          {status ? <div className="mt-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}
          <button disabled={isSubmitting} className="mt-5 w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
            {isSubmitting ? "提交中..." : "提交提现申请"}
          </button>
        </form>
      </section>
    </CompanionShell>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
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
  if (message.includes("payoutAccount is required")) return "请填写收款账户";
  if (message.includes("Insufficient available income")) return "可提现收益不足";
  return message;
}
