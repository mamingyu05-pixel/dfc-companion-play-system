"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type Companion = {
  userId: string;
  email: string;
  nickname: string;
  avatarUrl?: string | null;
  game: string;
  games?: string[];
  status: string;
  onlineStatus: string;
  deltaForceRank: string;
  pricePerHour: string;
  kookPricePerHour?: string | null;
  discordPricePerHour?: string | null;
  commissionRate: string;
  availableIncome: string;
  pendingIncome: string;
  externalAccounts: Array<{
    platform: string;
    externalUserId: string;
    displayName?: string | null;
  }>;
};

export default function CompanionsPage() {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadCompanions() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/companions", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载陪玩列表");
    setCompanions((await response.json()) as Companion[]);
  }

  useEffect(() => {
    void loadCompanions().catch(() => setError("无法加载真实陪玩数据"));
  }, []);

  async function updateStatus(userId: string, nextStatus: "LISTED" | "UNLISTED" | "BANNED") {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/companions/${userId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: nextStatus })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message ?? "更新陪玩状态失败");
      return;
    }
    setStatus(`陪玩状态已更新为 ${toCompanionStatus(nextStatus)}`);
    await loadCompanions();
  }

  async function updateCommission(userId: string, commissionRate: string) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/companions/${userId}/commission`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ commissionRate })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }
    setStatus(`陪玩抽成已更新为 ${formatPercent(commissionRate)}`);
    await loadCompanions();
  }

  async function updatePricing(userId: string, pricePerHour: string, kookPricePerHour: string, discordPricePerHour: string) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/companions/${userId}/pricing`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pricePerHour,
        kookPricePerHour: kookPricePerHour || null,
        discordPricePerHour: discordPricePerHour || null
      })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }
    setStatus("陪玩平台价格已更新");
    await loadCompanions();
  }

  const stats = useMemo(() => {
    const listed = companions.filter((item) => item.status === "LISTED").length;
    const online = companions.filter((item) => item.onlineStatus === "ONLINE").length;
    const pendingIncome = companions.reduce((sum, item) => sum + Number(item.pendingIncome || 0), 0);
    return { listed, online, pendingIncome };
  }, [companions]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Companion Roster" title="陪玩管理" desc="管理真实陪玩资料、上架状态、价格、平台抽成比例和 KOOK / Discord 绑定。上架后客户才可下单。" />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="已上架" value={String(stats.listed)} hint="可被客户选择" tone="green" />
        <Signal label="当前在线" value={String(stats.online)} hint="派单优先队列" tone="cyan" />
        <Signal label="待结算收益" value={`¥${formatMoney(String(stats.pendingIncome))}`} hint="完成后进入钱包流水" tone="gold" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <DataTable
        columns={["ID", "资料", "游戏", "账号", "段位", "价格/抽成", "资料状态", "在线", "收益", "操作"]}
        rows={companions.map((item) => [
          shortId(item.userId),
          <div key={`${item.userId}-profile`} className="flex items-center gap-3">
            <SafeAvatar nickname={item.nickname} avatarUrl={item.avatarUrl} />
            <div>
              <div className="font-semibold text-white">{item.nickname}</div>
              <div className="mt-1 max-w-56 truncate text-xs text-dfc-muted">{platformSummary(item.externalAccounts)}</div>
            </div>
          </div>,
          gameNames(item.games?.length ? item.games : [item.game]),
          formatAccountEmail(item.email),
          item.deltaForceRank,
          <div key={`${item.userId}-pricing`} className="space-y-3">
            <CompanionPricingEditor
              pricePerHour={item.pricePerHour}
              kookPricePerHour={item.kookPricePerHour}
              discordPricePerHour={item.discordPricePerHour}
              onSave={(base, kook, discord) => void updatePricing(item.userId, base, kook, discord)}
            />
            <CompanionCommissionEditor pricePerHour={item.pricePerHour} commissionRate={item.commissionRate} onSave={(value) => void updateCommission(item.userId, value)} />
          </div>,
          <StatusBadge key={`${item.userId}-s`} tone={item.status === "LISTED" ? "success" : item.status === "BANNED" ? "danger" : "warning"}>{toCompanionStatus(item.status)}</StatusBadge>,
          <StatusBadge key={`${item.userId}-online`} tone={item.onlineStatus === "ONLINE" ? "success" : "default"}>{toOnlineStatus(item.onlineStatus)}</StatusBadge>,
          <div key={`${item.userId}-income`} className="text-xs leading-5">
            <div className="font-black text-dfc-gold">可提 ¥{formatMoney(item.availableIncome)}</div>
            <div className="text-dfc-muted">待结 ¥{formatMoney(item.pendingIncome)}</div>
          </div>,
          <div key={`${item.userId}-a`} className="flex flex-wrap gap-2">
            <ActionButton onClick={() => void updateStatus(item.userId, "LISTED")}>上架</ActionButton>
            <ActionButton tone="secondary" onClick={() => void updateStatus(item.userId, "UNLISTED")}>下架</ActionButton>
            <ActionButton tone="danger" onClick={() => void updateStatus(item.userId, "BANNED")}>封禁</ActionButton>
          </div>
        ])}
      />
    </AdminShell>
  );
}

