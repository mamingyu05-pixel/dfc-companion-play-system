"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { MaycatLogo } from "./brand";

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

type PublicConfig = {
  support?: {
    wechatId?: string | null;
  };
};

export function CustomerAuthForm() {
  const [mode, setMode] = useState<Mode>("register");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
  }, []);

  async function sendEmailCode() {
    setStatus("");
    setError("");

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      setError("请先填写邮箱");
      return;
    }

    setIsSendingCode(true);
    try {
      const response = await fetch("/api/auth/email-verification-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }
      setStatus("验证码已发送，请去邮箱查看。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败，请稍后重试");
    } finally {
      setIsSendingCode(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (mode === "register" && !emailCode.trim()) {
      setError("请填写邮箱验证码");
      return;
    }

    setIsSubmitting(true);

    const endpoint = mode === "register" ? "/api/auth/register/customer" : "/api/auth/login";
    const normalizedEmail = normalizeEmail(email);
    const payload =
      mode === "register"
        ? { email: normalizedEmail, password, displayName: displayName.trim(), emailCode: emailCode.trim() }
        : { email: normalizedEmail, password, portal: "customer" };

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
    <div className="relative min-h-screen overflow-hidden bg-dfc-bg px-4 py-5 text-dfc-text md:px-6 lg:px-10">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute inset-x-0 top-0 h-px bg-dfc-blue/60" />
        <div className="absolute left-8 top-0 h-full w-px bg-dfc-border" />
        <div className="absolute right-8 top-0 h-full w-px bg-dfc-border" />
        <div className="absolute inset-x-0 bottom-24 h-px bg-dfc-border" />
      </div>

      <div className="relative grid min-h-[calc(100vh-40px)] gap-6 md:grid-cols-[minmax(0,1fr)_420px] lg:gap-10">
        <section className="flex flex-col justify-center py-6">
          <div className="max-w-3xl">
            <MaycatLogo />
            <div className="mt-8 inline-flex rounded-dfc-control border border-dfc-blue/30 bg-dfc-blue/10 px-3 py-1 text-xs font-semibold text-dfc-blue">
              多游戏陪玩俱乐部 · 人工审核 · 订单可追踪
            </div>
            <h1 className="mt-5 text-4xl font-black leading-tight text-dfc-text md:text-6xl">
              May猫饼电竞
            </h1>
            <p className="mt-3 text-xl font-semibold text-dfc-blue md:text-2xl">
              找靠谱陪玩，上车前先看资料、试语音、再下单
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
              充值人工审核，余额下单，平台派单或指定陪玩。注册邮箱验证码校验，订单、钱包、投诉都会保留后台记录。
            </p>
            <div className="mt-5 inline-flex rounded-dfc-control border border-dfc-blue/30 bg-dfc-blue/10 px-3 py-2 text-sm text-dfc-subtext">
              VX 客服：<span className="ml-1 font-semibold text-dfc-blue">{publicConfig.support?.wechatId || "暂未配置"}</span>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <Feature label="人工充值审核" value="每笔入账可追踪" />
              <Feature label="指定或平台匹配" value="下单更灵活" />
              <Feature label="语音试音" value="先确认体验" />
            </div>
            <div className="mt-7 grid max-w-xl grid-cols-3 divide-x divide-dfc-border rounded-dfc border border-dfc-border bg-dfc-surface">
              <Metric label="支持游戏" value="20+" />
              <Metric label="注册验证" value="邮箱" />
              <Metric label="服务模式" value="人工派单" />
            </div>
          </div>
        </section>

        <section className="self-center rounded-dfc border border-dfc-border bg-dfc-surface p-4 shadow-dfc-card md:p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">加入 May猫饼</h2>
              <p className="mt-1 text-xs text-dfc-muted">客户入口 · 注册后进入个人中心</p>
            </div>
            <MaycatLogo compact />
          </div>

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

          <form onSubmit={submit} className="mt-5 space-y-4" autoComplete={mode === "register" ? "off" : "on"}>
          <div className="grid gap-2 sm:grid-cols-2">
            <OAuthButton href="/api/auth/oauth/discord/start" label="Discord 注册/登录" />
            <OAuthButton href="/api/auth/oauth/kook/start" label="KOOK 注册/登录" />
          </div>
          <div className="flex items-center gap-3 text-xs text-dfc-muted">
            <span className="h-px flex-1 bg-dfc-border" />
            <span>或使用邮箱</span>
            <span className="h-px flex-1 bg-dfc-border" />
          </div>

          <Field label="邮箱">
            <div className="flex gap-2">
              <input
                required
                type="email"
                name={mode === "register" ? "register-email" : "login-email"}
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="min-w-0 flex-1 rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-text outline-none focus:border-dfc-blue"
              />
              {mode === "register" ? (
                <button
                  type="button"
                  onClick={sendEmailCode}
                  disabled={isSendingCode}
                  className="shrink-0 rounded-dfc-control border border-dfc-blue/40 px-3 text-xs font-semibold text-dfc-blue disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSendingCode ? "发送中" : "发验证码"}
                </button>
              ) : null}
            </div>
          </Field>

          {mode === "register" ? (
            <>
              <Field label="邮箱验证码">
                <input
                  required
                  inputMode="numeric"
                  name="email-verification-code"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6 位验证码"
                  className="w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-text outline-none focus:border-dfc-blue"
                />
              </Field>

              <Field label="昵称">
                <input
                  required
                  name="display-name"
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="你的游戏昵称"
                  className="w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-text outline-none focus:border-dfc-blue"
                />
              </Field>
            </>
          ) : null}

          <Field label="密码">
            <PasswordInput
              name={mode === "register" ? "new-password" : "current-password"}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
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
                name="confirm-new-password"
                autoComplete="new-password"
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
    </div>
  );
}

function toChineseError(message?: string) {
  if (!message) return "请求失败，请检查填写内容";
  if (message.includes("Email is already registered")) return "这个邮箱已经注册过，请直接登录或换一个邮箱";
  if (message.includes("Display name is already taken")) return "这个昵称已经被使用，请换一个昵称";
  if (message.includes("Invalid email format")) return "邮箱格式不正确，请检查后再提交";
  if (message.includes("Verification code is invalid or expired")) return "验证码不正确或已过期，请重新获取";
  if (message.includes("Verification code has too many failed attempts")) return "验证码错误次数太多，请重新获取";
  if (message.includes("Please wait before requesting another verification code")) return "验证码刚刚发送过，请稍等 1 分钟再试";
  if (message.includes("Email service is not configured")) return "邮箱发送服务还没配置，请联系管理员";
  if (message.includes("Password must be at least 8 characters")) return "密码至少需要 8 位";
  if (message.includes("Invalid email or password")) return "邮箱或密码不正确";
  if (message.includes("User role cannot access this portal")) return "这个账号不能进入客户入口";
  return message;
}

function normalizeEmail(email: string) {
  return email.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-dfc-subtext">{label}</span>
      {children}
    </label>
  );
}

function OAuthButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="rounded-dfc-control border border-dfc-border bg-dfc-elevated px-3 py-3 text-center text-sm font-semibold text-dfc-text hover:border-dfc-blue hover:text-dfc-blue"
    >
      {label}
    </a>
  );
}

function PasswordInput({
  name,
  autoComplete,
  value,
  onChange,
  showPassword,
  onToggleShow,
  placeholder
}: {
  name: string;
  autoComplete: string;
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
        name={name}
        autoComplete={autoComplete}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4">
      <div className="text-lg font-black text-dfc-text">{value}</div>
      <div className="mt-1 text-xs text-dfc-muted">{label}</div>
    </div>
  );
}
