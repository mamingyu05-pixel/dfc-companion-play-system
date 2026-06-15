"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { CustomerShell } from "../components";

type CustomerMe = {
  user: {
    id: string;
    email: string;
    displayName: string;
    referralCode?: string | null;
  };
  wallet: {
    availableBalance: string;
    frozenBalance: string;
  } | null;
  recentOrders: Array<{
    orderNo: string;
    status: string;
  }>;
};

type PublicConfig = {
  support?: {
    discordUrl?: string | null;
    kookUrl?: string | null;
    wechatId?: string | null;
    wechatQrUrl?: string | null;
  };
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  topic?: string;
  handoffRequired?: boolean;
};

const quickTopics = ["充值未到账", "如何下单", "试音选人", "退款投诉", "陪玩入驻"];

export default function SupportPage() {
  const [profile, setProfile] = useState<CustomerMe | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "你好，我是 May猫饼自动客服。可以先问我充值、下单、试音、退款、陪玩入驻、KOOK/Discord 绑定等问题。"
    }
  ]);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;

    void fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unauthorized");
        return (await response.json()) as CustomerMe;
      })
      .then(setProfile)
      .catch(() => {
        localStorage.removeItem("dfc_customer_token");
        localStorage.removeItem("dfc_customer_user");
        window.location.href = "/customer/";
      });
  }, []);

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
  }, []);

  async function askAutoSupport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = question.trim();
    if (!message) return;

    const token = localStorage.getItem("dfc_customer_token");
    if (!token) {
      window.location.href = "/customer/";
      return;
    }

    setQuestion("");
    setError("");
    setChat((current) => [...current, { role: "user", text: message }]);
    setIsSending(true);
    try {
      const response = await fetch("/api/support/auto-reply", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message })
      });
      const data = (await response.json().catch(() => ({}))) as {
        answer?: string;
        matchedTopic?: string;
        handoffRequired?: boolean;
        message?: string | string[];
      };
      if (!response.ok) {
        const errorMessage = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(errorMessage || "自动客服暂时不可用");
      }
      setChat((current) => [
        ...current,
        {
          role: "assistant",
          text: data.answer || "这个问题需要转人工客服确认。",
          topic: data.matchedTopic,
          handoffRequired: data.handoffRequired
        }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "自动客服暂时不可用，请联系人工客服");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <CustomerShell>
      <section className="maycat-support-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <div className="maycat-chip px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Maycat Support Control</div>
            <h1 className="maycat-text-glow mt-5 max-w-3xl text-4xl font-black leading-tight text-white md:text-5xl">
              问题进线，快速分流。
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
              自动客服先处理常见问题；充值异常、试音派单、退款投诉会引导你转人工。联系人工时请带上账号邮箱、客户 ID、订单号或充值截图。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <SupportMetric label="当前账号" value={profile?.user.displayName ?? "加载中"} hint={formatAccountEmail(profile?.user.email)} />
            <SupportMetric label="客户 ID" value={profile?.user.id.slice(0, 8) ?? "-"} hint="联系客服时可提供" />
            <SupportMetric label="可用余额" value={`¥${formatMoney(profile?.wallet?.availableBalance ?? "0")}`} hint="当前账号钱包" />
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="maycat-card p-4 md:p-5">
          <div className="flex flex-col gap-2 border-b border-cyan-300/15 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-white">自动客服</h2>
              <p className="mt-1 text-xs text-dfc-muted">先描述问题，系统会匹配充值、下单、试音、退款等常见主题。</p>
            </div>
            <span className="rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-xs font-black text-dfc-success">
              在线
            </span>
          </div>
          <div className="mt-4 max-h-[460px] space-y-3 overflow-y-auto rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 p-3">
            {chat.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`rounded-dfc-control px-3 py-2 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-auto max-w-[85%] bg-cyan-300 text-slate-950"
                    : "mr-auto max-w-[92%] border border-cyan-300/20 bg-[#07111f]/80 text-dfc-text"
                }`}
              >
                {message.topic ? <div className="mb-1 text-xs text-dfc-muted">匹配主题：{message.topic}</div> : null}
                <div>{message.text}</div>
                {message.handoffRequired ? <div className="mt-2 text-xs text-dfc-warning">建议转人工客服继续处理。</div> : null}
              </div>
            ))}
            {isSending ? (
              <div className="mr-auto max-w-[92%] rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/80 px-3 py-2 text-sm text-dfc-subtext">
                正在生成回复...
              </div>
            ) : null}
          </div>
          <form onSubmit={askAutoSupport} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="maycat-input min-w-0 px-3 py-3 text-sm"
              placeholder="输入问题，例如：充值不到账怎么办？"
            />
            <button disabled={isSending || !question.trim()} className="maycat-button px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60">
              {isSending ? "回复中" : "发送"}
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {quickTopics.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setQuestion(item)}
                className="rounded-full border border-cyan-300/20 bg-[#07111f]/70 px-3 py-1 text-dfc-subtext hover:border-cyan-300/50 hover:text-cyan-100"
              >
                {item}
              </button>
            ))}
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>

        <div className="space-y-6">
          <div className="maycat-support-panel p-4">
            <h2 className="text-lg font-black text-white">人工客服</h2>
            <div className="mt-4 rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 p-3 text-sm text-dfc-subtext">
              <div>充值、退款、投诉、试音选人和陪玩入驻都可以联系人工客服。请优先提供账号邮箱、客户 ID、订单号或充值截图。</div>
              <div className="mt-3 rounded-dfc-control border border-cyan-300/25 bg-cyan-300/10 px-3 py-3">
                <span className="text-dfc-muted">VX 客服：</span>
                <span className="font-black text-cyan-200">{publicConfig.support?.wechatId || "暂未配置"}</span>
              </div>
              <div className="mt-3 rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/70 p-3">
                <div className="text-xs font-black text-white">VX 客服二维码</div>
                {publicConfig.support?.wechatQrUrl ? (
                  <img
                    src={publicConfig.support.wechatQrUrl}
                    alt="VX 客服二维码"
                    className="mt-2 h-36 w-36 rounded-dfc-control border border-cyan-300/20 bg-white object-cover p-2"
                  />
                ) : (
                  <div className="mt-2 flex h-36 w-36 items-center justify-center rounded-dfc-control border border-dashed border-cyan-300/20 text-center text-xs text-dfc-muted">
                    暂未配置二维码
                  </div>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <SupportLink href={publicConfig.support?.kookUrl ?? undefined} label="KOOK 联系客服" />
                <SupportLink href={publicConfig.support?.discordUrl ?? undefined} label="Discord 联系客服" />
              </div>
              <div className="mt-3 rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/70 p-3 text-xs leading-6">
                <div className="font-black text-white">链接打不开时</div>
                <div>
                  KOOK 客户端手动加入邀请码：
                  <span className="ml-1 font-mono font-black text-cyan-200">i0o2qA</span>
                </div>
                <div>
                  Discord 手动输入：
                  <span className="ml-1 font-mono font-black text-cyan-200">discord.gg/dX5prAZMPu</span>
                </div>
              </div>
              <div className="mt-4 font-black text-white">复制给客服</div>
              <div className="mt-3 rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/70 p-3 text-xs leading-6">
                <div>账号昵称：{profile?.user.displayName ?? "-"}</div>
                <div>账号邮箱：{formatAccountEmail(profile?.user.email)}</div>
                <div>客户 ID：{profile?.user.id ?? "-"}</div>
                <div>我的推荐码：{profile?.user.referralCode ?? "-"}</div>
                <div>最近订单：{profile?.recentOrders[0]?.orderNo ?? "暂无"}</div>
              </div>
            </div>
          </div>

          <div className="maycat-card p-4">
            <h2 className="text-lg font-black text-white">常见入口</h2>
            <div className="mt-4 space-y-3 text-sm text-dfc-subtext">
              <SupportItem title="充值未到账" desc="到充值页提交金额和截图，管理员审核通过后余额自动增加。" href="/recharge" action="去提交充值" />
              <SupportItem title="订单问题 / 退款投诉" desc="提供订单号、陪玩昵称、问题说明和截图，客服会转后台处理。" href="/home" action="查看我的订单" />
              <SupportItem title="试音选人" desc="联系人工客服进入 KOOK/DC 试音频道，确认后由后台转正式订单。" href="/support" action="联系人工客服" />
            </div>
          </div>
        </div>
      </section>
    </CustomerShell>
  );
}

function SupportLink({ href, label }: { href?: string; label: string }) {
  if (!href) {
    return (
      <span className="rounded-dfc-control border border-cyan-300/15 bg-[#050711]/70 px-3 py-3 text-center text-sm font-semibold text-dfc-muted">
        {label}未配置
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="maycat-button px-3 py-3 text-center text-sm font-black"
    >
      {label}
    </a>
  );
}

function SupportMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-dfc border border-cyan-300/20 bg-[#07111f]/70 p-4 backdrop-blur">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 truncate text-2xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 truncate text-xs text-cyan-100/70">{hint || "-"}</div>
    </div>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatAccountEmail(email?: string) {
  if (!email) return "-";
  return email.endsWith("@oauth.maycatplay.local") ? "第三方账号注册" : email;
}

function SupportItem({ title, desc, href, action }: { title: string; desc: string; href: string; action: string }) {
  return (
    <div className="rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/70 p-3">
      <div className="font-black text-white">{title}</div>
      <div className="mt-1 text-xs leading-5">{desc}</div>
      <Link href={href} className="mt-3 inline-block text-xs font-semibold text-cyan-300 hover:text-cyan-100">{action}</Link>
    </div>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}
