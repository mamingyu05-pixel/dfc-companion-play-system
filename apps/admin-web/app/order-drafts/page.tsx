"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  status: string;
  displayName: string;
};

type ServicePriceTier = "CUSTOM" | "ENTERTAINMENT" | "RANKED" | "HIGH_RANKED";

type Companion = {
  userId: string;
  nickname: string;
  email: string;
  game: string;
  games?: string[];
  status: string;
  onlineStatus: string;
  pricePerHour: string;
  kookPricePerHour?: string | null;
  discordPricePerHour?: string | null;
  entertainmentPricePerHour?: string | null;
  rankedPricePerHour?: string | null;
  highRankedPricePerHour?: string | null;
};

type OrderDraft = {
  id: string;
  draftNo: string;
  sourcePlatform: "WEB" | "DISCORD" | "KOOK";
  customerPlatformUserId?: string | null;
  customerDisplayName?: string | null;
  sourceChannelId?: string | null;
  voiceRoomId?: string | null;
  game: string;
  mode: string;
  hours?: string | null;
  priceTier: ServicePriceTier;
  budgetAmount?: string | null;
  status: string;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; email: string; displayName: string } | null;
  selectedCompanion?: { id: string; email: string; displayName: string } | null;
  convertedOrder?: { id: string; orderNo: string; status: string; totalAmount: string } | null;
  convertedOrderGroup?: {
    id: string;
    groupNo: string;
    companionCount: number;
    originalAmount: string;
    discountAmount: string;
    totalAmount: string;
    orders: Array<{ id: string; orderNo: string; status: string; totalAmount: string }>;
  } | null;
  candidates: Array<{
    id: string;
    status: string;
    note?: string | null;
    companion: {
      id: string;
      email: string;
      displayName: string;
      companionProfile: {
        nickname: string;
        avatarUrl?: string | null;
        pricePerHour: string;
        kookPricePerHour?: string | null;
        discordPricePerHour?: string | null;
        entertainmentPricePerHour?: string | null;
        rankedPricePerHour?: string | null;
        highRankedPricePerHour?: string | null;
        onlineStatus: string;
        status: string;
      } | null;
    };
  }>;
  events: Array<{
    id: string;
    actorType: string;
    eventType: string;
    content?: string | null;
    createdAt: string;
    actor?: { displayName: string; email: string } | null;
  }>;
};

type DispatchNotification = {
  platform: "DISCORD" | "KOOK";
  status: "SENT" | "FAILED" | string;
  messageId?: string;
  error?: string;
};

type PromotionSetting = {
  key: string;
  value: string;
};

type MultiCompanionDiscountConfig = {
  enabled: boolean;
  minCount: number;
  discountPerHour: number;
  floorPrice: number;
};

type DraftBill = {
  count: number;
  hours: number;
  originalAmount: number;
  discountAmount: number;
  totalAmount: number;
};

const gameOptions = [
  ["DELTA_FORCE", "三角洲行动"],
  ["LEAGUE_OF_LEGENDS", "英雄联盟"],
  ["VALORANT", "无畏契约"],
  ["COUNTER_STRIKE_2", "CS2"],
  ["PUBG", "PUBG 绝地求生"],
  ["APEX_LEGENDS", "Apex 英雄"],
  ["NARAKA_BLADEPOINT", "永劫无间"],
  ["CALL_OF_DUTY", "塔科夫 / COD"]
] as const;

const closedDraftStatuses = new Set(["CONVERTED", "CANCELLED"]);

function isClosedDraft(draft: Pick<OrderDraft, "status">) {
  return closedDraftStatuses.has(draft.status);
}

