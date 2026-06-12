"use client";

import { useEffect, useState } from "react";
import { AdminShell, SectionHeader } from "../components";

type PromotionSetting = {
  key: string;
  value: string;
  description?: string | null;
};

const labels: Record<string, { label: string; hint: string }> = {
  NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE: {
    label: "新用户首充赠送比例",
    hint: "填 0.1 表示首笔审核通过充值送 10%，填 0 表示不按比例送。"
  },
  NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT: {
    label: "新用户首充固定赠送",
    hint: "例如填 10，首笔审核通过充值额外送 10 元。"
  },
  CUSTOMER_REFERRER_REWARD_AMOUNT: {
    label: "老客户邀请奖励",
    hint: "老客户带新客户成功后给老客户多少余额，需后续接邀请码绑定。"
  },
  CUSTOMER_INVITEE_BONUS_AMOUNT: {
    label: "新客户被邀请奖励",
    hint: "新客户通过老客户邀请注册后获得多少优惠，需后续接邀请码绑定。"
  },
  COMPANION_REFERRAL_REWARD_AMOUNT: {
    label: "陪玩拉新奖励",
    hint: "陪玩带来一个客户成功下单后奖励多少金额，需后续接邀请绑定。"
  }
};

export default function PromotionsPage() {
  const [settings, setSettings] = useState<PromotionSetting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadSettings() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/promotion-settings", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("load failed");
    const data = (await response.json()) as PromotionSetting[];
    setSettings(data);
    setValues(Object.fromEntries(data.map((item) => [item.key, item.value])));
  }

  useEffect(() => {
    void loadSettings().catch(() => setError("无法加载优惠配置"));
  }, []);

  async function saveSettings() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch("/api/admin/promotion-settings", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(values)
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }
    setStatus("优惠配置已保存");
    await loadSettings();
  }

  return (
    <AdminShell>
      <SectionHeader
        title="优惠设置"
        desc="调整首充赠送、老带新、陪玩拉新奖励。首充赠送已自动接入充值审核；邀请奖励需接入邀请码后自动发放。"
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="max-w-4xl rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <div className="grid gap-4 md:grid-cols-2">
          {settings.map((setting) => {
            const meta = labels[setting.key] ?? { label: setting.key, hint: setting.description ?? "" };
            return (
              <label key={setting.key} className="block rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
                <span className="text-sm font-semibold text-dfc-text">{meta.label}</span>
                <input
                  value={values[setting.key] ?? ""}
                  onChange={(event) => setValues({ ...values, [setting.key]: event.target.value })}
                  className="mt-3 w-full rounded-dfc-control border border-dfc-border bg-dfc-surface px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
                  inputMode="decimal"
                />
                <span className="mt-2 block text-xs leading-5 text-dfc-muted">{meta.hint}</span>
              </label>
            );
          })}
        </div>
        <button type="button" onClick={() => void saveSettings()} className="mt-5 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
          保存优惠配置
        </button>
      </section>
    </AdminShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function toFriendlyError(message?: string) {
  if (!message) return "保存失败";
  if (message.includes("cannot be greater than 1")) return "比例不能大于 1，0.1 表示 10%";
  if (message.includes("cannot be negative")) return "优惠金额或比例不能小于 0";
  if (message.includes("valid amount")) return "请输入正确数字";
  return message;
}
