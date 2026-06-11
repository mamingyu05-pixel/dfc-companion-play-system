"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { CustomerShell, SectionHeader, StatCard } from "../components";

type RechargeSummary = {
  wallet: {
    availableBalance: string;
    frozenBalance: string;
  } | null;
  pendingRechargeAmount: string;
  rechargeRequests: Array<{
    id: string;
    amount: string;
    status: string;
    note?: string | null;
    reviewNote?: string | null;
    createdAt: string;
  }>;
};

export default function RechargePage() {
  const [summary, setSummary] = useState<RechargeSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [screenshotName, setScreenshotName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadSummary() {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;

    const response = await fetch("/api/wallet/customer-summary", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载钱包数据");
    setSummary((await response.json()) as RechargeSummary);
  }

  useEffect(() => {
    void loadSummary().catch(() => setError("无法加载你的充值数据，请刷新页面"));
  }, []);

  async function handleScreenshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请上传图片截图");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("截图不能超过 2MB");
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setScreenshotUrl(dataUrl);
    setScreenshotName(file.name);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    const token = localStorage.getItem("dfc_customer_token");
    if (!token) {
      window.location.href = "/customer/";
      return;
    }

    if (!screenshotUrl) {
      setError("请先上传转账截图");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/wallet/recharge-requests", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ amount, screenshotUrl, note })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }

      setAmount("");
      setScreenshotUrl("");
      setScreenshotName("");
      setNote("");
      setStatus("充值申请已提交，请等待管理员审核");
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  const availableBalance = summary?.wallet?.availableBalance ?? "0";
  const pendingRechargeAmount = summary?.pendingRechargeAmount ?? "0";

  return (
    <CustomerShell>
      <SectionHeader
        title="我的余额充值"
        desc="这是当前登录客户自己的充值页面。第一阶段采用人工审核充值，管理员审核通过后余额会增加。"
      />

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <StatCard label="我的当前可用余额" value={`¥${formatMoney(availableBalance)}`} hint="只统计当前账号钱包" />
        <StatCard label="我的审核中充值" value={`¥${formatMoney(pendingRechargeAmount)}`} hint="当前账号待审核充值" />
        <StatCard label="预计审核" value="人工处理" hint="管理员确认截图后入账" />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">我的充值记录</h2>
          <div className="mt-4 space-y-3">
            {summary?.rechargeRequests.length ? (
              summary.rechargeRequests.map((request) => (
                <div key={request.id} className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">¥{formatMoney(request.amount)}</div>
                    <div className="text-xs text-dfc-blue">{toRechargeStatus(request.status)}</div>
                  </div>
                  <div className="mt-1 text-xs text-dfc-subtext">{new Date(request.createdAt).toLocaleString("zh-CN")}</div>
                  {request.reviewNote ? <div className="mt-2 text-xs text-dfc-warning">审核备注：{request.reviewNote}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-subtext">
                当前账号还没有充值申请。
              </div>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">提交我的充值申请</h2>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">充值金额</span>
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="例如 300"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">转账截图</span>
            <input className="sr-only" type="file" accept="image/*" onChange={handleScreenshot} />
            <div className="mt-2 rounded-dfc border border-dashed border-dfc-border bg-dfc-bg px-4 py-8 text-center text-sm text-dfc-muted">
              {screenshotName ? `已选择：${screenshotName}` : "点击上传截图，图片不超过 2MB"}
            </div>
          </label>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">备注</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 min-h-24 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="可填写付款账号、订单备注等"
            />
          </label>
          {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
          {status ? <div className="mt-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}
          <button disabled={isSubmitting} className="mt-5 w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
            {isSubmitting ? "提交中..." : "提交审核"}
          </button>
        </form>
      </section>
    </CustomerShell>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("截图读取失败"));
    reader.readAsDataURL(file);
  });
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}

function toRechargeStatus(status: string) {
  if (status === "PENDING") return "审核中";
  if (status === "APPROVED") return "已通过";
  if (status === "REJECTED") return "已拒绝";
  return status;
}

function toChineseError(message?: string) {
  if (!message) return "提交失败，请检查填写内容";
  if (message.includes("amount must be a valid amount")) return "请输入正确的充值金额";
  if (message.includes("amount must be greater than 0")) return "充值金额必须大于 0";
  if (message.includes("screenshotUrl is required")) return "请上传转账截图";
  if (message.includes("screenshotUrl is too large")) return "截图太大，请压缩到 2MB 以内";
  return message;
}
