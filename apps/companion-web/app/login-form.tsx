"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type PublicConfig = {
  support?: {
    wechatId?: string | null;
  };
};

export function CompanionLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
  }, []);

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
    <main className="companion-console-bg min-h-screen px-4 py-8 text-dfc-text">
      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_420px]">
        <div className="max-w-3xl">
          <div className="inline-flex rounded-dfc-control border border-fuchsia-300/30 bg-fuchsia-400/10 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-fuchsia-100">
            Maycat Companion
          </div>
          <h1 className="mt-5 text-4xl font-black leading-none text-white md:text-6xl">陪玩接单工作台</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
            登录后查看派给你的订单、服务进度、收益流水和提现记录。入驻前请先联系平台客服完成资料与语音审核。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <LoginSignal label="接单" value="派单通知" />
            <LoginSignal label="服务" value="开始/完成" />
            <LoginSignal label="收益" value="提现审核" />
          </div>
        </div>

        <section className="companion-card p-5">
          <div className="mb-5">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100">Secure Access</div>
            <h2 className="mt-2 text-2xl font-black text-white">陪玩登录</h2>
            <p className="mt-1 text-sm text-dfc-subtext">通过考核后，由管理员开通账号或绑定 KOOK / Discord。</p>
          </div>

          <div className="mb-4 rounded-dfc-control border border-cyan-300/25 bg-cyan-300/10 px-3 py-3 text-sm text-dfc-subtext">
            <div className="font-black text-white">陪玩申请流程</div>
            <div className="mt-1">添加 VX 客服：<span className="font-black text-cyan-200">{publicConfig.support?.wechatId || "暂未配置"}</span></div>
            <div className="mt-1 text-xs text-dfc-muted">客服会核验游戏资料、语音、服务时间，通过后开通账号。</div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <OAuthButton href="/api/auth/oauth/discord/start?portal=companion" label="Discord 登录" />
            <OAuthButton href="/api/auth/oauth/kook/start?portal=companion" label="KOOK 登录" />
          </div>

          <div className="my-5 flex items-center gap-3 text-xs text-dfc-muted">
            <span className="h-px flex-1 bg-cyan-300/15" />
            <span>或使用管理员创建的账号</span>
            <span className="h-px flex-1 bg-cyan-300/15" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">邮箱</span>
              <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="input" placeholder="companion@example.com" autoComplete="email" />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">密码</span>
              <div className="flex rounded-dfc-control border border-cyan-300/20 bg-[#070d19] focus-within:border-cyan-300/60 focus-within:shadow-dfc-focus">
                <input required type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none" placeholder="输入密码" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPassword((current) => !current)} className="px-3 text-xs font-black text-cyan-200 hover:text-white">
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </label>
            {error ? <div className="rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
            <button disabled={isSubmitting} className="w-full rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">
              {isSubmitting ? "登录中..." : "进入陪玩工作台"}
            </button>
          </form>
        </section>
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

function OAuthButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="rounded-dfc-control border border-cyan-300/20 bg-[#101827] px-3 py-3 text-center text-sm font-black text-dfc-text hover:border-cyan-300/60 hover:text-cyan-100">
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
