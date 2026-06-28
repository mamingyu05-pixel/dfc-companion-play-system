"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerShell } from "../components";

type PublicConfig = {
  support?: {
    discordUrl?: string | null;
    kookUrl?: string | null;
  };
};

const DEFAULT_KOOK_URL = "https://kook.vip/i0o2qA";
const DEFAULT_DISCORD_URL = "https://discord.gg/dX5prAZMPu";

export default function OrderPage() {
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
  }, []);

  const kookUrl = publicConfig.support?.kookUrl || DEFAULT_KOOK_URL;
  const discordUrl = publicConfig.support?.discordUrl || DEFAULT_DISCORD_URL;

  return (
    <CustomerShell>
      <section className="maycat-order-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 md:p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
          <div>
            <div className="maycat-chip px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Maycat Order Guide</div>
            <h1 className="maycat-text-glow mt-4 max-w-3xl text-3xl font-black leading-tight text-white md:text-5xl">
              May猫饼下单方式
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
              本站不在网页下单，网页仅用于查钱包余额、看充值记录、浏览陪玩和查订单进度。下单请到 KOOK 或 Discord 群里发单，客服确认后从余额扣费并派单。
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <GuideStep index="01" title="先充值" desc="确认钱包余额充足" />
            <GuideStep index="02" title="群里发单" desc="AI 派单频道按格式发" />
            <GuideStep index="03" title="后台记账" desc="客服确认并扣余额" />
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="maycat-card p-4 md:p-5">
          <h2 className="text-lg font-black text-white">下单请到群里</h2>
          <div className="mt-4 space-y-3 text-sm leading-7 text-dfc-subtext">
            <p>任选其一：</p>
            <p>▸ KOOK：在 #AI 派单 频道按格式发单</p>
            <p>▸ Discord：在 #ai-派单 频道按格式发单</p>
          </div>

          <div className="mt-5 rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 p-4">
            <h3 className="text-sm font-black text-cyan-100">下单格式</h3>
            <div className="mt-3 grid gap-2 text-sm leading-7 text-dfc-subtext sm:grid-cols-2">
              <FormatItem label="游戏" />
              <FormatItem label="模式" />
              <FormatItem label="时长(小时)" />
              <FormatItem label="预算" value="或填“按陪玩报价”" />
              <FormatItem label="试听" value="需要 / 不需要" />
              <FormatItem label="开始时间" />
              <FormatItem label="陪玩偏好" />
              <FormatItem label="备注" />
            </div>
          </div>

          <div className="mt-5 rounded-dfc-control border border-dfc-warning/40 bg-dfc-warning/10 px-3 py-3 text-sm leading-6 text-dfc-warning">
            下单前请确认钱包余额充足。客服确认后由后台从余额扣费并派单；下单、扣费、服务、收入均以后台记录为准。
          </div>
        </div>

        <aside className="maycat-price-console p-4 lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-base font-black text-white">快速入口</h2>
          <div className="mt-4 grid gap-3">
            <a href={kookUrl} target="_blank" rel="noreferrer" className="maycat-button px-4 py-3 text-center text-sm font-black">
              进入 KOOK 下单
            </a>
            <a href={discordUrl} target="_blank" rel="noreferrer" className="maycat-button-secondary px-4 py-3 text-center text-sm font-black">
              进入 Discord 下单
            </a>
            <Link href="/recharge" className="maycat-button-secondary px-4 py-3 text-center text-sm font-black">
              去充值
            </Link>
          </div>
          <div className="mt-5 rounded-dfc-control border border-cyan-300/20 bg-cyan-300/10 p-3 text-xs leading-6 text-cyan-50/85">
            网页只做余额、充值记录、陪玩资料和订单进度查询，不提供网页提交订单或在线支付。
          </div>
        </aside>
      </section>
    </CustomerShell>
  );
}

function GuideStep({ index, title, desc }: { index: string; title: string; desc: string }) {
  return (
    <div className="rounded-dfc border border-cyan-300/20 bg-[#07111f]/70 px-3 py-3">
      <div className="text-[11px] font-black text-fuchsia-300">{index}</div>
      <div className="mt-1 text-sm font-black text-white">{title}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{desc}</div>
    </div>
  );
}

function FormatItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-dfc-control border border-cyan-300/15 bg-[#07111f]/70 px-3 py-2">
      <span className="font-black text-cyan-100">{label}</span>
      {value ? <span className="ml-2 text-dfc-muted">{value}</span> : null}
    </div>
  );
}
