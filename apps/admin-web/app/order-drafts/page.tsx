"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  status: string;
  displayName: string;
};

type Companion = {
  userId: string;
  nickname: string;
  email: string;
  game: string;
  status: string;
  onlineStatus: string;
  pricePerHour: string;
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
  budgetAmount?: string | null;
  status: string;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; email: string; displayName: string } | null;
  selectedCompanion?: { id: string; email: string; displayName: string } | null;
  convertedOrder?: { id: string; orderNo: string; status: string; totalAmount: string } | null;
  candidates: Array<{
    id: string;
    status: string;
    note?: string | null;
    companion: {
      id: string;
      email: string;
      displayName: string;
      companionProfile: { nickname: string; avatarUrl?: string | null; pricePerHour: string; onlineStatus: string; status: string } | null;
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

type Recommendation = {
  companionId: string;
  nickname: string;
  pricePerHour: string;
  onlineStatus: string;
  score: number;
  note?: string | null;
  reasons: string[];
};

const gameOptions = [
  ["DELTA_FORCE", "三角洲行动"],
  ["LEAGUE_OF_LEGENDS", "英雄联盟"],
  ["VALORANT", "无畏契约"],
  ["COUNTER_STRIKE_2", "CS2"],
  ["PUBG", "PUBG"],
  ["APEX_LEGENDS", "Apex 英雄"],
  ["HONOR_OF_KINGS", "王者荣耀"],
  ["PEACEKEEPER_ELITE", "和平精英"]
] as const;

export default function OrderDraftsPage() {
  const [drafts, setDrafts] = useState<OrderDraft[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [selectedCompanionId, setSelectedCompanionId] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
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
    budgetAmount: "",
    note: "",
    demandText: ""
  });

  async function loadData() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const [draftsResponse, usersResponse, companionsResponse] = await Promise.all([
      fetch("/api/admin/order-drafts", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/companions", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!draftsResponse.ok || !usersResponse.ok || !companionsResponse.ok) throw new Error("load failed");
    const nextDrafts = (await draftsResponse.json()) as OrderDraft[];
    setDrafts(nextDrafts);
    setUsers((await usersResponse.json()) as AdminUser[]);
    setCompanions((await companionsResponse.json()) as Companion[]);
    setSelectedDraftId((current) => current || nextDrafts.find((draft) => !["CONVERTED", "CANCELLED"].includes(draft.status))?.id || "");
  }

  useEffect(() => {
    void loadData().catch(() => setError("无法加载试音派单数据，请确认管理员已登录"));
  }, []);

  const customers = users.filter((user) => user.role === "CUSTOMER" && user.status === "ACTIVE");
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId);
  const listedCompanions = useMemo(
    () => companions.filter((companion) => companion.status === "LISTED" && (!selectedDraft || companion.game === selectedDraft.game)),
    [companions, selectedDraft]
  );

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
      const data = await callApi<{ draft: { id: string }; notifications?: Array<{ platform: string; status: string; error?: string }> }>("/api/admin/order-drafts/from-demand", {
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
      setStatus(`AI 派单草稿已创建，并已尝试通知 KOOK/DC 陪玩频道。`);
      setForm((current) => ({ ...current, demandText: "" }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function createDraft() {
    try {
      await callApi("/api/admin/order-drafts", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          customerId: form.customerId || undefined,
          customerDisplayName: form.customerDisplayName || undefined,
          customerPlatformUserId: form.customerPlatformUserId || undefined,
          sourceChannelId: form.sourceChannelId || undefined,
          voiceRoomId: form.voiceRoomId || undefined,
          hours: form.hours || undefined,
          budgetAmount: form.budgetAmount || undefined,
          note: form.note || undefined
        })
      });
      setStatus("试音派单草稿已创建。");
      setForm((current) => ({ ...current, mode: "", hours: "", budgetAmount: "", note: "" }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function addCandidate() {
    if (!selectedDraftId || !candidateId) {
      setError("请先选择草稿和候选陪玩");
      return;
    }
    try {
      await callApi(`/api/admin/order-drafts/${selectedDraftId}/candidates`, {
        method: "POST",
        body: JSON.stringify({ companionId: candidateId })
      });
      setStatus("候选陪玩已加入试音记录。");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加候选失败");
    }
  }

  async function recommendCandidates() {
    if (!selectedDraftId) {
      setError("请先选择草稿");
      return;
    }
    try {
      const data = await callApi<{ recommendations: Recommendation[]; customerMessage: string }>(`/api/admin/order-drafts/${selectedDraftId}/recommend-candidates`, {
        method: "POST",
        body: JSON.stringify({ limit: 3 })
      });
      setRecommendations(data.recommendations);
      setCustomerMessage(data.customerMessage);
      setStatus("已生成候选推荐，可复制发送给客户。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "推荐失败");
    }
  }

  async function selectCompanion() {
    if (!selectedDraftId || !selectedCompanionId) {
      setError("请先选择草稿和最终陪玩");
      return;
    }
    try {
      await callApi(`/api/admin/order-drafts/${selectedDraftId}/select-companion`, {
        method: "PATCH",
        body: JSON.stringify({ companionId: selectedCompanionId })
      });
      setStatus("已记录客户最终选择。");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "记录选择失败");
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
    if (!selectedDraftId) return;
    try {
      await callApi(`/api/admin/order-drafts/${selectedDraftId}/convert`, { method: "POST", body: JSON.stringify({}) });
      setStatus("已转为正式订单。客户余额已冻结，订单进入后台。");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "转订单失败");
    }
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

  return (
    <AdminShell>
      <SectionHeader
        title="AI 试音派单"
        desc="客户在 KOOK/DC 说需求后，AI 派单助手解析需求、通知陪玩频道、记录报名、推荐候选，客户确认后再转正式订单。"
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-6 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">AI 创建派单草稿</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })} className="input">
              <option value="">选择已注册客户</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.displayName} / {customer.email}</option>
              ))}
            </select>
            <select value={form.sourcePlatform} onChange={(event) => setForm({ ...form, sourcePlatform: event.target.value as "WEB" | "DISCORD" | "KOOK" })} className="input">
              <option value="KOOK">KOOK</option>
              <option value="DISCORD">Discord</option>
              <option value="WEB">后台手动</option>
            </select>
            <input value={form.customerDisplayName} onChange={(event) => setForm({ ...form, customerDisplayName: event.target.value })} className="input" placeholder="客户频道昵称，可选" />
            <input value={form.customerPlatformUserId} onChange={(event) => setForm({ ...form, customerPlatformUserId: event.target.value })} className="input" placeholder="KOOK/DC 用户 ID，可选" />
            <input value={form.sourceChannelId} onChange={(event) => setForm({ ...form, sourceChannelId: event.target.value })} className="input" placeholder="客户来源频道 ID，可选" />
            <input value={form.voiceRoomId} onChange={(event) => setForm({ ...form, voiceRoomId: event.target.value })} className="input" placeholder="试音语音频道 ID，可选" />
          </div>
          <textarea
            value={form.demandText}
            onChange={(event) => setForm({ ...form, demandText: event.target.value })}
            className="input mt-3 min-h-28"
            placeholder="粘贴客户原话，例如：我想找三角洲烽火，2小时，预算100，女声，能试音，最好能上分。"
          />
          <button type="button" onClick={() => void createDraftFromDemand()} className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
            AI 解析并派发到陪玩频道
          </button>
        </div>

        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">手动创建草稿</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select value={form.game} onChange={(event) => setForm({ ...form, game: event.target.value })} className="input">
              {gameOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} className="input" placeholder="模式，例如 烽火/排位/娱乐" />
            <input value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} className="input" placeholder="预计时长，例如 2" inputMode="decimal" />
            <input value={form.budgetAmount} onChange={(event) => setForm({ ...form, budgetAmount: event.target.value })} className="input" placeholder="预算金额，可选" inputMode="decimal" />
          </div>
          <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className="input mt-3 min-h-20" placeholder="客服备注" />
          <button type="button" onClick={() => void createDraft()} className="mt-4 rounded-dfc-control border border-dfc-border px-4 py-3 text-sm font-semibold text-dfc-text">
            只创建草稿
          </button>
        </div>
      </section>

      <section className="mb-6 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <h2 className="text-base font-semibold">派单操作</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_1fr_auto]">
          <select value={selectedDraftId} onChange={(event) => setSelectedDraftId(event.target.value)} className="input">
            <option value="">选择试音草稿</option>
            {drafts.map((draft) => (
              <option key={draft.id} value={draft.id}>{draft.draftNo} / {draft.customer?.displayName ?? draft.customerDisplayName ?? "未绑定客户"} / {draft.status}</option>
            ))}
          </select>
          <select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} className="input">
            <option value="">选择候选陪玩</option>
            {listedCompanions.map((companion) => (
              <option key={companion.userId} value={companion.userId}>{companion.nickname} / ¥{formatMoney(companion.pricePerHour)}/h / {companion.onlineStatus}</option>
            ))}
          </select>
          <ActionButton onClick={() => void addCandidate()}>手动加入候选</ActionButton>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton tone="secondary" onClick={() => void recommendCandidates()}>AI 推荐候选</ActionButton>
          <ActionButton tone="secondary" onClick={() => void confirmDraft()}>客户确认</ActionButton>
          <ActionButton onClick={() => void convertDraft()}>转正式订单</ActionButton>
          <ActionButton tone="danger" onClick={() => void cancelDraft()}>取消草稿</ActionButton>
        </div>

        {recommendations.length ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
              <div className="text-sm font-semibold">AI 推荐排序</div>
              <div className="mt-3 space-y-2">
                {recommendations.map((item) => (
                  <button
                    key={item.companionId}
                    type="button"
                    onClick={() => setSelectedCompanionId(item.companionId)}
                    className="w-full rounded-dfc-control border border-dfc-border bg-dfc-surface p-3 text-left text-sm hover:border-dfc-blue"
                  >
                    <div className="font-semibold text-dfc-text">{item.nickname} · 分数 {item.score}</div>
                    <div className="mt-1 text-xs text-dfc-muted">¥{item.pricePerHour}/h · {item.onlineStatus}</div>
                    <div className="mt-1 text-xs text-dfc-subtext">{item.reasons.join(" / ")}</div>
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                <select value={selectedCompanionId} onChange={(event) => setSelectedCompanionId(event.target.value)} className="input">
                  <option value="">客户最终选择</option>
                  {recommendations.map((item) => <option key={item.companionId} value={item.companionId}>{item.nickname}</option>)}
                </select>
                <ActionButton onClick={() => void selectCompanion()}>记录选择</ActionButton>
              </div>
            </div>
            <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
              <div className="text-sm font-semibold">发给客户的文案</div>
              <textarea readOnly value={customerMessage} className="input mt-3 min-h-44" />
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(customerMessage)}
                className="mt-3 rounded-dfc-control border border-dfc-border px-4 py-2 text-sm font-semibold text-dfc-text"
              >
                复制文案
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <DataTable
          columns={["草稿", "客户", "来源", "游戏/模式", "候选", "状态", "正式订单"]}
          rows={drafts.map((draft) => [
            <button key={draft.id} type="button" onClick={() => setSelectedDraftId(draft.id)} className="text-left font-semibold text-dfc-blue">{draft.draftNo}</button>,
            <div key={`${draft.id}-customer`}>
              <div>{draft.customer?.displayName ?? draft.customerDisplayName ?? "未绑定"}</div>
              <div className="text-xs text-dfc-muted">{draft.customer?.email ?? draft.customerPlatformUserId ?? "-"}</div>
            </div>,
            <div key={`${draft.id}-source`}>
              <div>{draft.sourcePlatform}</div>
              <div className="text-xs text-dfc-muted">语音：{draft.voiceRoomId || "-"}</div>
            </div>,
            `${gameName(draft.game)} / ${draft.mode}`,
            `${draft.candidates.length} 人`,
            <StatusBadge key={`${draft.id}-status`} tone={statusTone(draft.status)}>{draft.status}</StatusBadge>,
            draft.convertedOrder ? `${draft.convertedOrder.orderNo} / ${draft.convertedOrder.status}` : "-"
          ])}
        />

        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">当前草稿详情</h2>
          {selectedDraft ? (
            <div className="mt-4 space-y-4 text-sm text-dfc-subtext">
              <div>
                <div className="font-semibold text-dfc-text">{selectedDraft.draftNo}</div>
                <div className="mt-1 whitespace-pre-wrap">备注：{selectedDraft.note || "-"}</div>
              </div>
              <div>
                <div className="mb-2 font-semibold text-dfc-text">候选陪玩</div>
                <div className="space-y-2">
                  {selectedDraft.candidates.length ? selectedDraft.candidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-2">
                      <div>{candidate.companion.companionProfile?.nickname ?? candidate.companion.displayName}</div>
                      <div className="text-xs text-dfc-muted">{candidate.status} / ¥{candidate.companion.companionProfile?.pricePerHour ?? "-"}/h</div>
                      {candidate.note ? <div className="mt-1 text-xs">{candidate.note}</div> : null}
                    </div>
                  )) : <div className="text-dfc-muted">暂无候选</div>}
                </div>
              </div>
              <div>
                <div className="mb-2 font-semibold text-dfc-text">最近事件</div>
                <div className="space-y-2">
                  {selectedDraft.events.map((event) => (
                    <div key={event.id} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-2">
                      <div>{event.eventType}</div>
                      <div className="text-xs text-dfc-muted">{new Date(event.createdAt).toLocaleString()} / {event.actor?.displayName ?? event.actorType}</div>
                      {event.content ? <div className="mt-1 text-xs">{event.content}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 text-sm text-dfc-muted">请选择一个草稿</div>
          )}
        </div>
      </section>
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
  return gameOptions.find(([value]) => value === code)?.[1] ?? code;
}

function statusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "CONVERTED") return "success";
  if (status === "CANCELLED") return "danger";
  if (status === "CUSTOMER_CONFIRMED" || status === "SELECTED") return "warning";
  return "default";
}

function toFriendlyError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("Insufficient balance")) return "客户余额不足，先让客户充值或后台审核充值";
  if (message.includes("Customer does not exist")) return "客户不存在或不可用";
  if (message.includes("Companion is not listed")) return "陪玩未上架、游戏不匹配或账号不可用";
  if (message.includes("already converted")) return "这个草稿已经转过正式订单";
  if (message.includes("hours is required")) return "转正式订单前必须填写时长";
  if (message.includes("must be linked to a customer")) return "转正式订单前必须绑定已注册客户";
  if (message.includes("No candidates")) return "还没有候选陪玩，先让陪玩报名或手动加入候选";
  return message;
}
