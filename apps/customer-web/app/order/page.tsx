"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { CustomerShell, SectionHeader } from "../components";
import { games } from "../data";

type CompanionOption = {
  id: string;
  nickname: string;
  game: string;
  onlineStatus: string;
  deltaForceRank: string;
  skillModes: string[];
  pricePerHour: string;
  voicePreference: string;
  bio?: string | null;
};

type WalletSummary = {
  wallet: { availableBalance: string } | null;
};

type PublicConfig = {
  pricing?: {
    platformMatchUnitPrice?: string | null;
  };
};

export default function OrderPage() {
  const [game, setGame] = useState("DELTA_FORCE");
  const [companions, setCompanions] = useState<CompanionOption[]>([]);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [assignmentType, setAssignmentType] = useState<"DIRECT" | "MATCH">("DIRECT");
  const [companionId, setCompanionId] = useState("");
  const [mode, setMode] = useState("排位/上分");
  const [hours, setHours] = useState("2");
  const [notes, setNotes] = useState("");
  const [voiceTrialRequested, setVoiceTrialRequested] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadData(selectedGame = game) {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;
    const [companionsResponse, walletResponse] = await Promise.all([
      fetch(`/api/orders/companions?game=${encodeURIComponent(selectedGame)}`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/wallet/customer-summary", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!companionsResponse.ok || !walletResponse.ok) throw new Error("无法加载下单数据");
    const companionData = (await companionsResponse.json()) as CompanionOption[];
    setCompanions(companionData);
    setCompanionId(companionData[0]?.id ?? "");
    setWallet((await walletResponse.json()) as WalletSummary);
  }

  useEffect(() => {
    const urlGame = new URLSearchParams(window.location.search).get("game");
    if (urlGame && games.some((item) => item.code === urlGame)) {
      setGame(urlGame);
      return;
    }
    void loadData(game).catch(() => setError("无法加载真实下单数据，请刷新页面"));
  }, []);

  useEffect(() => {
    void loadData(game).catch(() => setError("无法加载真实下单数据，请刷新页面"));
  }, [game]);

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
  }, []);

  const selectedGame = games.find((item) => item.code === game);
  const selectedCompanion = companions.find((item) => item.id === companionId);
  const platformMatchUnitPrice = Number(publicConfig.pricing?.platformMatchUnitPrice ?? 0);
  const unitPrice = assignmentType === "MATCH" ? platformMatchUnitPrice : Number(selectedCompanion?.pricePerHour ?? 0);
  const totalAmount = useMemo(() => unitPrice * Number(hours || 0), [hours, unitPrice]);
  const availableBalance = Number(wallet?.wallet?.availableBalance ?? 0);
  const balanceAfter = availableBalance - totalAmount;
  const priceConfigured = unitPrice > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");
    setIsSubmitting(true);

    const token = localStorage.getItem("dfc_customer_token");
    if (!token) {
      window.location.href = "/";
      return;
    }

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          game,
          mode,
          hours,
          companionId: assignmentType === "DIRECT" ? companionId : undefined,
          notes,
          voiceTrialRequested
        })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[]; orderNo?: string };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(toFriendlyError(message));
      }
      setStatus(`下单成功：${data.orderNo ?? ""}。订单已进入待派单/待接单流程。`);
      await loadData(game);
    } catch (err) {
      setError(err instanceof Error ? err.message : "下单失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <CustomerShell>
      <SectionHeader title="提交订单" desc="先选择游戏，再选择指定陪玩或平台人工匹配。金额由后端计算并冻结余额。" />

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <form onSubmit={submit} className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">订单信息</h2>

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">游戏</span>
            <select value={game} onChange={(event) => setGame(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              {games.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} / {item.category}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={`rounded-dfc-control border p-3 ${assignmentType === "DIRECT" ? "border-dfc-blue bg-dfc-blue/10" : "border-dfc-border bg-dfc-bg"}`}>
              <input name="assignmentType" type="radio" checked={assignmentType === "DIRECT"} onChange={() => setAssignmentType("DIRECT")} className="mr-2" />
              <span className="text-sm font-semibold text-dfc-blue">指定陪玩</span>
              <p className="mt-1 text-xs leading-5 text-dfc-subtext">选择具体陪玩下单，管理员确认后派给该陪玩。</p>
            </label>
            <label className={`rounded-dfc-control border p-3 ${assignmentType === "MATCH" ? "border-dfc-blue bg-dfc-blue/10" : "border-dfc-border bg-dfc-bg"}`}>
              <input name="assignmentType" type="radio" checked={assignmentType === "MATCH"} onChange={() => setAssignmentType("MATCH")} className="mr-2" />
              <span className="text-sm font-semibold">平台人工挑人</span>
              <p className="mt-1 text-xs leading-5 text-dfc-subtext">没选好陪玩时提交需求，管理员按游戏、语音、预算人工匹配。</p>
            </label>
          </div>

          {assignmentType === "DIRECT" ? (
            <label className="mt-4 block">
              <span className="text-sm text-dfc-subtext">陪玩</span>
              <select value={companionId} onChange={(event) => setCompanionId(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
                {companions.length ? (
                  companions.map((companion) => (
                    <option key={companion.id} value={companion.id}>
                      {companion.nickname} / {companion.deltaForceRank} / ¥{formatMoney(companion.pricePerHour)}/小时
                    </option>
                  ))
                ) : (
                  <option value="">当前游戏暂无上架陪玩，请选择平台人工挑人</option>
                )}
              </select>
            </label>
          ) : null}

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">服务模式</span>
            <input value={mode} onChange={(event) => setMode(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="例如：排位上分、娱乐陪玩、教学复盘、烽火地带" />
          </label>

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">服务时长</span>
            <select value={hours} onChange={(event) => setHours(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              <option value="1">1 小时</option>
              <option value="2">2 小时</option>
              <option value="3">3 小时</option>
            </select>
          </label>

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">需求备注</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 min-h-28 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="例如：段位、服务器、语音要求、想打的模式、时间安排" />
          </label>

          <label className="mt-4 flex gap-3 rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
            <input type="checkbox" checked={voiceTrialRequested} onChange={(event) => setVoiceTrialRequested(event.target.checked)} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold">申请进入语音频道试音</span>
              <span className="mt-1 block text-xs leading-5 text-dfc-subtext">
                管理员派单后可创建临时 Discord/KOOK 语音房。试音只确认沟通体验，不代表订单开始或收益结算。
              </span>
            </span>
          </label>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          {status ? <Alert tone="success">{status}</Alert> : null}

          <button disabled={isSubmitting || totalAmount <= 0 || !priceConfigured || (assignmentType === "DIRECT" && !companionId)} className="mt-5 w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
            {isSubmitting ? "提交中..." : "确认下单"}
          </button>
        </form>

        <aside className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">价格确认</h2>
          <div className="mt-4 space-y-3 text-sm">
            <Line label="游戏" value={selectedGame?.name ?? game} />
            <Line label={assignmentType === "MATCH" ? "人工挑人参考价" : "陪玩单价"} value={priceConfigured ? `¥${formatMoney(String(unitPrice))} / 小时` : "客服报价后确认"} />
            <Line label="选择时长" value={`${hours} 小时`} />
            <Line label="订单总价" value={priceConfigured ? `¥${formatMoney(String(totalAmount))}` : "待客服确认"} strong />
            <Line label="当前余额" value={`¥${formatMoney(String(availableBalance))}`} />
            <Line label="下单后余额" value={priceConfigured ? `¥${formatMoney(String(balanceAfter))}` : "待客服确认"} />
          </div>
          <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-xs ${priceConfigured && balanceAfter >= 0 ? "border-dfc-success/40 bg-dfc-success/10 text-dfc-success" : "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger"}`}>
            {!priceConfigured ? "当前价格待定，请先联系客服确认报价或选择已上架陪玩。" : balanceAfter >= 0 ? "余额充足，可提交订单。最终金额以后端计算为准。" : "余额不足，请先充值。"}
          </div>
          {priceConfigured && balanceAfter < 0 ? <Link href="/recharge" className="mt-3 inline-block text-sm font-semibold text-dfc-blue">去充值</Link> : null}
        </aside>
      </section>
    </CustomerShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-dfc-subtext">{label}</span>
      <span className={strong ? "text-lg font-semibold text-dfc-blue" : "font-medium text-dfc-text"}>{value}</span>
    </div>
  );
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function toFriendlyError(message?: string) {
  if (!message) return "下单失败，请检查订单信息";
  if (message.includes("Insufficient balance")) return "余额不足，请先充值";
  if (message.includes("Customer wallet does not exist")) return "客户钱包不存在，请联系客服";
  if (message.includes("Companion is not listed")) return "该陪玩未上架或不支持所选游戏";
  if (message.includes("PLATFORM_MATCH_UNIT_PRICE")) return "平台人工挑人价格未配置，请联系管理员";
  if (message.includes("hours must be a valid amount")) return "请输入正确的服务时长";
  return message;
}
