"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { CustomerShell } from "../components";
import { games } from "../data";

type CompanionOption = {
  id: string;
  nickname: string;
  game: string;
  games?: string[];
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
    const requestedCompanionId = new URLSearchParams(window.location.search).get("companion");
    const requestedCompanion = companionData.find((companion) => companion.id === requestedCompanionId);
    setCompanions(companionData);
    setCompanionId(requestedCompanion?.id ?? companionData[0]?.id ?? "");
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
  const canSubmit = !isSubmitting && totalAmount > 0 && priceConfigured && balanceAfter >= 0 && (assignmentType !== "DIRECT" || Boolean(companionId));

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
      <section className="maycat-order-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 md:p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
          <div>
            <div className="maycat-chip px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Maycat Order Console</div>
            <h1 className="maycat-text-glow mt-4 max-w-3xl text-3xl font-black leading-tight text-white md:text-5xl">
              提交订单，进入派单队列。
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-dfc-subtext md:text-base">
              选择游戏和服务方式，写清楚语音、段位、时间需求。金额由后端计算并冻结余额，管理员确认后进入派单或接单流程。
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            <OrderStep index="01" title="选游戏" desc={selectedGame?.name ?? game} active />
            <OrderStep index="02" title="定人选" desc={assignmentType === "DIRECT" ? selectedCompanion?.nickname || "指定陪玩" : "平台人工挑人"} active={Boolean(companionId) || assignmentType === "MATCH"} />
            <OrderStep index="03" title="确认金额" desc={priceConfigured ? `¥${formatMoney(String(totalAmount))}` : "待报价"} active={priceConfigured} />
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,760px)_320px]">
        <form onSubmit={submit} className="maycat-card p-4 md:p-5">
          <div className="flex flex-col gap-2 border-b border-cyan-300/15 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-white">订单信息</h2>
              <p className="mt-1 text-xs leading-5 text-dfc-muted">信息越明确，管理员越容易快速派到合适陪玩。</p>
            </div>
            <Link href="/companions" className="text-sm font-semibold text-cyan-300 hover:text-cyan-100">
              返回陪玩大厅
            </Link>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-cyan-50/80">游戏</span>
            <select value={game} onChange={(event) => setGame(event.target.value)} className="maycat-input mt-2 px-3 py-3 text-sm">
              {games.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} / {item.category}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={`maycat-choice ${assignmentType === "DIRECT" ? "maycat-choice-active" : ""}`}>
              <input name="assignmentType" type="radio" checked={assignmentType === "DIRECT"} onChange={() => setAssignmentType("DIRECT")} className="mt-1 accent-cyan-300" />
              <span className="text-sm font-black text-white">指定陪玩</span>
              <p className="mt-1 text-xs leading-5 text-dfc-subtext">选择具体陪玩下单，管理员确认后派给该陪玩。</p>
            </label>
            <label className={`maycat-choice ${assignmentType === "MATCH" ? "maycat-choice-active" : ""}`}>
              <input name="assignmentType" type="radio" checked={assignmentType === "MATCH"} onChange={() => setAssignmentType("MATCH")} className="mt-1 accent-cyan-300" />
              <span className="text-sm font-black text-white">平台人工挑人</span>
              <p className="mt-1 text-xs leading-5 text-dfc-subtext">没选好陪玩时提交需求，管理员按游戏、语音、预算人工匹配。</p>
            </label>
          </div>

          {assignmentType === "DIRECT" ? (
            <label className="mt-4 block">
              <span className="text-sm font-semibold text-cyan-50/80">陪玩</span>
              {companions.length ? (
                <select value={companionId} onChange={(event) => setCompanionId(event.target.value)} className="maycat-input mt-2 px-3 py-3 text-sm">
                  {companions.map((companion) => (
                    <option key={companion.id} value={companion.id}>
                      {companion.nickname} / {gameCountLabel(companion)} / {companion.deltaForceRank} / ¥{formatMoney(companion.pricePerHour)}/小时
                    </option>
                  ))}
                </select>
              ) : (
                <div className="maycat-inline-empty mt-2">
                  <div>
                    <div className="text-sm font-black text-white">当前游戏暂无上架陪玩</div>
                    <p className="mt-1 text-xs leading-5 text-dfc-subtext">可以先提交需求，由客服按语音、段位和预算人工匹配。</p>
                  </div>
                  <button type="button" onClick={() => setAssignmentType("MATCH")} className="maycat-button-secondary px-3 py-2 text-xs font-black">
                    改用人工挑人
                  </button>
                </div>
              )}
            </label>
          ) : null}

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-cyan-50/80">服务模式</span>
            <input value={mode} onChange={(event) => setMode(event.target.value)} className="maycat-input mt-2 px-3 py-3 text-sm" placeholder="例如：排位上分、娱乐陪玩、教学复盘、烽火地带" />
          </label>

          <div className="mt-4">
            <span className="text-sm font-semibold text-cyan-50/80">服务时长</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {["1", "2", "3"].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHours(value)}
                  className={`rounded-dfc-control border px-3 py-3 text-sm font-black transition ${
                    hours === value ? "border-cyan-300 bg-cyan-300/15 text-white" : "border-cyan-300/20 bg-[#07111f]/70 text-dfc-subtext hover:text-cyan-100"
                  }`}
                  aria-pressed={hours === value}
                >
                  {value} 小时
                </button>
              ))}
            </div>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-cyan-50/80">需求备注</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="maycat-input mt-2 min-h-32 resize-y px-3 py-3 text-sm" placeholder="例如：段位、服务器、语音要求、想打的模式、时间安排" />
          </label>

          <label className="mt-4 flex gap-3 rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/70 p-3">
            <input type="checkbox" checked={voiceTrialRequested} onChange={(event) => setVoiceTrialRequested(event.target.checked)} className="mt-1 accent-cyan-300" />
            <span>
              <span className="block text-sm font-black text-white">申请进入语音频道试音</span>
              <span className="mt-1 block text-xs leading-5 text-dfc-subtext">
                管理员派单后可创建临时 Discord/KOOK 语音房。试音只确认沟通体验，不代表订单开始或收益结算。
              </span>
            </span>
          </label>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          {status ? <Alert tone="success">{status}</Alert> : null}

          <button disabled={!canSubmit} className="maycat-button mt-5 w-full px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? "提交中..." : "确认下单"}
          </button>
        </form>

        <aside className="maycat-price-console p-4 lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-base font-black text-white">价格确认</h2>
          {selectedCompanion && assignmentType === "DIRECT" ? (
            <div className="mt-4 rounded-dfc-control border border-cyan-300/20 bg-cyan-300/10 p-3">
              <div className="text-xs text-dfc-muted">当前陪玩</div>
              <div className="mt-1 text-lg font-black text-white">{selectedCompanion.nickname}</div>
              <div className="mt-1 text-xs text-cyan-100/75">
                {selectedCompanion.deltaForceRank} · {selectedCompanion.voicePreference === "TEXT_ONLY" ? "仅文字" : "可语音"}
              </div>
            </div>
          ) : null}
          <div className="mt-4 space-y-3 text-sm">
            <Line label="游戏" value={selectedGame?.name ?? game} />
            <Line label={assignmentType === "MATCH" ? "人工挑人参考价" : "陪玩单价"} value={priceConfigured ? `¥${formatMoney(String(unitPrice))} / 小时` : "客服报价后确认"} />
            <Line label="选择时长" value={`${hours} 小时`} />
            <Line label="订单总价" value={priceConfigured ? `¥${formatMoney(String(totalAmount))}` : "待客服确认"} strong />
            <Line label="当前余额" value={`¥${formatMoney(String(availableBalance))}`} />
            <Line label="下单后余额" value={priceConfigured ? `¥${formatMoney(String(balanceAfter))}` : "待客服确认"} />
          </div>
          <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-xs leading-5 ${priceConfigured && balanceAfter >= 0 ? "border-dfc-success/40 bg-dfc-success/10 text-dfc-success" : "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger"}`}>
            {!priceConfigured ? "当前价格待定，请先联系客服确认报价或选择已上架陪玩。" : balanceAfter >= 0 ? "余额充足，可提交订单。最终金额以后端计算为准。" : "余额不足，请先充值。"}
          </div>
          {priceConfigured && balanceAfter < 0 ? (
            <Link href="/recharge" className="maycat-button-secondary mt-3 block px-4 py-3 text-center text-sm font-black">
              去充值
            </Link>
          ) : null}
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
      <span className={strong ? "text-lg font-black text-cyan-300" : "font-medium text-dfc-text"}>{value}</span>
    </div>
  );
}

function OrderStep({ index, title, desc, active }: { index: string; title: string; desc: string; active?: boolean }) {
  return (
    <div className={`rounded-dfc border px-3 py-3 ${active ? "border-cyan-300/35 bg-cyan-300/10" : "border-cyan-300/15 bg-[#07111f]/60"}`}>
      <div className="text-[11px] font-black text-fuchsia-300">{index}</div>
      <div className="mt-1 text-sm font-black text-white">{title}</div>
      <div className="mt-1 truncate text-xs text-dfc-subtext">{desc}</div>
    </div>
  );
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function gameCountLabel(companion: CompanionOption) {
  const count = companion.games?.length ?? 1;
  return count > 1 ? `${count} 个游戏` : "单游戏";
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
