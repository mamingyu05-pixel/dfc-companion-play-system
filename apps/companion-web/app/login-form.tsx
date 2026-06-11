"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export function CompanionLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, portal: "companion" })
      });
      const data = (await response.json().catch(() => ({}))) as { accessToken?: string; user?: unknown; message?: string | string[] };

      if (!response.ok || !data.accessToken) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }

      localStorage.setItem("dfc_companion_token", data.accessToken);
      localStorage.setItem("dfc_companion_user", JSON.stringify(data.user));
      window.location.href = "/companion/dashboard/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-dfc-bg px-4 py-8 text-dfc-text">
      <section className="mx-auto mt-10 max-w-md rounded-dfc border border-dfc-border bg-dfc-surface p-5 shadow-dfc-card">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold">陪玩登录</h1>
          <p className="mt-1 text-sm text-dfc-subtext">优先使用 KOOK / Discord 申请或登录陪玩账号，管理员审核后才能上架接单。</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <OAuthButton href="/api/auth/oauth/discord/start?portal=companion" label="Discord 申请/登录" />
          <OAuthButton href="/api/auth/oauth/kook/start?portal=companion" label="KOOK 申请/登录" />
        </div>
        <div className="my-5 flex items-center gap-3 text-xs text-dfc-muted">
          <span className="h-px flex-1 bg-dfc-border" />
          <span>或使用管理员创建的账号</span>
          <span className="h-px flex-1 bg-dfc-border" />
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="邮箱"
          />
          <div className="flex rounded-dfc-control border border-dfc-border bg-dfc-bg focus-within:shadow-dfc-focus">
            <input
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none"
              placeholder="密码"
            />
            <button type="button" onClick={() => setShowPassword((current) => !current)} className="px-3 text-xs font-semibold text-dfc-blue">
              {showPassword ? "隐藏" : "显示"}
            </button>
          </div>
          {error ? <div className="rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
          <button disabled={isSubmitting} className="w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
            {isSubmitting ? "登录中..." : "登录陪玩工作台"}
          </button>
        </form>
      </section>
    </main>
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

function toChineseError(message?: string) {
  if (!message) return "邮箱或密码不正确";
  if (message.includes("Invalid email or password")) return "邮箱或密码不正确";
  if (message.includes("User role cannot access this portal")) return "这个账号不能进入陪玩端";
  if (message.includes("Companion profile is banned")) return "陪玩资料已被封禁";
  if (message.includes("User is not active")) return "账号已被禁用";
  return message;
}
