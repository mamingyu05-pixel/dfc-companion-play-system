"use client";

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

type Mode = "register" | "login";

type AuthResponse = {
  accessToken?: string;
  user?: {
    id: string;
    email: string;
    displayName?: string | null;
    role: string;
  };
  message?: string | string[];
};

export function CustomerAuthForm() {
  const [mode, setMode] = useState<Mode>("register");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setIsSubmitting(true);

    const endpoint = mode === "register" ? "/api/auth/register/customer" : "/api/auth/login";
    const payload =
      mode === "register"
        ? { email, password, displayName }
        : { email, password, portal: "customer" };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await response.json().catch(() => ({}))) as AuthResponse;

      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }

      if (data.accessToken) {
        localStorage.setItem("dfc_customer_token", data.accessToken);
        localStorage.setItem("dfc_customer_user", JSON.stringify(data.user));
      }

      setStatus(mode === "register" ? "注册成功，已为你创建客户钱包。" : "登录成功。");
      window.setTimeout(() => {
        window.location.href = "/customer/home/";
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen gap-6 bg-dfc-bg px-4 py-6 text-dfc-text md:grid-cols-[1fr_420px] md:px-6 lg:px-10">
      <section className="flex flex-col justify-center py-6">
        <div className="max-w-2xl">
          <div className="inline-flex rounded-dfc-control border border-dfc-blue/30 bg-dfc-blue/10 px-3 py-1 text-xs font-semibold text-dfc-blue">
            May猫饼电竞 · 三角洲行动陪玩
          </div>
          <h1 className="mt-5 text-3xl font-semibold leading-tight text-dfc-text md:text-5xl">
            注册账号，开始预约陪玩
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-dfc-subtext md:text-base">
            充值人工审核，余额下单，平台派单或指定陪玩。订单、钱包、投诉都会保留后台记录。
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Feature label="人工充值审核" value="资金更清楚" />
            <Feature label="指定或平台匹配" value="下单更灵活" />
            <Feature label="语音试音" value="先确认体验" />
          </div>
        </div>
      </section>

      <section className="self-center rounded-dfc border border-dfc-border bg-dfc-surface p-4 shadow-dfc-card md:p-5">
        <div className="grid grid-cols-2 gap-2 rounded-dfc-control bg-dfc-elevated p-1">
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`rounded-dfc-control px-3 py-2 text-sm font-semibold ${mode === "register" ? "bg-dfc-blue text-slate-950" : "text-dfc-subtext"}`}
          >
            注册
          </button>
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-dfc-control px-3 py-2 text-sm font-semibold ${mode === "login" ? "bg-dfc-blue text-slate-950" : "text-dfc-subtext"}`}
          >
            登录
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="邮箱">
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-text outline-none focus:border-dfc-blue"
            />
          </Field>

          {mode === "register" ? (
            <Field label="昵称">
              <input
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="你的游戏昵称"
                className="w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-text outline-none focus:border-dfc-blue"
              />
            </Field>
          ) : null}

          <Field label="密码">
            <PasswordInput
              value={password}
              onChange={setPassword}
              showPassword={showPassword}
              onToggleShow={() => setShowPassword((current) => !current)}
              placeholder="至少 8 位"
            />
          </Field>

          {mode === "register" ? (
            <Field label="确认密码">
              <PasswordInput
                value={confirmPassword}
                onChange={setConfirmPassword}
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((current) => !current)}
                placeholder="再次输入密码"
              />
            </Field>
          ) : null}

          {error ? <div className="rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
          {status ? <div className="rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "提交中..." : mode === "register" ? "创建客户账号" : "登录客户入口"}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-dfc-muted">
          <span>管理员和陪玩请走独立入口</span>
          <div className="flex gap-3">
            <a href="/admin/" className="text-dfc-blue">管理端</a>
            <a href="/companion/" className="text-dfc-blue">陪玩端</a>
          </div>
        </div>
      </section>
    </div>
  );
}

function toChineseError(message?: string) {
  if (!message) return "请求失败，请检查填写内容";
  if (message.includes("Email is already registered")) return "这个邮箱已经注册过，请直接登录或换一个邮箱";
  if (message.includes("Password must be at least 8 characters")) return "密码至少需要 8 位";
  if (message.includes("Invalid email or password")) return "邮箱或密码不正确";
  if (message.includes("User role cannot access this portal")) return "这个账号不能进入客户入口";
  return message;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-dfc-subtext">{label}</span>
      {children}
    </label>
  );
}

function PasswordInput({
  value,
  onChange,
  showPassword,
  onToggleShow,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex rounded-dfc-control border border-dfc-border bg-dfc-bg focus-within:border-dfc-blue">
      <input
        required
        minLength={8}
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-dfc-text outline-none"
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="shrink-0 px-3 text-xs font-semibold text-dfc-blue"
        aria-label={showPassword ? "隐藏密码" : "显示密码"}
      >
        {showPassword ? "隐藏" : "显示"}
      </button>
    </div>
  );
}

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-3">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-dfc-text">{value}</div>
    </div>
  );
}
