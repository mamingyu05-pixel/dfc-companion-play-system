"use client";

import { useEffect, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type Companion = {
  userId: string;
  email: string;
  nickname: string;
  avatarUrl?: string | null;
  game: string;
  status: string;
  onlineStatus: string;
  deltaForceRank: string;
  pricePerHour: string;
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
    setStatus(`陪玩状态已更新为 ${nextStatus}`);
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

  return (
    <AdminShell>
      <SectionHeader title="陪玩管理" desc="管理真实陪玩资料、上架状态、价格、平台抽成比例和 KOOK / Discord 绑定。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <DataTable
        columns={["ID", "资料", "游戏", "账号", "段位", "价格/抽成", "资料状态", "在线", "收益", "操作"]}
        rows={companions.map((item) => [
          item.userId,
          <div key={`${item.userId}-profile`} className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-dfc border border-dfc-border bg-dfc-elevated text-sm font-black text-dfc-blue">
              {item.avatarUrl ? <img src={item.avatarUrl} alt={`${item.nickname} 头像`} className="h-full w-full object-cover" /> : item.nickname.slice(0, 1)}
            </div>
            <div>
              <div className="font-medium text-dfc-text">{item.nickname}</div>
              <div className="mt-1 text-xs text-dfc-muted">{platformSummary(item.externalAccounts)}</div>
            </div>
          </div>,
          gameName(item.game),
          formatAccountEmail(item.email),
          item.deltaForceRank,
          <CompanionCommissionEditor
            key={`${item.userId}-commission`}
            pricePerHour={item.pricePerHour}
            commissionRate={item.commissionRate}
            onSave={(value) => void updateCommission(item.userId, value)}
          />,
          <StatusBadge key={`${item.userId}-s`} tone={item.status === "LISTED" ? "success" : item.status === "BANNED" ? "danger" : "warning"}>{item.status}</StatusBadge>,
          item.onlineStatus,
          `可提 ¥${formatMoney(item.availableIncome)} / 待结 ¥${formatMoney(item.pendingIncome)}`,
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

function CompanionCommissionEditor({
  pricePerHour,
  commissionRate,
  onSave
}: {
  pricePerHour: string;
  commissionRate: string;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(commissionRate);
  return (
    <div className="min-w-44 text-xs">
      <div>价格 ¥{formatMoney(pricePerHour)}/h</div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-20 rounded-dfc-control border border-dfc-border bg-dfc-bg px-2 py-1 outline-none focus:shadow-dfc-focus"
          inputMode="decimal"
        />
        <button type="button" onClick={() => onSave(value)} className="rounded-dfc-control bg-dfc-blue px-2 py-1 font-semibold text-slate-950">
          保存
        </button>
      </div>
      <div className="mt-1 text-dfc-muted">平台抽成 {formatPercent(commissionRate)}</div>
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
    GENSHIN_IMPACT: "原神"
  };
  return names[code] ?? code;
}
