"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ActionButton, CompanionShell, SectionHeader, StatusBadge } from "../components";

type CustomerOption = {
  id: string;
  email: string;
  displayName: string;
  externalAccounts: Array<{ platform: string; externalUserId: string; displayName?: string | null }>;
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

export default function CompanionCustomerDraftsPage() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [game, setGame] = useState("DELTA_FORCE");
  const [mode, setMode] = useState("");
  const [hours, setHours] = useState("2");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedCustomer = useMemo(() => customers.find((item) => item.id === customerId), [customers, customerId]);

  async function searchCustomers() {
    setError("");
    setStatus("");
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/";
      return;
    }
    if (query.trim().length < 2) {
      setError("至少输入 2 个字符，比如老板昵称、邮箱、KOOK/DC 昵称。");
      return;
    }

    const response = await fetch(`/api/orders/companion/customers?query=${encodeURIComponent(query.trim())}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = (await response.json().catch(() => [])) as CustomerOption[] | { message?: string };
    if (!response.ok || !Array.isArray(data)) {
      throw new Error("搜索客户失败");
    }
    setCustomers(data);
    setCustomerId((current) => current || data[0]?.id || "");
    if (!data.length) setStatus("没有找到客户。请让老板先注册网站账号，或让客服在后台创建/绑定账号。");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");
    setLoading(true);
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/";
      return;
    }

    try {
      const response = await fetch("/api/orders/companion/customer-drafts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          customerId,
          game,
          mode,
          hours: hours || undefined,
          budgetAmount: budgetAmount || undefined,
          note: note || undefined
        })
      });
      const data = (await response.json().catch(() => ({}))) as { draft?: { draftNo?: string }; message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(toFriendlyError(message));
      }
      setStatus(`已创建代客派单草稿 ${data.draft?.draftNo ?? ""}，后台客服会确认后再转正式订单。`);
      setMode("");
      setBudgetAmount("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <CompanionShell>
      <SectionHeader
        eyebrow="Private Request"
        title="代客创建派单草稿"
        desc="老板私聊你下单时，在这里选择老板账号并记录需求。这里只创建后台草稿，不扣款、不结算，客服确认后才会转正式订单。"
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mt-5 grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="companion-card p-4">
          <h2 className="text-base font-black text-white">搜索老板账号</h2>
          <p className="mt-1 text-xs leading-5 text-dfc-muted">可输入邮箱、昵称、KOOK/DC 昵称或平台 ID。</p>
          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto] xl:grid-cols-1">
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="input" placeholder="例如 66 / boss@qq.com" />
            <ActionButton onClick={() => void searchCustomers()}>搜索客户</ActionButton>
          </div>

          <div className="mt-4 space-y-2">
            {customers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => setCustomerId(customer.id)}
                className={`w-full rounded-dfc-control border p-3 text-left transition ${
                  customerId === customer.id ? "border-cyan-300 bg-cyan-300/10" : "border-cyan-300/15 bg-[#101827]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-white">{customer.displayName}</span>
                  {customerId === customer.id ? <StatusBadge tone="success">已选择</StatusBadge> : null}
                </div>
                <div className="mt-1 text-xs text-dfc-muted">{customer.email}</div>
                <div className="mt-1 text-xs text-cyan-100/75">
                  {customer.externalAccounts.map((item) => `${item.platform}:${item.displayName || item.externalUserId}`).join(" / ") || "未绑定平台账号"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="companion-card p-4">
          <h2 className="text-base font-black text-white">记录需求</h2>
          <p className="mt-1 text-xs leading-5 text-dfc-muted">建议写清：游戏、模式、时长、预算、是否试音、老板特别要求。</p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label>
              <span className="mb-2 block text-xs font-black text-dfc-muted">老板账号</span>
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="input">
                <option value="">先搜索并选择老板</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName} / {customer.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-black text-dfc-muted">游戏</span>
              <select value={game} onChange={(event) => setGame(event.target.value)} className="input">
                {gameOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-black text-dfc-muted">模式</span>
              <input value={mode} onChange={(event) => setMode(event.target.value)} className="input" placeholder="例如 排位 / 娱乐 / 教学 / 上分" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-black text-dfc-muted">时长</span>
              <input value={hours} onChange={(event) => setHours(event.target.value)} className="input" inputMode="decimal" placeholder="例如 2" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-black text-dfc-muted">老板预算</span>
              <input value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} className="input" inputMode="decimal" placeholder="可选，例如 200，仅供客服参考" />
            </label>
            <div className="rounded-dfc border border-cyan-300/15 bg-[#08111f] p-3 text-xs leading-5 text-dfc-subtext">
              报价档位由后台根据模式自动判断。陪玩只记录老板需求，不手动选择或修改单价。
            </div>
            <div className="rounded-dfc border border-cyan-300/15 bg-[#08111f] p-3 text-xs leading-5 text-dfc-subtext">
              当前老板：{selectedCustomer ? `${selectedCustomer.displayName} / ${selectedCustomer.email}` : "未选择"}
            </div>
          </div>

          <label className="mt-3 block">
            <span className="mb-2 block text-xs font-black text-dfc-muted">备注</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} className="input min-h-32" placeholder="例如：老板私聊我，三角洲 2 小时，不试音，想现在开始，预算按我报价。" />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton type="submit" disabled={loading || !customerId || !mode.trim()}>{loading ? "提交中..." : "创建草稿"}</ActionButton>
            <ActionButton
              type="button"
              tone="secondary"
              onClick={() => setNote("老板私聊下单，需要客服确认余额、价格和开始时间。")}
            >
              填入常用备注
            </ActionButton>
          </div>
        </form>
      </section>
    </CompanionShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function toFriendlyError(message?: string) {
  if (!message) return "创建失败";
  if (message.includes("Customer does not exist")) return "老板账号不存在或不可用";
  if (message.includes("Companion is not listed")) return "你的陪玩资料未上架，不能代客创建派单";
  if (message.includes("mode is required")) return "请填写服务模式";
  return message;
}
