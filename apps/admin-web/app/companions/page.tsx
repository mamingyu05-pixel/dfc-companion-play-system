"use client";

import { useEffect, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type Companion = {
  userId: string;
  email: string;
  nickname: string;
  game: string;
  status: string;
  onlineStatus: string;
  deltaForceRank: string;
  pricePerHour: string;
  availableIncome: string;
  pendingIncome: string;
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

  return (
    <AdminShell>
      <SectionHeader title="陪玩管理" desc="真实陪玩资料。支持按游戏查看，并进行上架、下架、封禁。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <DataTable
        columns={["ID", "昵称", "游戏", "邮箱", "段位", "价格", "资料状态", "在线", "收益", "操作"]}
        rows={companions.map((item) => [
          item.userId,
          item.nickname,
          gameName(item.game),
          item.email,
          item.deltaForceRank,
          `¥${formatMoney(item.pricePerHour)}`,
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

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
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
