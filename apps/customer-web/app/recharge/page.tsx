"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { CustomerShell } from "../components";

const amountPresets = ["100", "300", "500", "1000"];

type RechargeSummary = {
  wallet: {
    availableBalance: string;
    frozenBalance: string;
  } | null;
  pendingRechargeAmount: string;
  rechargeRequests: Array<{
    id: string;
    amount: string;
    promotionBonus?: string | null;
    status: string;
    note?: string | null;
    reviewNote?: string | null;
    createdAt: string;
  }>;
};

type PublicConfig = {
  support?: {
    discordUrl?: string | null;
    kookUrl?: string | null;
    wechatId?: string | null;
    wechatQrUrl?: string | null;
  };
};

export default function RechargePage() {
  const [summary, setSummary] = useState<RechargeSummary | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [amount, setAmount] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [screenshotName, setScreenshotName] = useState("");
  const [note, setNote] = useState("");
  const [promotionCode, setPromotionCode] = useState("");
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

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
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
        body: JSON.stringify({ amount, screenshotUrl, note, promotionCode: promotionCode.trim() || undefined })
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
      setPromotionCode("");
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
  const canSubmit = !isSubmitting && Number(amount) > 0 && Boolean(screenshotUrl);

  return (
    <CustomerShell>
      <section className="maycat-recharge-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <div className="maycat-chip px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Maycat Wallet Dock</div>
            <h1 className="maycat-text-glow mt-5 max-w-3xl text-4xl font-black leading-tight text-white md:text-5xl">
              余额补给，等待人工确认。
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
              上传转账截图后进入管理员审核。审核通过才会入账，订单支付、退款和优惠赠送都会保留钱包记录。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <WalletMetric label="可用余额" value={`¥${formatMoney(availableBalance)}`} hint="当前账号钱包" />
            <WalletMetric label="审核中" value={`¥${formatMoney(pendingRechargeAmount)}`} hint="待管理员确认" />
            <WalletMetric label="到账方式" value="人工审核" hint="截图确认后入账" />
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <section className="maycat-card p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">充值记录</h2>
                <p className="mt-1 text-xs text-dfc-muted">审核状态、赠送金额和备注都会显示在这里。</p>
              </div>
              <span className="rounded-dfc-control border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100">
                {summary?.rechargeRequests.length ?? 0} 条
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {summary?.rechargeRequests.length ? (
                summary.rechargeRequests.map((request) => (
                  <article key={request.id} className="maycat-recharge-record">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xl font-black text-white">¥{formatMoney(request.amount)}</div>
                        <div className="mt-1 text-xs text-dfc-subtext">{new Date(request.createdAt).toLocaleString("zh-CN")}</div>
                      </div>
                      <span className={`rounded-dfc-control px-2 py-1 text-xs font-black ${statusClass(request.status)}`}>
                        {toRechargeStatus(request.status)}
                      </span>
                    </div>
                    {Number(request.promotionBonus || 0) > 0 ? (
                      <div className="mt-3 text-xs text-dfc-success">优惠赠送：¥{formatMoney(request.promotionBonus || "0")}</div>
                    ) : null}
                    {request.reviewNote ? <div className="mt-2 text-xs text-dfc-warning">审核备注：{request.reviewNote}</div> : null}
                  </article>
                ))
              ) : (
                <div className="rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 px-3 py-4 text-sm text-dfc-subtext">
                  当前账号还没有充值申请。提交第一笔充值后，审核进度会显示在这里。
                </div>
              )}
            </div>
          </section>

          <SupportPanel publicConfig={publicConfig} />
        </div>

        <form onSubmit={submit} className="maycat-card p-4 md:p-5 lg:sticky lg:top-24 lg:self-start">
          <div className="border-b border-cyan-300/15 pb-4">
            <h2 className="text-lg font-black text-white">提交充值申请</h2>
            <p className="mt-1 text-xs leading-5 text-dfc-muted">请确认金额和截图一致。不要上传包含密码、验证码或隐私信息的图片。</p>
          </div>

          <div className="mt-4">
            <span className="text-sm font-semibold text-cyan-50/80">充值金额</span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {amountPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset)}
                  className={`rounded-dfc-control border px-3 py-3 text-sm font-black transition ${
                    amount === preset ? "border-cyan-300 bg-cyan-300/15 text-white" : "border-cyan-300/20 bg-[#07111f]/70 text-dfc-subtext hover:text-cyan-100"
                  }`}
                  aria-pressed={amount === preset}
                >
                  ¥{preset}
                </button>
              ))}
            </div>
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="maycat-input mt-3 px-3 py-3 text-sm"
              placeholder="也可以手动输入金额"
            />
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-cyan-50/80">优惠码（选填）</span>
            <input
              value={promotionCode}
              onChange={(event) => setPromotionCode(event.target.value.toUpperCase().replace(/\s+/g, ""))}
              className="maycat-input mt-2 px-3 py-3 text-sm"
              placeholder="例如 NEW100"
              maxLength={32}
            />
            <span className="mt-2 block text-xs text-dfc-muted">符合满额条件的优惠码会在管理员审核通过充值时自动赠送余额。</span>
          </label>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-cyan-50/80">转账截图</span>
            <input className="sr-only" type="file" accept="image/*" onChange={handleScreenshot} />
            <div className={`maycat-upload-zone mt-2 ${screenshotName ? "maycat-upload-zone-ready" : ""}`}>
              <div className="text-sm font-black text-white">{screenshotName ? `已选择：${screenshotName}` : "点击上传转账截图"}</div>
              <div className="mt-2 text-xs leading-5 text-dfc-muted">支持图片格式，不超过 2MB。截图金额需要和申请金额一致。</div>
            </div>
          </label>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-cyan-50/80">备注</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="maycat-input mt-2 min-h-28 resize-y px-3 py-3 text-sm"
              placeholder="可填写付款账号、订单备注等"
            />
          </label>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          {status ? <Alert tone="success">{status}</Alert> : null}

          <button disabled={!canSubmit} className="maycat-button mt-5 w-full px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? "提交中..." : "提交审核"}
          </button>
        </form>
      </section>
    </CustomerShell>
  );
}

