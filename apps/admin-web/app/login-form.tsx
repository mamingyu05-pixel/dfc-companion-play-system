"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export function AdminLoginForm() {
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
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, portal: "admin" })
      });
      const data = (await response.json().catch(() => ({}))) as { accessToken?: string; user?: unknown; message?: string | string[] };

      if (!response.ok || !data.accessToken) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }

      localStorage.setItem("dfc_admin_token", data.accessToken);
      localStorage.setItem("dfc_admin_user", JSON.stringify(data.user));
      window.location.href = "/admin/dashboard/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="admin-console-bg min-h-screen px-4 py-8 text-dfc-text">
      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_420px]">
        <div className="max-w-3xl">
          <div className="inline-flex rounded-dfc-control border border-fuchsia-300/30 bg-fuchsia-400/10 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-fuchsia-100">
            Maycat Ops Console
          </div>
          <h1 className="mt-5 text-4xl font-black leading-none text-white md:text-6xl">May猫饼运营后台</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
            用一套控制台处理充值审核、人工派单、提现打款、投诉留证和后台日志。这里是资金和服务质量的最后一道人工关口。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <LoginSignal label="充值审核" value="人工核图" />
            <LoginSignal label="派单规则" value="先试音" />
            <LoginSignal label="风控留痕" value="日志记录" />
          </div>
        </div>

        <form onSubmit={submit} className="admin-panel p-5">
          <div className="mb-5">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100">Secure Access</div>
            <h2 className="mt-2 text-2xl font-black text-white">管理员登录</h2>
            <p className="mt-1 text-sm text-dfc-subtext">仅 ADMIN 和 SUPER_ADMIN 可进入后台。</p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">管理员邮箱</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input"
                placeholder="admin@example.com"
                autoComplete="email"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">密码</span>
              <div className="flex rounded-dfc-control border border-cyan-300/20 bg-[#070d19] focus-within:border-cyan-300/60 focus-within:shadow-dfc-focus">
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none"
                  placeholder="输入后台密码"
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPassword((current) => !current)} className="px-3 text-xs font-black text-cyan-200 hover:text-white">
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </label>

            {error ? <div className="rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}

            <button
              disabled={isSubmitting}
              className="w-full rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "登录中..." : "进入运营后台"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function LoginSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc border border-cyan-300/20 bg-[#07111f]/72 p-4">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 text-base font-black text-white">{value}</div>
    </div>
  );
}

function toChineseError(message?: string) {
  if (!message) return "邮箱或密码不正确";
  if (message.includes("Invalid email or password")) return "邮箱或密码不正确";
  if (message.includes("User role cannot access this portal")) return "这个账号不能进入管理后台";
  if (message.includes("User is not active")) return "账号已被禁用";
  return message;
}
