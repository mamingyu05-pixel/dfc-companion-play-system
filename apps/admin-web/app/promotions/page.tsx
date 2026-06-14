"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type PromotionSetting = {
  key: string;
  value: string;
  description?: string | null;
};

type PromotionCode = {
  id: string;
  code: string;
  title: string;
  minRecharge: string;
  bonusAmount: string;
  bonusRate: string;
  maxBonusAmount?: string | null;
  usageLimit?: number | null;
  usedCount: number;
  isActive: boolean;
};

const labels: Record<string, { label: string; hint: string }> = {
  NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE: {
    label: "新用户首充赠送比例",
    hint: "填 0.1 表示首笔审核通过充值额外送 10%，填 0 表示不按比例送。"
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
  const [codes, setCodes] = useState<PromotionCode[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState({ code: "", title: "", minRecharge: "", bonusAmount: "", bonusRate: "", maxBonusAmount: "", usageLimit: "" });
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

  async function loadPromotionCodes() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/promotion-codes", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("load codes failed");
    setCodes((await response.json()) as PromotionCode[]);
  }

  useEffect(() => {
    void Promise.all([loadSettings(), loadPromotionCodes()]).catch(() => setError("无法加载优惠配置"));
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

  async function createPromotionCode() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch("/api/admin/promotion-codes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: newCode.code,
        title: newCode.title,
        minRecharge: newCode.minRecharge || "0",
        bonusAmount: newCode.bonusAmount || "0",
        bonusRate: newCode.bonusRate || "0",
        maxBonusAmount: newCode.maxBonusAmount || undefined,
        usageLimit: newCode.usageLimit ? Number(newCode.usageLimit) : undefined
      })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }
    setStatus("优惠码已创建");
    setNewCode({ code: "", title: "", minRecharge: "", bonusAmount: "", bonusRate: "", maxBonusAmount: "", usageLimit: "" });
    await loadPromotionCodes();
  }

  async function togglePromotionCode(id: string, isActive: boolean) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/promotion-codes/${id}/status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ isActive })
    });
    if (!response.ok) {
      setError("优惠码状态更新失败");
      return;
    }
    setStatus(isActive ? "优惠码已启用" : "优惠码已停用");
    await loadPromotionCodes();
  }

  const stats = useMemo(() => {
    const active = codes.filter((item) => item.isActive).length;
    const used = codes.reduce((sum, item) => sum + item.usedCount, 0);
    return { active, used };
  }, [codes]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Growth Rules" title="优惠设置" desc="调整首充赠送、邀请奖励和充值优惠码。首充赠送已接入充值审核，邀请码奖励需接入邀请绑定后自动发放。" />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="配置项" value={String(settings.length)} hint="全局增长规则" tone="cyan" />
        <Signal label="启用优惠码" value={String(stats.active)} hint="客户充值可使用" tone="green" />
        <Signal label="累计使用" value={String(stats.used)} hint="优惠码使用次数" tone="gold" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="admin-panel">
        <h2 className="text-base font-black text-white">全局优惠规则</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {settings.map((setting) => {
            const meta = labels[setting.key] ?? { label: setting.key, hint: setting.description ?? "" };
            return (
              <label key={setting.key} className="admin-queue-item block">
                <span className="text-sm font-black text-white">{meta.label}</span>
                <input value={values[setting.key] ?? ""} onChange={(event) => setValues({ ...values, [setting.key]: event.target.value })} className="input mt-3" inputMode="decimal" />
                <span className="mt-2 block text-xs leading-5 text-dfc-muted">{meta.hint}</span>
              </label>
            );
          })}
        </div>
        <button type="button" onClick={() => void saveSettings()} className="mt-5 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">
          保存优惠配置
        </button>
      </section>

      <section className="admin-panel mt-6">
        <h2 className="text-base font-black text-white">充值优惠码</h2>
        <p className="mt-1 text-xs leading-5 text-dfc-muted">客户充值时填写优惠码，管理员审核通过后自动入账。示例：NEW100，满 100 固定送 10。</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input value={newCode.code} onChange={(event) => setNewCode({ ...newCode, code: event.target.value.toUpperCase().replace(/\s+/g, "") })} className="input" placeholder="优惠码，例如 NEW100" />
          <input value={newCode.title} onChange={(event) => setNewCode({ ...newCode, title: event.target.value })} className="input" placeholder="名称，例如 新人满百送十" />
          <input value={newCode.minRecharge} onChange={(event) => setNewCode({ ...newCode, minRecharge: event.target.value })} className="input" placeholder="最低充值，例如 100" inputMode="decimal" />
          <input value={newCode.bonusAmount} onChange={(event) => setNewCode({ ...newCode, bonusAmount: event.target.value })} className="input" placeholder="固定赠送，例如 10" inputMode="decimal" />
          <input value={newCode.bonusRate} onChange={(event) => setNewCode({ ...newCode, bonusRate: event.target.value })} className="input" placeholder="比例赠送，例如 0.1" inputMode="decimal" />
          <input value={newCode.maxBonusAmount} onChange={(event) => setNewCode({ ...newCode, maxBonusAmount: event.target.value })} className="input" placeholder="最高赠送，可空" inputMode="decimal" />
          <input value={newCode.usageLimit} onChange={(event) => setNewCode({ ...newCode, usageLimit: event.target.value.replace(/\D/g, "") })} className="input" placeholder="总使用次数，可空" inputMode="numeric" />
        </div>
        <div className="mt-4">
          <ActionButton onClick={() => void createPromotionCode()}>创建优惠码</ActionButton>
        </div>

        <div className="mt-5">
          <DataTable
            columns={["优惠码", "规则", "使用", "状态", "操作"]}
            rows={codes.map((item) => [
              <div key={`${item.id}-code`}>
                <div className="font-black text-cyan-200">{item.code}</div>
                <div className="mt-1 text-xs text-dfc-muted">{item.title}</div>
              </div>,
              <div key={`${item.id}-rule`} className="text-xs leading-5">
                <div>满 ¥{formatMoney(item.minRecharge)}</div>
                <div>固定送 ¥{formatMoney(item.bonusAmount)} / 比例 {Number(item.bonusRate) * 100}%</div>
                {item.maxBonusAmount ? <div>最高送 ¥{formatMoney(item.maxBonusAmount)}</div> : null}
              </div>,
              `${item.usedCount}${item.usageLimit ? ` / ${item.usageLimit}` : ""}`,
              <StatusBadge key={`${item.id}-status`} tone={item.isActive ? "success" : "default"}>{item.isActive ? "启用" : "停用"}</StatusBadge>,
              <ActionButton key={`${item.id}-toggle`} tone="secondary" onClick={() => void togglePromotionCode(item.id, !item.isActive)}>
                {item.isActive ? "停用" : "启用"}
              </ActionButton>
            ])}
          />
        </div>
      </section>
    </AdminShell>
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

function toFriendlyError(message?: string) {
  if (!message) return "保存失败";
  if (message.includes("cannot be greater than 1")) return "比例不能大于 1，0.1 表示 10%";
  if (message.includes("cannot be negative")) return "优惠金额或比例不能小于 0";
  if (message.includes("valid amount")) return "请输入正确数字";
  return message;
}