export default function OrderDraftsPage() {
  const [drafts, setDrafts] = useState<OrderDraft[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [selectedCompanionIds, setSelectedCompanionIds] = useState<string[]>([]);
  const [directCompanionIds, setDirectCompanionIds] = useState<string[]>([]);
  const [companionQuery, setCompanionQuery] = useState("");
  const [directCompanionQuery, setDirectCompanionQuery] = useState("");
  const [promotionSettings, setPromotionSettings] = useState<PromotionSetting[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({
    customerId: "",
    sourcePlatform: "KOOK" as "WEB" | "DISCORD" | "KOOK",
    customerDisplayName: "",
    customerPlatformUserId: "",
    sourceChannelId: "",
    voiceRoomId: "",
    game: "DELTA_FORCE",
    mode: "",
    hours: "",
    priceTier: "CUSTOM" as ServicePriceTier,
    budgetAmount: "",
    note: "",
    demandText: ""
  });

  async function loadData() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const [draftsResponse, usersResponse, companionsResponse, promotionSettingsResponse] = await Promise.all([
      fetch("/api/admin/order-drafts", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/companions", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/promotion-settings", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!draftsResponse.ok || !usersResponse.ok || !companionsResponse.ok || !promotionSettingsResponse.ok) throw new Error("load failed");
    const nextDrafts = (await draftsResponse.json()) as OrderDraft[];
    setDrafts(nextDrafts);
    setUsers((await usersResponse.json()) as AdminUser[]);
    setCompanions((await companionsResponse.json()) as Companion[]);
    setPromotionSettings((await promotionSettingsResponse.json()) as PromotionSetting[]);
    setSelectedDraftId((current) => {
      const currentDraft = nextDrafts.find((draft) => draft.id === current);
      if (currentDraft && !isClosedDraft(currentDraft)) return current;
      return nextDrafts.find((draft) => !isClosedDraft(draft))?.id || "";
    });
  }

  useEffect(() => {
    void loadData().catch(() => setError("无法加载试音派单数据，请确认管理员已登录"));
  }, []);

  const customers = users.filter((user) => user.role === "CUSTOMER" && user.status === "ACTIVE");
  const activeDrafts = useMemo(() => drafts.filter((draft) => !isClosedDraft(draft)), [drafts]);
  const hiddenClosedDraftCount = drafts.length - activeDrafts.length;
  const selectedDraft = activeDrafts.find((draft) => draft.id === selectedDraftId);
  const selectedDraftCompanionIds = useMemo(() => selectedDraft?.candidates.filter((candidate) => candidate.status === "SELECTED").map((candidate) => candidate.companion.id) ?? [], [selectedDraft]);
  const discountConfig = useMemo(() => buildDiscountConfig(promotionSettings), [promotionSettings]);
  const selectedDraftBill = useMemo(
    () => buildDraftBill(selectedDraft, selectedCompanionIds, discountConfig, companions),
    [selectedDraft, selectedCompanionIds.join("|"), discountConfig, companions]
  );
  const directListedCompanions = useMemo(() => {
    const keyword = directCompanionQuery.trim().toLowerCase();
    return companions.filter((companion) => {
      const companionGames = companion.games?.length ? companion.games : [companion.game];
      const matchesGame = companionGames.includes(form.game);
      const matchesKeyword = !keyword || [companion.nickname, companion.email].some((value) => value.toLowerCase().includes(keyword));
      return companion.status === "LISTED" && matchesGame && matchesKeyword;
    });
  }, [companions, form.game, directCompanionQuery]);
  const directPickerCompanions = useMemo(() => {
    const selectedFirst = directCompanionIds
      .map((id) => companions.find((companion) => companion.userId === id))
      .filter((companion): companion is Companion => Boolean(companion));
    const seen = new Set<string>();
    return [...selectedFirst, ...directListedCompanions]
      .filter((companion) => {
        if (seen.has(companion.userId)) return false;
        seen.add(companion.userId);
        return true;
      })
      .slice(0, 18);
  }, [companions, directListedCompanions, directCompanionIds.join("|")]);
  const directCompanionSummary = useMemo(() => {
    if (!directCompanionIds.length) return "尚未选择陪玩";
    return directCompanionIds.map((id) => companions.find((companion) => companion.userId === id)?.nickname ?? id).join(" / ");
  }, [companions, directCompanionIds.join("|")]);
  const directBill = useMemo(
    () => buildDirectBill({ hours: form.hours, priceTier: form.priceTier, sourcePlatform: form.sourcePlatform }, directCompanionIds, discountConfig, companions),
    [form.hours, form.priceTier, form.sourcePlatform, directCompanionIds.join("|"), discountConfig, companions]
  );
  const listedCompanions = useMemo(
    () => {
      const keyword = companionQuery.trim().toLowerCase();
      if (!selectedDraft) return [];
      return selectedDraft.candidates
        .filter((candidate) => candidate.companion.companionProfile)
        .map((candidate) => {
          const profile = candidate.companion.companionProfile!;
          return {
            userId: candidate.companion.id,
            nickname: profile.nickname || candidate.companion.displayName,
            email: candidate.companion.email,
            game: selectedDraft.game,
            games: [selectedDraft.game],
            status: profile.status,
            onlineStatus: profile.onlineStatus,
            pricePerHour: profile.pricePerHour,
            kookPricePerHour: profile.kookPricePerHour,
            discordPricePerHour: profile.discordPricePerHour,
            entertainmentPricePerHour: profile.entertainmentPricePerHour,
            rankedPricePerHour: profile.rankedPricePerHour,
            highRankedPricePerHour: profile.highRankedPricePerHour
          } satisfies Companion;
        })
        .filter((companion) => !keyword || [companion.nickname, companion.email].some((value) => value.toLowerCase().includes(keyword)));
    },
    [selectedDraft, companionQuery]
  );
  const multiPickerCompanions = useMemo(() => {
    const selectedFirst = selectedCompanionIds
      .map((id) => companions.find((companion) => companion.userId === id))
      .filter((companion): companion is Companion => Boolean(companion));
    const seen = new Set<string>();
    return [...selectedFirst, ...listedCompanions]
      .filter((companion) => {
        if (seen.has(companion.userId)) return false;
        seen.add(companion.userId);
        return true;
      })
      .slice(0, 18);
  }, [companions, listedCompanions, selectedCompanionIds.join("|")]);
  const selectedCompanionSummary = useMemo(() => {
    if (!selectedCompanionIds.length) return "尚未选择陪玩";
    return selectedCompanionIds
      .map((id) => companions.find((companion) => companion.userId === id)?.nickname ?? selectedDraft?.candidates.find((candidate) => candidate.companion.id === id)?.companion.companionProfile?.nickname ?? id)
      .join(" / ");
  }, [companions, selectedDraft, selectedCompanionIds.join("|")]);
  const stats = useMemo(() => {
    const open = activeDrafts.length;
    const converted = drafts.filter((draft) => draft.status === "CONVERTED").length;
    const candidates = activeDrafts.reduce((sum, draft) => sum + draft.candidates.length, 0);
    return { open, converted, candidates };
  }, [activeDrafts, drafts]);

  useEffect(() => {
    setSelectedCompanionIds(selectedDraftCompanionIds);
  }, [selectedDraftId, selectedDraftCompanionIds.join("|")]);

  useEffect(() => {
    setDirectCompanionIds((current) =>
      current.filter((id) => {
        const companion = companions.find((item) => item.userId === id);
        const companionGames = companion?.games?.length ? companion.games : companion ? [companion.game] : [];
        return companionGames.includes(form.game);
      })
    );
  }, [companions, form.game]);

  async function callApi<T>(path: string, options: RequestInit) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) throw new Error("请先登录管理员账号");
    setError("");
    setStatus("");
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      }
    });
    const data = (await response.json().catch(() => ({}))) as T & { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      throw new Error(toFriendlyError(message));
    }
    return data;
  }

  async function createDraftFromDemand() {
    try {
      const data = await callApi<{ draft: { id: string; draftNo?: string }; notifications?: DispatchNotification[] }>("/api/admin/order-drafts/from-demand", {
        method: "POST",
        body: JSON.stringify({
          customerId: form.customerId || undefined,
          sourcePlatform: form.sourcePlatform,
          customerDisplayName: form.customerDisplayName || undefined,
          customerPlatformUserId: form.customerPlatformUserId || undefined,
          sourceChannelId: form.sourceChannelId || undefined,
          voiceRoomId: form.voiceRoomId || undefined,
          demandText: form.demandText
        })
      });
      setSelectedDraftId(data.draft.id);
      setStatus(buildNotificationStatus(data.draft.draftNo, data.notifications));
      setForm((current) => ({ ...current, demandText: "" }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function createDirectOrder() {
    if (!form.customerId) {
      setError("请先选择已注册客户");
      return;
    }
    if (!form.mode.trim()) {
      setError("请填写服务模式");
      return;
    }
    if (!form.hours.trim()) {
      setError("请填写服务时长");
      return;
    }
    if (!directCompanionIds.length) {
      setError("请至少选择 1 个客户指定的陪玩");
      return;
    }

    try {
      const data = await callApi<{ orderGroup?: { groupNo?: string }; orders?: Array<{ orderNo: string }> }>("/api/admin/orders/direct", {
        method: "POST",
        body: JSON.stringify({
          customerId: form.customerId,
          companionIds: directCompanionIds,
          sourcePlatform: form.sourcePlatform,
          sourceChannelId: form.sourceChannelId || undefined,
          game: form.game,
          mode: form.mode,
          hours: form.hours,
          priceTier: form.priceTier,
          notes: form.note || undefined,
          voiceTrialRequested: false
        })
      });
      const groupNo = data.orderGroup?.groupNo;
      const firstOrderNo = data.orders?.[0]?.orderNo;
      setStatus(
        directCompanionIds.length > 1
          ? `已直接创建正式订单组 ${groupNo ?? ""}：${directCompanionIds.length} 个陪玩子订单。`
          : `已直接创建正式订单 ${firstOrderNo ?? groupNo ?? ""}。`
      );
      setDirectCompanionIds([]);
      setForm((current) => ({ ...current, mode: "", hours: "", budgetAmount: "", note: "" }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "直接成单失败");
    }
  }

  async function confirmDraft() {
    if (!selectedDraftId) return;
    try {
      await callApi(`/api/admin/order-drafts/${selectedDraftId}/confirm`, { method: "PATCH", body: JSON.stringify({}) });
      setStatus("已记录客户确认。");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认失败");
    }
  }

  async function convertDraft() {
    if (!selectedDraftId) {
      setError("请先选择待处理草稿");
      return;
    }
    const companionIds = selectedCompanionIdsForAction();
    try {
      await callApi(`/api/admin/order-drafts/${selectedDraftId}/convert`, {
        method: "POST",
        body: JSON.stringify(companionIds.length > 1 ? { companionIds } : { companionId: companionIds[0] || undefined })
      });
      setStatus(companionIds.length > 1 ? `已转为订单组：${companionIds.length} 个陪玩子订单。` : companionIds.length === 1 ? "\u5df2\u6307\u5b9a\u966a\u73a9\u5e76\u8f6c\u4e3a\u6b63\u5f0f\u8ba2\u5355\u3002" : "\u5df2\u8f6c\u4e3a\u6b63\u5f0f\u8ba2\u5355\u3002");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "\u8f6c\u8ba2\u5355\u5931\u8d25");
    }
  }

  function selectedCompanionIdsForAction() {
    return [
      ...selectedCompanionIds,
      selectedDraft?.selectedCompanion?.id
    ].filter((id): id is string => Boolean(id)).filter((id, index, array) => array.indexOf(id) === index);
  }

  function toggleSelectedCompanion(companionId: string) {
    setSelectedCompanionIds((current) =>
      current.includes(companionId) ? current.filter((id) => id !== companionId) : [...current, companionId]
    );
  }

  function toggleDirectCompanion(companionId: string) {
    setDirectCompanionIds((current) =>
      current.includes(companionId) ? current.filter((id) => id !== companionId) : [...current, companionId]
    );
  }

  async function cancelDraft() {
    if (!selectedDraftId) return;
    try {
      await callApi(`/api/admin/order-drafts/${selectedDraftId}/cancel`, { method: "PATCH", body: JSON.stringify({ note: "客服取消试音单" }) });
      setStatus("试音单已取消。");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消失败");
    }
  }

  async function failDraft() {
    if (!selectedDraftId) return;
    try {
      await callApi(`/api/admin/order-drafts/${selectedDraftId}/fail`, {
        method: "PATCH",
        body: JSON.stringify({ note: "长时间无人报名或客户未继续确认" })
      });
      setStatus("已标记流单，草稿已关闭并保留后台日志。");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "标记流单失败");
    }
  }

  async function expireStaleDrafts() {
    try {
      const data = await callApi<{ expiredCount: number; staleMinutes: number }>("/api/admin/order-drafts/expire-stale", {
        method: "POST",
        body: JSON.stringify({})
      });
      setStatus(`已处理 ${data.expiredCount} 个超过 ${data.staleMinutes} 分钟未推进的流单。`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理超时流单失败");
    }
  }

  return (
    <AdminShell>
      <SectionHeader eyebrow="Group Order Desk" title="群下单成单台" desc="客户已选陪玩就直接后台成单；未选人时只发布到 Discord / KOOK @ 标签招募，陪玩在平台报名。" />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="待处理草稿" value={String(stats.open)} hint="等待平台报名或客户确认选择" tone="cyan" />
        <Signal label="平台报名" value={String(stats.candidates)} hint="DC / KOOK 报名回流候选" tone="gold" />
        <Signal label="已成单" value={String(stats.converted)} hint="已转正式订单" tone="green" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-6 grid gap-4 xl:grid-cols-2">
        <Panel title="发布平台招募" hint="客户没点名陪玩时使用：AI 或人工客服把需求发到 KOOK / Discord 招募频道，@ 对应标签，陪玩在平台报名。">
          <div className="grid gap-3 md:grid-cols-2">
            <CustomerSelect value={form.customerId} customers={customers} onChange={(value) => setForm({ ...form, customerId: value })} />
            <select value={form.sourcePlatform} onChange={(event) => setForm({ ...form, sourcePlatform: event.target.value as "WEB" | "DISCORD" | "KOOK" })} className="input">
              <option value="KOOK">KOOK</option>
              <option value="DISCORD">Discord</option>
              <option value="WEB">后台手动</option>
            </select>
            <input value={form.customerDisplayName} onChange={(event) => setForm({ ...form, customerDisplayName: event.target.value })} className="input" placeholder="客户频道昵称，可选" />
            <input value={form.customerPlatformUserId} onChange={(event) => setForm({ ...form, customerPlatformUserId: event.target.value })} className="input" placeholder="KOOK/DC 用户 ID，可选" />
            <input value={form.sourceChannelId} onChange={(event) => setForm({ ...form, sourceChannelId: event.target.value })} className="input" placeholder="来源频道 ID，可选" />
            <input value={form.voiceRoomId} onChange={(event) => setForm({ ...form, voiceRoomId: event.target.value })} className="input" placeholder="试音语音频道 ID，可选" />
          </div>
          <textarea value={form.demandText} onChange={(event) => setForm({ ...form, demandText: event.target.value })} className="input mt-3 min-h-28" placeholder="粘贴客户原话，例如：三角洲，模式随意，2 小时，不试音，现在开始。" />
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "三角洲，模式随意，2小时，不试音，现在开始",
              "Apex，娱乐模式，2小时，预算按报价，先试音",
              "无畏契约，排位上分，3小时，今晚开始"
            ].map((template) => (
              <button key={template} type="button" onClick={() => setForm((current) => ({ ...current, demandText: template }))} className="rounded-dfc-control border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-300/50">
                {template}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void createDraftFromDemand()} className="mt-4 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">
            创建草稿并发布平台招募
          </button>
        </Panel>

        <Panel title="已选陪玩直接成单" hint="客户已经在 KOOK / Discord 点名陪玩时使用：后台选择客户和陪玩后直接扣余额、生成正式订单。">
          <div className="grid gap-3 md:grid-cols-2">
            <CustomerSelect value={form.customerId} customers={customers} onChange={(value) => setForm({ ...form, customerId: value })} />
            <select value={form.sourcePlatform} onChange={(event) => setForm({ ...form, sourcePlatform: event.target.value as "WEB" | "DISCORD" | "KOOK" })} className="input">
              <option value="KOOK">KOOK</option>
              <option value="DISCORD">Discord</option>
              <option value="WEB">后台手动</option>
            </select>
            <select value={form.game} onChange={(event) => setForm({ ...form, game: event.target.value })} className="input">
              {gameOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} className="input" placeholder="模式，例如 烽火/排位/娱乐" />
            <select value={form.priceTier} onChange={(event) => setForm({ ...form, priceTier: event.target.value as ServicePriceTier })} className="input">
              <option value="CUSTOM">按默认/平台单价</option>
              <option value="ENTERTAINMENT">娱乐陪玩价</option>
              <option value="RANKED">排位单价</option>
              <option value="HIGH_RANKED">高等级排位价</option>
            </select>
            <input value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} className="input" placeholder="预计时长，例如 2" inputMode="decimal" />
            <input value={form.sourceChannelId} onChange={(event) => setForm({ ...form, sourceChannelId: event.target.value })} className="input" placeholder="来源频道 ID，可选" />
          </div>
          <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className="input mt-3 min-h-20" placeholder="客服备注" />
          <div className="mt-4 rounded-dfc-control border border-cyan-300/15 bg-[#07111f] p-3">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <input value={directCompanionQuery} onChange={(event) => setDirectCompanionQuery(event.target.value)} className="input" placeholder="搜索客户点名的陪玩昵称/邮箱" />
              <div className="rounded-dfc-control border border-cyan-300/25 bg-cyan-300/10 px-3 py-3 text-xs font-black text-cyan-100">
                已选 {directCompanionIds.length} 人
              </div>
            </div>
            <div className="mt-3 rounded-dfc-control border border-cyan-300/10 bg-black/20 px-3 py-2 text-xs leading-5 text-cyan-100">
              {directCompanionSummary}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {directPickerCompanions.map((companion) => {
                const selected = directCompanionIds.includes(companion.userId);
                const price = companionPriceForTier(companion, form.priceTier, form.sourcePlatform);
                return (
                  <button
                    key={companion.userId}
                    type="button"
                    onClick={() => toggleDirectCompanion(companion.userId)}
                    className={`min-h-20 rounded-dfc-control border p-3 text-left transition hover:border-cyan-300/50 ${
                      selected ? "border-cyan-300/70 bg-cyan-300/10" : "border-cyan-300/15 bg-[#101827]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-black text-white">{companion.nickname}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${selected ? "bg-cyan-300 text-slate-950" : "bg-slate-700/70 text-dfc-muted"}`}>
                        {selected ? "已选" : "选择"}
                      </span>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-dfc-muted">
                      {priceTierLabel(form.priceTier)} ¥{formatMoney(price)}/h / {toOnlineStatus(companion.onlineStatus)}
                    </div>
                  </button>
                );
              })}
            </div>
            {directPickerCompanions.length === 0 ? (
              <div className="mt-3 rounded-dfc-control border border-cyan-300/10 bg-black/20 px-3 py-2 text-xs text-dfc-muted">
                当前游戏和搜索条件下没有可上架陪玩。
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-dfc-muted">
              {directListedCompanions.length > directPickerCompanions.length ? <span>已按当前搜索显示前 {directPickerCompanions.length} 个，可继续搜索缩小范围。</span> : null}
              {directCompanionIds.length ? (
                <button type="button" onClick={() => setDirectCompanionIds([])} className="rounded-dfc-control border border-cyan-300/20 px-3 py-1.5 font-semibold text-cyan-100 hover:border-cyan-300/50">
                  清空选择
                </button>
              ) : null}
            </div>
            <div className="mt-3">
              <DraftBillView bill={directBill} config={discountConfig} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void createDirectOrder()}>
              {directCompanionIds.length > 1 ? `直接创建正式订单（${directCompanionIds.length} 人）` : "直接创建正式订单"}
            </ActionButton>
          </div>
        </Panel>
      </section>

      <section className="admin-panel mb-6">
        <h2 className="text-base font-black text-white">平台报名处理</h2>
        <p className="mt-1 text-xs leading-5 text-dfc-muted">这里不做后台招募，只处理 DC / KOOK 报名回流和客户最终选择，最后转正式订单。</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <select value={selectedDraftId} onChange={(event) => setSelectedDraftId(event.target.value)} className="input">
            <option value="">选择待处理草稿</option>
            {activeDrafts.map((draft) => (
              <option key={draft.id} value={draft.id}>{draft.draftNo} / {draft.customer?.displayName ?? draft.customerDisplayName ?? "未绑定客户"} / {toDraftStatus(draft.status)}</option>
            ))}
          </select>
          <input value={companionQuery} onChange={(event) => setCompanionQuery(event.target.value)} className="input" placeholder="搜索平台报名陪玩昵称/邮箱" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton tone="secondary" onClick={() => void confirmDraft()}>记录客户确认</ActionButton>
          <ActionButton onClick={() => void convertDraft()}>
            {selectedCompanionIds.length > 1 ? `确认并转正式订单（${selectedCompanionIds.length} 人）` : "确认并转正式订单"}
          </ActionButton>
          <ActionButton tone="danger" onClick={() => void failDraft()}>标记流单</ActionButton>
          <ActionButton tone="danger" onClick={() => void cancelDraft()}>取消草稿</ActionButton>
          <ActionButton tone="secondary" onClick={() => void expireStaleDrafts()}>处理超时流单</ActionButton>
        </div>

          <div className="mt-4 rounded-dfc-control border border-cyan-300/15 bg-[#07111f] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black text-white">平台报名候选（可多选）</div>
                <div className="mt-1 text-xs leading-5 text-dfc-muted">
                  {selectedDraft
                    ? "这里只展示 DC / KOOK 已报名回流的陪玩；客户从报名里选好后，在这里勾选并转正式订单。"
                    : "先选择一个待处理草稿，随后这里会显示平台报名回流的陪玩。"}
                </div>
              </div>
              <div className="rounded-dfc-control border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100">
                已选 {selectedCompanionIds.length} 人
              </div>
            </div>
            {selectedCompanionIds.length ? (
              <div className="mt-3 rounded-dfc-control border border-cyan-300/10 bg-black/20 px-3 py-2 text-xs leading-5 text-cyan-100">
                {selectedCompanionSummary}
              </div>
            ) : null}
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {multiPickerCompanions.map((companion) => {
                const selected = selectedCompanionIds.includes(companion.userId);
                const priceTier = selectedDraft?.priceTier ?? form.priceTier;
                const sourcePlatform = selectedDraft?.sourcePlatform ?? form.sourcePlatform;
                const price = companionPriceForTier(companion, priceTier, sourcePlatform);
                return (
                  <button
                    key={companion.userId}
                    type="button"
                    disabled={!selectedDraft}
                    onClick={() => selectedDraft && toggleSelectedCompanion(companion.userId)}
                    className={`min-h-20 rounded-dfc-control border p-3 text-left transition hover:border-cyan-300/50 ${
                      selected ? "border-cyan-300/70 bg-cyan-300/10" : "border-cyan-300/15 bg-[#101827]"
                    } ${selectedDraft ? "" : "cursor-not-allowed opacity-60"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-black text-white">{companion.nickname}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${selected ? "bg-cyan-300 text-slate-950" : "bg-slate-700/70 text-dfc-muted"}`}>
                        {selected ? "已选" : "选择"}
                      </span>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-dfc-muted">
                      {priceTierLabel(priceTier)} ¥{formatMoney(price)}/h / {toOnlineStatus(companion.onlineStatus)}
                    </div>
                  </button>
                );
              })}
            </div>
            {multiPickerCompanions.length === 0 ? (
              <div className="mt-3 rounded-dfc-control border border-cyan-300/10 bg-black/20 px-3 py-2 text-xs text-dfc-muted">
                暂无平台报名候选。请先在 DC / KOOK 招募频道 @ 对应标签，让陪玩在平台报名。
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-dfc-muted">
              {listedCompanions.length > multiPickerCompanions.length ? <span>已按当前搜索显示前 {multiPickerCompanions.length} 个平台报名，可用搜索框缩小范围。</span> : null}
              {selectedCompanionIds.length ? (
                <button type="button" onClick={() => setSelectedCompanionIds([])} className="rounded-dfc-control border border-cyan-300/20 px-3 py-1.5 font-semibold text-cyan-100 hover:border-cyan-300/50">
                  清空选择
                </button>
              ) : null}
            </div>
          </div>

      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div>
          <DataTable
          columns={["草稿", "客户", "备注", "来源", "游戏/模式", "平台报名", "已选陪玩", "状态", "正式订单"]}
          rows={activeDrafts.map((draft) => [
            <button key={draft.id} type="button" onClick={() => setSelectedDraftId(draft.id)} className="text-left font-black text-cyan-200">{draft.draftNo}</button>,
            <Person key={`${draft.id}-customer`} name={draft.customer?.displayName ?? draft.customerDisplayName ?? "未绑定"} sub={draft.customer?.email ?? draft.customerPlatformUserId ?? "-"} />,
            <span key={`note-${draft.id}`} className="line-clamp-2 text-xs text-dfc-subtext">{draft.note || "-"}</span>,
            <Person key={`${draft.id}-source`} name={draft.sourcePlatform} sub={`语音：${draft.voiceRoomId || "-"}`} />,
            `${gameName(draft.game)} / ${draft.mode || "-"} / ${priceTierLabel(draft.priceTier)}`,
            `${draft.candidates.length} 人`,
            <span key={`selected-${draft.id}`} className="text-xs leading-5 text-dfc-subtext">{selectedCompanionNames(draft)}</span>,
            <StatusBadge key={`${draft.id}-status`} tone={statusTone(draft.status)}>{toDraftStatus(draft.status, draft.note)}</StatusBadge>,
            draft.convertedOrderGroup
              ? `${draft.convertedOrderGroup.groupNo} / ${draft.convertedOrderGroup.orders.length} 单 / ¥${formatMoney(draft.convertedOrderGroup.totalAmount)}`
              : draft.convertedOrder ? `${draft.convertedOrder.orderNo} / ${draft.convertedOrder.status}` : "-"
          ])}
          />
          {hiddenClosedDraftCount > 0 ? (
            <p className="mt-3 text-xs text-dfc-muted">
              已隐藏 {hiddenClosedDraftCount} 条已取消、已流单或已转订单的草稿，避免影响当前处理。
            </p>
          ) : null}
        </div>

        <div className="admin-panel">
          <h2 className="text-base font-black text-white">当前草稿详情</h2>
          {selectedDraft ? (
            <div className="mt-4 space-y-4 text-sm text-dfc-subtext">
              <DetailBlock title={selectedDraft.draftNo}>
                <div className="whitespace-pre-wrap">备注：{selectedDraft.note || "-"}</div>
                <div>预算：{selectedDraft.budgetAmount ? `¥${formatMoney(selectedDraft.budgetAmount)}` : "-"} / 时长：{selectedDraft.hours || "-"}</div>
                <div>更新时间：{formatDateTime(selectedDraft.updatedAt)}</div>
              </DetailBlock>
              <DetailBlock title="平台报名候选">
                {selectedDraft.candidates.length ? selectedDraft.candidates.map((candidate) => (
                  <div key={candidate.id} className="admin-queue-item mb-2">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedCompanionIds.includes(candidate.companion.id)}
                        onChange={() => toggleSelectedCompanion(candidate.companion.id)}
                        className="mt-1 h-4 w-4 accent-cyan-300"
                      />
                      <span>
                        <span className="block font-semibold text-white">{candidate.companion.companionProfile?.nickname ?? candidate.companion.displayName}</span>
                        <span className="block text-xs text-dfc-muted">
                          {candidate.status} / {priceTierLabel(selectedDraft.priceTier)} ¥{candidate.companion.companionProfile ? formatMoney(candidate.companion.companionProfile.pricePerHour) : "-"}/h
                        </span>
                      </span>
                    </label>
                    {candidate.note ? <div className="mt-1 text-xs">{candidate.note}</div> : null}
                  </div>
                )) : <div className="text-dfc-muted">暂无平台报名候选</div>}
              </DetailBlock>
              <DetailBlock title="实时账单估算">
                <DraftBillView bill={selectedDraftBill} config={discountConfig} />
              </DetailBlock>
              <DetailBlock title="最近事件">
                {selectedDraft.events.slice(0, 5).map((event) => (
                  <div key={event.id} className="admin-queue-item mb-2">
                    <div className="font-semibold text-white">{event.eventType}</div>
                    <div className="text-xs text-dfc-muted">{formatDateTime(event.createdAt)} / {event.actor?.displayName ?? event.actorType}</div>
                    {event.content ? <div className="mt-1 text-xs">{event.content}</div> : null}
                  </div>
                ))}
              </DetailBlock>
            </div>
          ) : (
            <div className="mt-4 text-sm text-dfc-muted">请选择一个草稿</div>
          )}
        </div>
      </section>
    </AdminShell>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="admin-panel">
      <h2 className="text-base font-black text-white">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-dfc-muted">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CustomerSelect({ value, customers, onChange }: { value: string; customers: AdminUser[]; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="input">
      <option value="">选择已注册客户</option>
      {customers.map((customer) => (
        <option key={customer.id} value={customer.id}>{customer.displayName} / {customer.email}</option>
      ))}
    </select>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-black text-white">{title}</div>
      {children}
    </div>
  );
}

function DraftBillView({ bill, config }: { bill: DraftBill | null; config: MultiCompanionDiscountConfig }) {
  if (!bill || bill.count === 0 || bill.hours <= 0) {
    return <div className="rounded-dfc-control border border-cyan-300/15 bg-[#07111f] p-3 text-xs text-dfc-muted">勾选陪玩并填写时长后显示估算账单。</div>;
  }

  return (
    <div className="rounded-dfc-control border border-cyan-300/15 bg-[#07111f] p-3">
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        <InfoCell label="人数" value={`${bill.count} 人`} />
        <InfoCell label="时长" value={`${formatMoney(String(bill.hours))} 小时`} />
        <InfoCell label="原价" value={`¥${formatMoney(String(bill.originalAmount))}`} />
        <InfoCell label="折后总价" value={`¥${formatMoney(String(bill.totalAmount))}`} />
      </div>
      <div className="mt-3 text-xs leading-5 text-dfc-subtext">
        {bill.discountAmount > 0
          ? `多陪玩折扣：${bill.count} 人，每人每小时 -¥${formatMoney(String(config.discountPerHour))}，本单共减 ¥${formatMoney(String(bill.discountAmount))}。`
          : config.enabled
            ? `当前未达到 ${config.minCount} 人起算门槛，暂不减免。`
            : "多陪玩折扣开关当前关闭，按原价估算。"}
      </div>
      <div className="mt-2 text-xs text-dfc-muted">最终扣款以后端转正式订单时的配置和钱包事务为准。</div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 font-black text-white">{value}</div>
    </div>
  );
}

function Person({ name, sub }: { name: string; sub: string }) {
  return (
    <div>
      <div className="font-semibold text-white">{name}</div>
      <div className="mt-1 text-xs text-dfc-muted">{sub}</div>
    </div>
  );
}

function selectedCompanionNames(draft: OrderDraft) {
  const selected = draft.candidates.filter((candidate) => candidate.status === "SELECTED");
  if (selected.length) {
    return selected.map((candidate) => candidate.companion.companionProfile?.nickname ?? candidate.companion.displayName).join("、");
  }
  return draft.selectedCompanion?.displayName ?? "-";
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

function buildNotificationStatus(draftNo?: string, notifications: DispatchNotification[] = []) {
  const sent = notifications.filter((item) => item.status === "SENT").map((item) => platformLabel(item.platform));
  const failed = notifications.filter((item) => item.status !== "SENT").map((item) => `${platformLabel(item.platform)}${item.error ? `：${item.error}` : ""}`);

  if (sent.length > 0) {
    return `派单 ${draftNo ?? ""} 已创建，并已发布到 ${sent.join("、")} 派单频道${failed.length ? `；失败：${failed.join("；")}` : ""}。`;
  }

  if (notifications.length > 0) {
    return `派单 ${draftNo ?? ""} 已创建，但频道通知失败：${failed.join("；")}。请检查 Bot 权限、频道 ID 和 .env。`;
  }

  return `派单 ${draftNo ?? ""} 已创建，但没有返回频道通知结果。请检查 Bot 通知服务配置。`;
}

function platformLabel(platform: string) {
  if (platform === "DISCORD") return "Discord";
  if (platform === "KOOK") return "KOOK";
  return platform;
}

function priceTierLabel(priceTier?: ServicePriceTier | string | null) {
  if (priceTier === "ENTERTAINMENT") return "娱乐";
  if (priceTier === "RANKED") return "排位";
  if (priceTier === "HIGH_RANKED") return "高排";
  return "默认";
}

function companionPriceForTier(companion: Companion, priceTier: ServicePriceTier, platform: "WEB" | "DISCORD" | "KOOK") {
  const platformPrice =
    platform === "DISCORD"
      ? companion.discordPricePerHour || companion.pricePerHour
      : platform === "KOOK"
        ? companion.kookPricePerHour || companion.pricePerHour
        : companion.pricePerHour;

  if (priceTier === "ENTERTAINMENT") return companion.entertainmentPricePerHour || platformPrice;
  if (priceTier === "RANKED") return companion.rankedPricePerHour || platformPrice;
  if (priceTier === "HIGH_RANKED") return companion.highRankedPricePerHour || companion.rankedPricePerHour || platformPrice;
  return platformPrice;
}

function companionProfilePriceForTier(profile: NonNullable<OrderDraft["candidates"][number]["companion"]["companionProfile"]>, priceTier: ServicePriceTier, platform: "WEB" | "DISCORD" | "KOOK") {
  const platformPrice =
    platform === "DISCORD"
      ? profile.discordPricePerHour || profile.pricePerHour
      : platform === "KOOK"
        ? profile.kookPricePerHour || profile.pricePerHour
        : profile.pricePerHour;

  if (priceTier === "ENTERTAINMENT") return profile.entertainmentPricePerHour || platformPrice;
  if (priceTier === "RANKED") return profile.rankedPricePerHour || platformPrice;
  if (priceTier === "HIGH_RANKED") return profile.highRankedPricePerHour || profile.rankedPricePerHour || platformPrice;
  return platformPrice;
}

function buildDiscountConfig(settings: PromotionSetting[]): MultiCompanionDiscountConfig {
  const values = Object.fromEntries(settings.map((item) => [item.key, item.value]));
  const enabledRaw = values.MULTI_COMPANION_DISCOUNT_ENABLED ?? "1";
  const minCount = Number.parseInt(values.MULTI_COMPANION_DISCOUNT_MIN_COUNT ?? "2", 10);
  return {
    enabled: !["0", "false", "off", "disabled"].includes(enabledRaw.trim().toLowerCase()),
    minCount: Number.isFinite(minCount) ? Math.max(2, minCount) : 2,
    discountPerHour: Math.max(0, Number(values.MULTI_COMPANION_DISCOUNT_AMOUNT ?? "10") || 0),
    floorPrice: Math.max(0, Number(values.MULTI_COMPANION_DISCOUNT_FLOOR_PRICE ?? "68") || 68)
  };
}

function buildDraftBill(draft: OrderDraft | undefined, selectedIds: string[], config: MultiCompanionDiscountConfig, companions: Companion[] = []): DraftBill | null {
  if (!draft) return null;
  const hours = Number(draft.hours || 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const selectedCandidates = draft.candidates.filter((candidate) => selectedIds.includes(candidate.companion.id) && candidate.companion.companionProfile);
  const candidateIds = new Set(selectedCandidates.map((candidate) => candidate.companion.id));
  const selectedDirectCompanions = companions.filter((companion) => selectedIds.includes(companion.userId) && !candidateIds.has(companion.userId));
  if (!selectedCandidates.length && !selectedDirectCompanions.length) return null;

  const unitPrices = [
    ...selectedCandidates.map((candidate) => Number(companionProfilePriceForTier(candidate.companion.companionProfile!, draft.priceTier, draft.sourcePlatform)) || 0),
    ...selectedDirectCompanions.map((companion) => Number(companionPriceForTier(companion, draft.priceTier, draft.sourcePlatform)) || 0)
  ];
  const discountEnabled = config.enabled && unitPrices.length >= config.minCount && config.discountPerHour > 0;
  const originalAmount = unitPrices.reduce((sum, unitPrice) => sum + unitPrice * hours, 0);
  const totalAmount = unitPrices.reduce((sum, unitPrice) => {
    const discountedUnit = discountEnabled ? applyUnitDiscount(unitPrice, config.discountPerHour, config.floorPrice) : unitPrice;
    return sum + discountedUnit * hours;
  }, 0);

  return {
    count: unitPrices.length,
    hours,
    originalAmount,
    discountAmount: Math.max(0, originalAmount - totalAmount),
    totalAmount
  };
}

function buildDirectBill(
  order: { hours: string; priceTier: ServicePriceTier; sourcePlatform: "WEB" | "DISCORD" | "KOOK" },
  selectedIds: string[],
  config: MultiCompanionDiscountConfig,
  companions: Companion[]
): DraftBill | null {
  const hours = Number(order.hours || 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const unitPrices = companions
    .filter((companion) => selectedIds.includes(companion.userId))
    .map((companion) => Number(companionPriceForTier(companion, order.priceTier, order.sourcePlatform)) || 0);
  if (!unitPrices.length) return null;

  const discountEnabled = config.enabled && unitPrices.length >= config.minCount && config.discountPerHour > 0;
  const originalAmount = unitPrices.reduce((sum, unitPrice) => sum + unitPrice * hours, 0);
  const totalAmount = unitPrices.reduce((sum, unitPrice) => {
    const discountedUnit = discountEnabled ? applyUnitDiscount(unitPrice, config.discountPerHour, config.floorPrice) : unitPrice;
    return sum + discountedUnit * hours;
  }, 0);

  return {
    count: unitPrices.length,
    hours,
    originalAmount,
    discountAmount: Math.max(0, originalAmount - totalAmount),
    totalAmount
  };
}

function applyUnitDiscount(unitPrice: number, discountPerHour: number, floorPrice: number) {
  const discounted = unitPrice - discountPerHour;
  if (discounted >= floorPrice) return discounted;
  return unitPrice < floorPrice ? unitPrice : floorPrice;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function gameName(code: string) {
  return gameOptions.find(([value]) => value === code)?.[1] ?? code;
}

function statusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "CONVERTED") return "success";
  if (status === "CANCELLED") return "danger";
  if (status === "CUSTOMER_CONFIRMED" || status === "SELECTED") return "warning";
  return "default";
}

function toDraftStatus(status: string, note?: string | null) {
  if (status === "CANCELLED" && note?.startsWith("流单：")) return "已流单";
  const map: Record<string, string> = {
    NEW: "新草稿",
    CANDIDATES_NOTIFIED: "已通知候选",
    CUSTOMER_REVIEWING: "客户选择中",
    SELECTED: "已选陪玩",
    CUSTOMER_CONFIRMED: "客户已确认",
    CONVERTED: "已转订单",
    CANCELLED: "已取消"
  };
  return map[status] ?? status;
}

function toOnlineStatus(status: string) {
  if (status === "ONLINE") return "在线";
  if (status === "BUSY") return "忙碌";
  if (status === "OFFLINE") return "离线";
  return status;
}

function toFriendlyError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("Insufficient balance")) return "客户余额不足，先让客户充值或后台审核充值";
  if (message.includes("Customer does not exist")) return "客户不存在或不可用";
  if (message.includes("Companion is not listed")) return "陪玩未上架、游戏不匹配或账号不可用";
  if (message.includes("already converted")) return "这个草稿已经转过正式订单";
  if (message.includes("hours is required")) return "转正式订单前必须填写时长";
  if (message.includes("must be linked to a customer")) return "转正式订单前必须绑定已注册客户";
  if (message.includes("No candidates")) return "还没有平台报名候选，先在 DC / KOOK 招募频道 @ 对应标签让陪玩报名";
  return message;
}
