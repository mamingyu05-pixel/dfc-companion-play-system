"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { MaycatLogo, MaycatSignalArtwork } from "./brand";

type Mode = "register" | "login" | "forgot";

type AuthResponse = {
  accessToken?: string;
  user?: {
    id: string;
    email: string;
    displayName?: string | null;
    role: string;
    referralCode?: string | null;
  };
  message?: string | string[];
};

type PublicConfig = {
  support?: {
    wechatId?: string | null;
    kookUrl?: string | null;
    discordUrl?: string | null;
  };
};

const DEFAULT_SUPPORT_KOOK_URL = "https://kook.vip/i0o2qA";
const DEFAULT_SUPPORT_DISCORD_URL = "https://discord.gg/dX5prAZMPu";
const KOOK_INVITE_CODE = "i0o2qA";

export function CustomerAuthForm() {
  const [mode, setMode] = useState<Mode>("register");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
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
      const response = await fetch(mode === "forgot" ? "/api/auth/password-reset-code" : "/api/auth/email-verification-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        const fallbackMessage = response.status === 401 ? "Invalid email or password" : undefined;
        throw new Error(toChineseError(message || fallbackMessage));
      }
      setStatus("验证码已发送，请到邮箱查看。");
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

    if ((mode === "register" || mode === "forgot") && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if ((mode === "register" || mode === "forgot") && !emailCode.trim()) {
      setError("请填写邮箱验证码");
      return;
    }

    setIsSubmitting(true);

    const endpoint = mode === "register" ? "/api/auth/register/customer" : mode === "forgot" ? "/api/auth/password-reset" : "/api/auth/login";
    const normalizedEmail = normalizeEmail(email);
    const payload =
      mode === "register"
        ? {
            email: normalizedEmail,
            password,
            displayName: displayName.trim(),
            emailCode: emailCode.trim(),
            referralCode: referralCode.trim() || undefined
          }
        : mode === "forgot"
          ? {
              email: normalizedEmail,
              emailCode: emailCode.trim(),
              password
            }
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

      if (mode === "forgot") {
        setStatus("密码已重置，请使用新密码登录。");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setEmailCode("");
        return;
      }

      if (data.accessToken) {
        localStorage.setItem("dfc_customer_token", data.accessToken);
        localStorage.setItem("dfc_customer_user", JSON.stringify(data.user));
      }

      setStatus(mode === "register" ? "注册成功，正在进入客户中心。" : "登录成功，正在进入客户中心。");
      window.setTimeout(() => {
        window.location.href = "/customer/home/";
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请检查填写内容");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="maycat-neon-bg relative min-h-screen overflow-hidden px-4 py-5 text-dfc-text md:px-6 lg:px-10">
      <div className="maycat-grid" />
      <div className="maycat-light-streaks" />

      <div className="relative grid min-h-[calc(100vh-40px)] gap-6 md:grid-cols-[minmax(0,1fr)_430px] lg:gap-10">
        <section className="flex flex-col justify-center py-6">
          <div className="max-w-3xl">
            <MaycatLogo />
            <div className="maycat-chip mt-8 px-3 py-1 text-xs font-semibold">Maycat Club · KOOK / Discord 客服 · 人工试音派单</div>
            <h1 className="maycat-text-glow mt-5 text-4xl font-black leading-tight text-white md:text-6xl">May猫饼电竞</h1>
            <p className="mt-3 text-xl font-black text-cyan-200 md:text-2xl">先接待，再试音，确认舒服了再下单。</p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
              平台支持 KOOK 和 Discord：客户可以快捷登录、联系客服、进入试音频道；管理员可在后台记录充值、派单、订单、钱包和投诉，整个服务流程可追踪。
            </p>

            <div className="mt-6 overflow-hidden rounded-dfc border border-cyan-300/20 md:max-w-2xl">
              <div className="grid gap-4 p-4 md:grid-cols-[1fr_220px] md:p-5">
                <div className="flex flex-col justify-center">
                  <div className="maycat-chip px-3 py-1 text-xs font-semibold">Maycat Signal Desk</div>
                  <div className="mt-3 text-2xl font-black text-white">客服、KOOK、Discord、后台派单连成一条线</div>
                  <div className="mt-3 text-sm leading-6 text-cyan-50/80">
                    客户先说需求，客服整理信息，KOOK / DC 试音确认，管理员再转正式订单。
                  </div>
                </div>
                <MaycatSignalArtwork compact />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <PlatformPill label="KOOK" value="客服 / 试音 / 绑定" active={Boolean(publicConfig.support?.kookUrl)} />
              <PlatformPill label="Discord" value="客服 / 试音 / 登录" active={Boolean(publicConfig.support?.discordUrl)} />
              <PlatformPill label="VX 客服" value={publicConfig.support?.wechatId || "暂未配置"} active={Boolean(publicConfig.support?.wechatId)} />
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <CommunityLink href={publicConfig.support?.kookUrl || DEFAULT_SUPPORT_KOOK_URL} label="进入 KOOK 社群" />
              <CommunityLink href={publicConfig.support?.discordUrl || DEFAULT_SUPPORT_DISCORD_URL} label="进入 Discord 社群" />
            </div>
            <div className="mt-3 rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 px-3 py-3 text-xs leading-5 text-cyan-50/75">
              KOOK 链接打不开时，打开 KOOK 客户端，使用邀请代码：
              <span className="ml-1 font-mono text-sm font-black text-cyan-200">{KOOK_INVITE_CODE}</span>
              <span className="mx-2 text-dfc-muted">/</span>
              Discord 邀请链接：<span className="font-mono text-cyan-200">discord.gg/dX5prAZMPu</span>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <Feature label="人工充值" value="截图审核，到账留痕" />
              <Feature label="试音选人" value="先确认声音和沟通风格" />
              <Feature label="后台派单" value="订单、钱包、投诉可追踪" />
            </div>
          </div>
        </section>

        <section className="maycat-panel self-center p-4 md:p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="maycat-text-glow text-xl font-black text-white">
                {mode === "forgot" ? "重置密码" : mode === "login" ? "登录 May猫饼" : "加入 May猫饼"}
              </h2>
              <p className="mt-1 text-xs text-dfc-muted">客户入口 · 支持邮箱、KOOK、Discord</p>
            </div>
            <MaycatLogo compact />
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-dfc-control bg-[#0b1020]/80 p-1">
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`rounded-dfc-control px-3 py-2 text-sm font-black transition ${mode === "register" ? "maycat-button" : "text-dfc-subtext hover:text-cyan-200"}`}
            >
              注册
            </button>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`rounded-dfc-control px-3 py-2 text-sm font-black transition ${mode === "login" ? "maycat-button" : "text-dfc-subtext hover:text-cyan-200"}`}
            >
              登录
            </button>
          </div>

          <div className="mt-3 text-right">
            <button
              type="button"
              onClick={() => switchMode("forgot")}
              className={`text-xs font-semibold ${mode === "forgot" ? "text-cyan-300" : "text-dfc-subtext hover:text-cyan-300"}`}
            >
              忘记密码？用邮箱验证码重置
            </button>
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4" autoComplete={mode === "login" ? "on" : "off"}>
            {mode !== "forgot" ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <OAuthButton href="/api/auth/oauth/discord/start" label="Discord 登录" />
                  <OAuthButton href="/api/auth/oauth/kook/start" label="KOOK 登录" />
                </div>
                <div className="flex items-center gap-3 text-xs text-dfc-muted">
                  <span className="h-px flex-1 bg-cyan-300/15" />
                  <span>或使用邮箱</span>
                  <span className="h-px flex-1 bg-cyan-300/15" />
                </div>
              </>
            ) : null}

            <Field label="邮箱">
              <div className="flex gap-2">
                <input
                  required
                  type="email"
                  name={mode === "login" ? "email" : "maycat-register-email"}
                  autoComplete={mode === "login" ? "email" : "off"}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="maycat-input min-w-0 flex-1 px-3 py-3 text-sm"
                />
                {mode === "register" || mode === "forgot" ? (
                  <button
                    type="button"
                    onClick={sendEmailCode}
                    disabled={isSendingCode}
                    className="maycat-button-secondary shrink-0 px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSendingCode ? "发送中" : "发验证码"}
                  </button>
                ) : null}
              </div>
            </Field>

            {mode === "register" || mode === "forgot" ? (
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
                    className="maycat-input px-3 py-3 text-sm"
                  />
                </Field>

                {mode === "register" ? (
                  <>
                    <Field label="昵称">
                      <input
                        required
                        name="maycat-display-name"
                        autoComplete="off"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder="你的游戏昵称"
                        className="maycat-input px-3 py-3 text-sm"
                      />
                    </Field>

                    <Field label="邀请码（选填）">
                      <input
                        name="referral-code"
                        autoComplete="off"
                        value={referralCode}
                        onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                        placeholder="朋友或陪玩的推荐码"
                        className="maycat-input px-3 py-3 text-sm"
                      />
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}

            <Field label={mode === "forgot" ? "新密码" : "密码"}>
              <PasswordInput
                name={mode === "login" ? "current-password" : "maycat-new-password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={setPassword}
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((current) => !current)}
                placeholder="至少 8 位"
              />
            </Field>

            {mode === "register" || mode === "forgot" ? (
              <Field label="确认密码">
                <PasswordInput
                  name="maycat-confirm-password"
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

            <button type="submit" disabled={isSubmitting} className="maycat-button w-full px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60">
              {isSubmitting ? "提交中..." : mode === "register" ? "创建客户账号" : mode === "forgot" ? "重置密码" : "登录客户入口"}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-dfc-muted">
            <span>管理端和陪玩端请走独立入口</span>
            <div className="flex gap-3">
              <a href="/admin/" className="font-semibold text-cyan-300">
                管理端
              </a>
              <a href="/companion/" className="font-semibold text-cyan-300">
                陪玩端
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setStatus("");
    setError("");
    setShowPassword(false);
    if (nextMode === "login") {
      setEmailCode("");
      setConfirmPassword("");
      setReferralCode("");
    }
  }
}

function toChineseError(message?: string) {
  if (!message) return "请求失败，请检查填写内容";
  if (message.includes("Email is already registered")) return "这个邮箱已经注册过，请直接登录或换一个邮箱";
  if (message.includes("Display name is already taken")) return "这个昵称已经被使用，请换一个昵称";
  if (message.includes("Referral code is invalid")) return "邀请码无效，请检查后再提交，或留空注册";
  if (message.includes("Invalid email format")) return "邮箱格式不正确，请检查后再提交";
  if (message.includes("Verification code is invalid or expired")) return "验证码不正确或已过期，请重新获取";
  if (message.includes("Verification code has too many failed attempts")) return "验证码错误次数太多，请重新获取";
  if (message.includes("Please wait before requesting another verification code")) return "验证码刚刚发送过，请稍等 1 分钟再试";
  if (message.includes("Email service is not configured")) return "邮箱发送服务还没配置，请联系客服";
  if (message.includes("Database migration is not applied")) return "服务器数据库还没更新，请管理员执行数据库迁移后再注册";
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
      <span className="mb-2 block text-sm font-semibold text-cyan-50/80">{label}</span>
      {children}
    </label>
  );
}

function OAuthButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="maycat-button-secondary px-3 py-3 text-center text-sm font-black">
      {label}
    </a>
  );
}

function CommunityLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="maycat-button px-4 py-3 text-center text-sm font-black">
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
    <div className="flex rounded-dfc-control border border-cyan-300/24 bg-black/35 focus-within:border-cyan-300">
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
      <button type="button" onClick={onToggleShow} className="shrink-0 px-3 text-xs font-black text-cyan-300" aria-label={showPassword ? "隐藏密码" : "显示密码"}>
        {showPassword ? "隐藏" : "显示"}
      </button>
    </div>
  );
}

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <div className="maycat-card p-3">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function PlatformPill({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={`rounded-dfc-control border px-3 py-2 text-xs ${active ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "border-white/10 bg-white/5 text-dfc-muted"}`}>
      <span className="font-black text-white">{label}</span>
      <span className="ml-2">{value}</span>
    </div>
  );
}
