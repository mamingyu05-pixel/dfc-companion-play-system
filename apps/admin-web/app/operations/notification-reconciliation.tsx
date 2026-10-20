"use client";

import { useState } from "react";
import { DataTable } from "../components";

type Delivery = {
  id: string;
  key: string;
  businessKey: string;
  platform: string;
  target: string;
  status: string;
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
};
const labels: Record<string, string> = {
  UNKNOWN: "结果未知，禁止自动重发",
  SENDING: "发送中或待检查进程状态",
  READY: "等待发送",
};

export function NotificationReconciliation() {
  const [rows, setRows] = useState<Delivery[]>();
  const [selected, setSelected] = useState<Delivery>();
  const [evidence, setEvidence] = useState("");
  const [messageId, setMessageId] = useState("");
  const [confirmedAbsent, setConfirmedAbsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function request(path: string, options: RequestInit = {}) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) throw new Error("请先登录管理员账号");
    const response = await fetch(`/api/admin/operations/deliveries${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "通知核对失败");
    return data;
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      setRows(await request(""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取通知记录");
    } finally {
      setBusy(false);
    }
  }
  async function reconcile(decision: "SENT" | "NOT_SENT") {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request(`/${selected.id}/reconcile`, {
        method: "PATCH",
        body: JSON.stringify({
          decision,
          evidence,
          ...(decision === "SENT" ? { messageId } : {}),
        }),
      });
      setSelected(undefined);
      setNotice(
        decision === "SENT"
          ? "已记录平台回执，不会重发。"
          : `仅通知重试已入队，不会重复派单或资金操作。${result.backgroundDeliveryEnabled ? "等待后台处理。" : "后台消费目前关闭，任务尚未发送。"}`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "核对失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel mt-5">
      <h2 className="text-lg font-bold">通知结果核对</h2>
      <p className="my-3 text-sm text-dfc-subtext">
        超时不代表未发送。请核对平台频道、业务编号和回执；不得通过重新建单补发通知。本表为全平台范围，最多100条。
      </p>
      <button
        disabled={busy}
        className="mb-3 rounded border border-cyan-200 px-4 py-2 disabled:opacity-40"
        onClick={() => void load()}
      >
        {busy ? "处理中…" : "读取 / 刷新通知记录"}
      </button>
      {error && (
        <p role="alert" className="mb-3 text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-3 text-green-200">
          {notice}
        </p>
      )}
      {rows?.length === 0 && (
        <p className="text-sm">暂无需要核对或等待发送的通知。</p>
      )}
      {rows && (
        <DataTable
          columns={["业务编号", "平台 / 目标", "状态", "尝试", "原因", "处理"]}
          rows={rows.map((d) => [
            `${d.key.slice(0, 12)} · ${d.businessKey}`,
            `${d.platform} / ${d.target}`,
            labels[d.status] || d.status,
            String(d.attempts),
            d.lastError || "—",
            <button
              key={d.id}
              disabled={
                busy ||
                (d.status !== "UNKNOWN" &&
                  !(
                    d.status === "SENDING" &&
                    d.startedAt &&
                    Date.now() - new Date(d.startedAt).getTime() > 120000
                  ))
              }
              className="text-cyan-200 underline disabled:opacity-40"
              onClick={() => {
                setSelected(d);
                setEvidence("");
                setMessageId("");
                setConfirmedAbsent(false);
              }}
            >
              核对结果
            </button>,
          ])}
        />
      )}
      {selected && (
        <div className="mt-4 grid gap-3 rounded border border-amber-200/40 p-4">
          <strong>核对：{selected.businessKey}</strong>
          <label>
            核对依据（至少10字）
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              className="mt-1 block w-full rounded bg-slate-950 p-3"
            />
          </label>
          <label>
            平台中已找到消息的回执 ID
            <input
              value={messageId}
              onChange={(e) => setMessageId(e.target.value)}
              className="ml-3 rounded bg-slate-950 p-2"
            />
          </label>
          <button
            disabled={busy || evidence.trim().length < 10 || !messageId.trim()}
            className="justify-self-start rounded border border-cyan-200 px-4 py-2 disabled:opacity-40"
            onClick={() => void reconcile("SENT")}
          >
            确认已发送，记录回执
          </button>
          <label className="text-sm">
            <input
              type="checkbox"
              checked={confirmedAbsent}
              onChange={(e) => setConfirmedAbsent(e.target.checked)}
            />{" "}
            我已核实平台记录，明确确认原通知未发送
          </label>
          <button
            disabled={busy || evidence.trim().length < 10 || !confirmedAbsent}
            className="justify-self-start rounded border border-amber-200 px-4 py-2 disabled:opacity-40"
            onClick={() => void reconcile("NOT_SENT")}
          >
            确认未发送，仅重试这条通知
          </button>
          <button
            disabled={busy}
            className="justify-self-start text-sm underline"
            onClick={() => setSelected(undefined)}
          >
            取消核对
          </button>
        </div>
      )}
    </section>
  );
}