function SupportButton({ href, label }: { href?: string; label: string }) {
  if (!href) {
    return (
      <span className="rounded-dfc-control border border-cyan-300/15 bg-[#050711]/70 px-3 py-3 text-center text-sm font-semibold text-dfc-muted">
        {label}未配置
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="maycat-button px-3 py-3 text-center text-sm font-black"
    >
      {label}
    </a>
  );
}

function WalletMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-dfc border border-cyan-300/20 bg-[#07111f]/70 p-4 backdrop-blur">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 text-2xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 text-xs text-cyan-100/70">{hint}</div>
    </div>
  );
}

function SupportPanel({ publicConfig }: { publicConfig: PublicConfig }) {
  return (
    <section className="maycat-support-panel p-4">
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h2 className="text-lg font-black text-white">人工客服充值</h2>
          <p className="mt-2 text-sm leading-6 text-dfc-subtext">
            不会上传截图、转账备注填错、优惠码不确定，或者需要人工确认到账，可以联系人工客服。客服确认后仍需在本页提交充值申请，后台审核通过后才会入账。
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <SupportButton href={publicConfig.support?.kookUrl ?? undefined} label="KOOK 联系客服" />
            <SupportButton href={publicConfig.support?.discordUrl ?? undefined} label="Discord 联系客服" />
          </div>
          <div className="mt-4 rounded-dfc-control border border-cyan-300/25 bg-cyan-300/10 px-3 py-3 text-sm">
            <span className="text-dfc-subtext">VX 客服：</span>
            <span className="font-black text-cyan-200">{publicConfig.support?.wechatId || "暂未配置"}</span>
          </div>
        </div>

        <div className="rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 p-4">
          <div className="text-sm font-black text-white">微信扫码添加人工客服</div>
          <div className="mt-3 grid gap-4 sm:grid-cols-[160px_1fr] sm:items-center">
            {publicConfig.support?.wechatQrUrl ? (
              <img
                src={publicConfig.support.wechatQrUrl}
                alt="VX 客服二维码"
                className="h-40 w-40 rounded-dfc-control border border-cyan-300/20 bg-white object-cover p-2"
              />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center rounded-dfc-control border border-dashed border-cyan-300/20 bg-[#07111f]/70 px-4 text-center text-xs text-dfc-muted">
                暂未配置二维码
              </div>
            )}
            <div className="text-sm leading-6 text-dfc-subtext">
              <div>添加时请备注：注册邮箱 / 昵称 / 充值金额。</div>
              <div className="mt-2">截图金额、申请金额和备注信息越一致，审核越快。</div>
              <div className="mt-2 text-dfc-warning">不要把密码、验证码、后台 Token 发给任何人。</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
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

function statusClass(status: string) {
  if (status === "APPROVED") return "bg-dfc-success/10 text-dfc-success";
  if (status === "REJECTED") return "bg-dfc-danger/10 text-dfc-danger";
  return "bg-dfc-warning/10 text-dfc-warning";
}

function toChineseError(message?: string) {
  if (!message) return "提交失败，请检查填写内容";
  if (message.includes("amount must be a valid amount")) return "请输入正确的充值金额";
  if (message.includes("amount must be greater than 0")) return "充值金额必须大于 0";
  if (message.includes("screenshotUrl is required")) return "请上传转账截图";
  if (message.includes("screenshotUrl is too large")) return "截图太大，请压缩到 2MB 以内";
  if (message.includes("Promotion code is invalid")) return "优惠码无效或已停用";
  if (message.includes("Promotion code is expired")) return "优惠码已过期";
  if (message.includes("Promotion code usage limit reached")) return "优惠码已被用完";
  if (message.includes("Promotion code can only be used once per customer")) return "这个优惠码每个客户只能使用一次";
  if (message.includes("Recharge amount does not meet promotion code minimum")) return "充值金额未达到优惠码最低要求";
  if (message.includes("Promotion code has no bonus")) return "优惠码没有配置有效奖励";
  return message;
}
