"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type AuthMode = "register" | "login";

type PublicConfig = {
  support?: {
    wechatId?: string | null;
    discordUrl?: string | null;
    kookUrl?: string | null;
  };
};

const DEFAULT_SUPPORT_KOOK_URL = "https://kook.vip/i0o2qA";
const DEFAULT_SUPPORT_DISCORD_URL = "https://discord.gg/dX5prAZMPu";
const KOOK_INVITE_CODE = "i0o2qA";

export function CompanionLoginForm() {
  const [mode, setMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
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

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
  }

  async function sendEmailCode() {
    setError("");
    setNotice("");
    const normalizedEmail = email.trim().toLowerCase();
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
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }
      setNotice("验证码已发送，请查看邮箱。10 分钟内有效。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败，请稍后再试");
    } finally {
      setIsSendingCode(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const endpoint = mode === "register" ? "/api/auth/register/companion" : "/api/auth/login";
      const body =
        mode === "register"
          ? {
              email: normalizedEmail,
              emailCode: emailCode.trim(),
              displayName: displayName.trim(),
              password
            }
          : { email: normalizedEmail, password, portal: "companion" };

      if (mode === "register" && password !== confirmPassword) {
        throw new Error("两次输入的密码不一致");
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
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
      setError(err instanceof Error ? err.message : mode === "register" ? "注册申请失败，请检查填写内容" : "登录失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="companion-console-bg min-h-screen px-4 py-8 text-dfc-text">
      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_500px]">
        <div className="max-w-3xl">
          <div className="inline-flex rounded-dfc-control border border-dfc-gold/35 bg-dfc-gold/10 px-4 py-2 text-sm font-black text-dfc-gold">
            陪玩专用入口
          </div>
          <h1 className="mt-5 text-4xl font-black leading-tight text-white md:text-6xl">陪玩接单工作台</h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-dfc-subtext">
            邮箱注册会创建待审核陪玩资料。通过审核和上架后，才能正式接单、查看派单、维护资料、绑定 KOOK / Discord，并提交提现。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <LoginSignal label="申请" value="邮箱 / Discord" />
            <LoginSignal label="审核" value="资料与语音" />
            <LoginSignal label="接单" value="上架后开放" />
          </div>
        </div>

        <section className="companion-card p-5 md:p-7">
          <div className="mb-5">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100">Companion Portal</div>
            <h2 className="mt-2 text-3xl font-black text-white">{mode === "register" ? "注册陪玩申请" : "登录陪玩端"}</h2>
            <p className="mt-2 text-sm leading-6 text-dfc-subtext">
              陪玩注册后默认待审核。平台审核通过、上架以后才会出现在客户列表和派单匹配里。
            </p>
          </div>

          <div className="mb-4 grid grid-cols-2 rounded-dfc-control border border-cyan-300/15 bg-[#101827] p-1">
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`rounded-dfc-control px-3 py-2 text-sm font-black transition ${mode === "register" ? "bg-cyan-300 text-slate-950" : "text-dfc-subtext hover:text-white"}`}
            >
              邮箱注册申请
            </button>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`rounded-dfc-control px-3 py-2 text-sm font-black transition ${mode === "login" ? "bg-cyan-300 text-slate-950" : "text-dfc-subtext hover:text-white"}`}
            >
              登录
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <OAuthButton href="/api/auth/oauth/discord/start?portal=companion" label="Discord 注册/登录" />
            <CommunityAuthLink
              href={publicConfig.support?.kookUrl || DEFAULT_SUPPORT_KOOK_URL}
              label="KOOK 申请频道"
              helper={`邀请码 ${KOOK_INVITE_CODE}`}
            />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <CommunityAuthLink
              href={publicConfig.support?.discordUrl || DEFAULT_SUPPORT_DISCORD_URL}
              label="加入 Discord"
              helper="不会注册时走人工审核"
            />
            <div className="rounded-dfc-control border border-dfc-gold/25 bg-dfc-gold/10 px-3 py-3 text-center text-[11px] font-semibold leading-5 text-dfc-gold">
              管理路径：后台陪玩管理查看待审核申请
            </div>
          </div>

          <div className="my-5 flex items-center gap-3 text-xs text-dfc-muted">
            <span className="h-px flex-1 bg-cyan-300/15" />
            <span>{mode === "register" ? "邮箱验证注册" : "使用已开通账号登录"}</span>
            <span className="h-px flex-1 bg-cyan-300/15" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">邮箱</span>
              <div className={mode === "register" ? "grid gap-2 sm:grid-cols-[1fr_112px]" : ""}>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="input"
                  placeholder="companion@example.com"
                  autoComplete="email"
                />
                {mode === "register" ? (
                  <button
                    type="button"
                    disabled={isSendingCode}
                    onClick={() => void sendEmailCode()}
                    className="rounded-dfc-control border border-cyan-300/50 px-3 py-3 text-xs font-black text-cyan-200 transition hover:bg-cyan-300/10 disabled:opacity-60"
                  >
                    {isSendingCode ? "发送中" : "发验证码"}
                  </button>
                ) : null}
              </div>
            </label>

            {mode === "register" ? (
              <>
                <label className="block">
                  <span className="mb-2 block text-xs font-black text-dfc-muted">邮箱验证码</span>
                  <input
                    required
                    value={emailCode}
                    onChange={(event) => setEmailCode(event.target.value)}
                    className="input"
                    placeholder="6 位验证码"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-black text-dfc-muted">陪玩昵称</span>
                  <input
                    required
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="input"
                    placeholder="客户能看到的昵称"
                    autoComplete="nickname"
                  />
                </label>
              </>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">密码</span>
              <PasswordInput
                value={password}
                onChange={setPassword}
                showPassword={showPassword}
                onToggle={() => setShowPassword((current) => !current)}
                placeholder={mode === "register" ? "至少 8 位" : "输入密码"}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </label>

            {mode === "register" ? (
              <label className="block">
                <span className="mb-2 block text-xs font-black text-dfc-muted">确认密码</span>
                <PasswordInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  showPassword={showPassword}
                  onToggle={() => setShowPassword((current) => !current)}
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                />
              </label>
            ) : null}

            {notice ? <div className="rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{notice}</div> : null}
            {error ? <div className="rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}

            <button disabled={isSubmitting} className="w-full rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-5 py-4 text-base font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">
              {isSubmitting ? "处理中..." : mode === "register" ? "提交陪玩注册申请" : "进入陪玩工作台"}
            </button>
          </form>

          <div className="mt-4 rounded-dfc-control border border-cyan-300/15 bg-cyan-300/5 px-3 py-3 text-xs leading-5 text-dfc-subtext">
            KOOK OAuth 暂时受平台审核限制，KOOK 陪玩可以先用邮箱注册，进入陪玩端后生成 KOOK 绑定码完成绑定。
            VX 客服：<span className="font-black text-cyan-200">{publicConfig.support?.wechatId || "暂未配置"}</span>
          </div>
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

function CommunityAuthLink({ href, label, helper }: { href: string; label: string; helper: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-dfc-control border border-cyan-300/20 bg-[#101827] px-3 py-3 text-center text-sm font-black text-dfc-text hover:border-cyan-300/60 hover:text-cyan-100"
    >
      <span className="block">{label}</span>
      <span className="mt-1 block text-[11px] font-semibold text-dfc-muted">{helper}</span>
    </a>
  );
}

function PasswordInput({
  value,
  onChange,
  showPassword,
  onToggle,
  placeholder,
  autoComplete
}: {
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggle: () => void;
  placeholder: string;
  autoComplete: string;
}) {
  return (
    <div className="flex rounded-dfc-control border border-cyan-300/20 bg-[#070d19] focus-within:border-cyan-300/60 focus-within:shadow-dfc-focus">
      <input
        required
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none"
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button type="button" onClick={onToggle} className="px-3 text-xs font-black text-cyan-200 hover:text-white">
        {showPassword ? "隐藏" : "显示"}
      </button>
    </div>
  );
}

function toChineseError(message?: string) {
  if (!message) return "请求失败，请检查填写内容";
  if (message.includes("Invalid email or password")) return "邮箱或密码不正确";
  if (message.includes("User role cannot access this portal")) return "这个账号不能进入陪玩端";
  if (message.includes("Companion profile is banned")) return "陪玩资料已被封禁";
  if (message.includes("User is not active")) return "账号已被禁用";
  if (message.includes("Email is already registered")) return "这个邮箱已经注册过，请直接登录或联系管理员处理";
  if (message.includes("Display name is already taken")) return "这个昵称已经被使用，请换一个";
  if (message.includes("Password must be at least 8 characters")) return "密码至少 8 位";
  if (message.includes("Verification code is invalid or expired")) return "邮箱验证码无效或已过期";
  if (message.includes("too many failed attempts")) return "验证码错误次数过多，请重新发送";
  if (message.includes("Please wait before requesting")) return "验证码发送太频繁，请稍后再试";
  if (message.includes("Invalid email format")) return "邮箱格式不正确";
  if (message.includes("Email service is not configured")) return "邮箱服务未配置，请联系管理员";
  return message;
}