function SafeAvatar({ nickname, avatarUrl }: { nickname: string; avatarUrl?: string | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-dfc border border-cyan-300/20 bg-[#101827] text-sm font-black text-cyan-200">
      {avatarUrl && !failed ? (
        <img src={avatarUrl} alt={`${nickname} 头像`} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        nickname.slice(0, 1)
      )}
    </div>
  );
}

function CompanionPricingEditor({
  pricePerHour,
  kookPricePerHour,
  discordPricePerHour,
  onSave
}: {
  pricePerHour: string;
  kookPricePerHour?: string | null;
  discordPricePerHour?: string | null;
  onSave: (pricePerHour: string, kookPricePerHour: string, discordPricePerHour: string) => void;
}) {
  const [base, setBase] = useState(pricePerHour);
  const [kook, setKook] = useState(kookPricePerHour ?? "");
  const [discord, setDiscord] = useState(discordPricePerHour ?? "");

  useEffect(() => {
    setBase(pricePerHour);
    setKook(kookPricePerHour ?? "");
    setDiscord(discordPricePerHour ?? "");
  }, [pricePerHour, kookPricePerHour, discordPricePerHour]);

  return (
    <div className="min-w-52 text-xs">
      <div className="grid gap-2">
        <PriceInput label="默认" value={base} onChange={setBase} />
        <PriceInput label="KOOK" value={kook} onChange={setKook} placeholder="沿用默认" />
        <PriceInput label="DC" value={discord} onChange={setDiscord} placeholder="沿用默认" />
      </div>
      <button type="button" onClick={() => onSave(base, kook, discord)} className="mt-2 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-2 py-1 font-black text-slate-950">
        保存价格
      </button>
    </div>
  );
}

function PriceInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-10 text-dfc-muted">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-28 rounded-dfc-control border border-cyan-300/20 bg-[#070d19] px-2 py-1 outline-none focus:shadow-dfc-focus" inputMode="decimal" />
    </label>
  );
}

function CompanionCommissionEditor({ pricePerHour, commissionRate, onSave }: { pricePerHour: string; commissionRate: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(commissionRate);
  return (
    <div className="min-w-44 text-xs">
      <div className="font-black text-dfc-gold">¥{formatMoney(pricePerHour)}/h</div>
      <div className="mt-2 flex items-center gap-2">
        <input value={value} onChange={(event) => setValue(event.target.value)} className="w-20 rounded-dfc-control border border-cyan-300/20 bg-[#070d19] px-2 py-1 outline-none focus:shadow-dfc-focus" inputMode="decimal" />
        <button type="button" onClick={() => onSave(value)} className="rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-2 py-1 font-black text-slate-950">
          保存
        </button>
      </div>
      <div className="mt-1 text-dfc-muted">平台抽成 {formatPercent(commissionRate)}</div>
    </div>
  );
}

function Signal({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "cyan" | "gold" | "green" }) {
  const styles = {
    cyan: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    gold: "border-dfc-gold/30 bg-dfc-gold/10 text-dfc-gold",
    green: "border-dfc-success/30 bg-dfc-success/10 text-dfc-success"
  };
  return (
    <div className={`rounded-dfc border p-4 ${styles[tone]}`}>
      <div className="text-xs font-black">{label}</div>
      <div className="mt-2 text-3xl font-black tabular-nums">{value}</div>
      <div className="mt-1 text-xs opacity-80">{hint}</div>
    </div>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function formatPercent(value: string) {
  return `${Math.round(Number(value || 0) * 10000) / 100}%`;
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function formatAccountEmail(email: string) {
  return email.endsWith("@oauth.maycatplay.local") ? "第三方注册" : email;
}

function platformSummary(accounts: Companion["externalAccounts"]) {
  if (!accounts.length) return "未绑定 KOOK / Discord";
  return accounts.map((account) => `${account.platform}:${account.displayName || account.externalUserId}`).join(" / ");
}

function toFriendlyError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("commissionRate cannot be greater than 1")) return "抽成比例不能大于 1，0.2 表示 20%";
  if (message.includes("commissionRate cannot be negative")) return "抽成比例不能小于 0";
  if (message.includes("commissionRate must be a valid amount")) return "请输入正确抽成比例，例如 0.2";
  return message;
}

function toCompanionStatus(status: string) {
  if (status === "LISTED") return "已上架";
  if (status === "UNLISTED") return "已下架";
  if (status === "BANNED") return "已封禁";
  return status;
}

function toOnlineStatus(status: string) {
  if (status === "ONLINE") return "在线";
  if (status === "BUSY") return "忙碌";
  if (status === "OFFLINE") return "离线";
  return status;
}

function gameName(code: string) {
  const names: Record<string, string> = {
    DELTA_FORCE: "三角洲行动",
    LEAGUE_OF_LEGENDS: "英雄联盟",
    VALORANT: "无畏契约",
    COUNTER_STRIKE_2: "CS2",
    PUBG: "PUBG",
    PUBG_MOBILE: "PUBG Mobile",
    APEX_LEGENDS: "Apex 英雄",
    NARAKA_BLADEPOINT: "永劫无间",
    HONOR_OF_KINGS: "王者荣耀",
    PEACEKEEPER_ELITE: "和平精英",
    DOTA_2: "Dota 2",
    OVERWATCH_2: "守望先锋 2",
    RAINBOW_SIX_SIEGE: "彩虹六号",
    ROCKET_LEAGUE: "火箭联盟",
    EA_SPORTS_FC: "EA Sports FC",
    STREET_FIGHTER_6: "街头霸王 6",
    CALL_OF_DUTY: "使命召唤",
    WILD_RIFT: "英雄联盟手游",
    MOBILE_LEGENDS: "Mobile Legends",
    MINECRAFT: "我的世界",
    GENSHIN_IMPACT: "原神",
    STEAM: "Steam 综合游戏"
  };
  return names[code] ?? code;
}

function gameNames(codes: string[]) {
  return codes.map(gameName).join(" / ");
}
