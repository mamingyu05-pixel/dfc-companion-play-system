"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { CustomerShell, SectionHeader, StatCard } from "../components";

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
  };
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  topic?: string;
  handoffRequired?: boolean;
};

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
      <SectionHeader
        title="客服中心"
        desc="自动客服先解决常见问题；充值异常、试音派单、退款投诉会引导你转人工客服。"
      />

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <StatCard label="当前账号" value={profile?.user.displayName ?? "加载中"} hint={profile?.user.email ?? "请先登录"} />
        <StatCard label="客户 ID" value={profile?.user.id.slice(0, 8) ?? "-"} hint="联系客服时可提供" />
        <StatCard label="可用余额" value={`¥${formatMoney(profile?.wallet?.availableBalance ?? "0")}`} hint="只显示当前账号余额" />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">自动客服</h2>
          <div className="mt-4 max-h-[460px] space-y-3 overflow-y-auto rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
            {chat.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`rounded-dfc-control px-3 py-2 text-sm leading-6 ${
                  message.role === "user" ? "ml-auto max-w-[85%] bg-dfc-blue text-slate-950" : "mr-auto max-w-[92%] border border-dfc-border bg-dfc-surface text-dfc-text"
                }`}
              >
                {message.topic ? <div className="mb-1 text-xs text-dfc-muted">匹配主题：{message.topic}</div> : null}
                <div>{message.text}</div>
                {message.handoffRequired ? <div className="mt-2 text-xs text-dfc-warning">建议转人工客服继续处理。</div> : null}
              </div>
            ))}
          </div>
          <form onSubmit={askAutoSupport} className="mt-4 flex gap-2">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="min-w-0 flex-1 rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="输入问题，例如：充值不到账怎么办？"
            />
            <button disabled={isSending} className="rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
              {isSending ? "回复中" : "发送"}
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {["充值未到账", "如何下单", "试音选人", "退款投诉", "陪玩入驻"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setQuestion(item)}
                className="rounded-full border border-dfc-border px-3 py-1 text-dfc-subtext hover:border-dfc-blue hover:text-dfc-blue"
              >
                {item}
              </button>
            ))}
          </div>
          {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
        </div>

        <div className="space-y-6">
          <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
            <h2 className="text-base font-semibold">人工客服</h2>
            <div className="mt-4 rounded-dfc-control border border-dfc-border bg-dfc-bg p-3 text-sm text-dfc-subtext">
              <div>充值、退款、投诉、试音选人和陪玩入驻都可以联系人工客服。请优先提供账号邮箱、客户 ID、订单号或充值截图。</div>
              <div className="mt-3 rounded-dfc-control border border-dfc-blue/30 bg-dfc-blue/10 px-3 py-3">
                <span className="text-dfc-muted">VX 客服：</span>
                <span className="font-semibold text-dfc-blue">{publicConfig.support?.wechatId || "暂未配置"}</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <SupportLink href={publicConfig.support?.kookUrl ?? undefined} label="KOOK 联系客服" />
                <SupportLink href={publicConfig.support?.discordUrl ?? undefined} label="Discord 联系客服" />
              </div>
              <div className="mt-4">复制给客服：</div>
              <div className="mt-3 rounded-dfc-control border border-dfc-border bg-dfc-surface p-3 text-xs leading-6">
                <div>账号昵称：{profile?.user.displayName ?? "-"}</div>
                <div>账号邮箱：{formatAccountEmail(profile?.user.email)}</div>
                <div>客户 ID：{profile?.user.id ?? "-"}</div>
                <div>我的推荐码：{profile?.user.referralCode ?? "-"}</div>
                <div>最近订单：{profile?.recentOrders[0]?.orderNo ?? "暂无"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
            <h2 className="text-base font-semibold">常见入口</h2>
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
      <span className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-3 py-3 text-center text-sm font-semibold text-dfc-muted">
        {label}未配置
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-dfc-control bg-dfc-blue px-3 py-3 text-center text-sm font-semibold text-slate-950"
    >
      {label}
    </a>
  );
}

function formatAccountEmail(email?: string) {
  if (!email) return "-";
  return email.endsWith("@oauth.maycatplay.local") ? "第三方账号注册" : email;
}

function SupportItem({ title, desc, href, action }: { title: string; desc: string; href: string; action: string }) {
  return (
    <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
      <div className="font-semibold text-dfc-text">{title}</div>
      <div className="mt-1 text-xs leading-5">{desc}</div>
      <Link href={href} className="mt-3 inline-block text-xs font-semibold text-dfc-blue">{action}</Link>
    </div>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}
