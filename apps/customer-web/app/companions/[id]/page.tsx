"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, CompanionAvatar, CustomerShell, SectionHeader } from "../../components";
import { games } from "../../data";

type ApiCompanion = {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  game: string;
  onlineStatus: string;
  deltaForceRank: string;
  skillModes: string[];
  pricePerHour: string;
  voicePreference: string;
  bio?: string | null;
};

export default function CompanionDetailPage() {
  const params = useParams<{ id: string }>();
  const [companion, setCompanion] = useState<ApiCompanion | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/orders/public/companions")
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载陪玩资料");
        const companions = (await response.json()) as ApiCompanion[];
        const matched = companions.find((item) => item.id === params.id);
        if (!matched) throw new Error("陪玩未上架或不存在");
        setCompanion(matched);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "无法加载陪玩资料"));
  }, [params.id]);

  if (error) {
    return (
      <CustomerShell>
        <div className="rounded-dfc border border-dfc-danger/40 bg-dfc-danger/10 p-4 text-sm text-dfc-danger">{error}</div>
      </CustomerShell>
    );
  }

  if (!companion) {
    return (
      <CustomerShell>
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">正在加载陪玩资料...</div>
      </CustomerShell>
    );
  }

  return (
    <CustomerShell>
      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <SectionHeader title={companion.nickname} desc={companion.bio || "该陪玩资料来自后台真实上架信息。"} />

          <div className="mt-5 flex flex-wrap gap-2">
            <Badge tone={companion.onlineStatus === "ONLINE" ? "gold" : "default"}>{toOnlineStatus(companion.onlineStatus)}</Badge>
            <Badge>{gameName(companion.game)}</Badge>
            <Badge>{companion.deltaForceRank}</Badge>
            <Badge>{toVoice(companion.voicePreference)}</Badge>
            {companion.skillModes.map((mode) => (
              <Badge key={mode}>{mode}</Badge>
            ))}
          </div>

          <section className="mt-8 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
            <h2 className="text-base font-semibold">服务特点</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(companion.skillModes.length ? companion.skillModes : ["平台审核", "可派单", "资料真实"]).map((tag) => (
                <div key={tag} className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3 text-sm text-dfc-subtext">
                  {tag}
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
            <h2 className="text-base font-semibold">下单说明</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-dfc-subtext">
              <li>只有后台已上架陪玩会出现在客户列表。</li>
              <li>可申请进入临时语音频道试音，试音不代表订单开始。</li>
              <li>陪玩接单后订单开始前仍可联系客服处理异常。</li>
              <li>金额由后端按单价和时长计算，前端仅展示确认信息。</li>
            </ul>
          </section>
        </div>

        <aside className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <CompanionAvatar nickname={companion.nickname} avatarUrl={companion.avatarUrl} size="lg" />
          <div className="mt-4 text-sm text-dfc-muted">每小时</div>
          <div className="text-3xl font-semibold text-dfc-blue">¥{Number(companion.pricePerHour).toFixed(2)}</div>
          <div className="mt-2 text-sm text-dfc-subtext">{toOnlineStatus(companion.onlineStatus)} · {toVoice(companion.voicePreference)}</div>
          <Link
            href={`/order?companion=${companion.id}&game=${companion.game}`}
            className="mt-5 block rounded-dfc-control bg-dfc-blue px-4 py-3 text-center text-sm font-semibold text-slate-950"
          >
            立即下单
          </Link>
          <Link
            href={`/order?companion=${companion.id}&game=${companion.game}&trial=1`}
            className="mt-3 block rounded-dfc-control border border-dfc-blue/50 px-4 py-3 text-center text-sm font-semibold text-dfc-blue"
          >
            申请试音
          </Link>
        </aside>
      </section>
    </CustomerShell>
  );
}

function gameName(code: string) {
  return games.find((game) => game.code === code)?.name ?? code;
}

function toOnlineStatus(value: string) {
  if (value === "ONLINE") return "在线";
  if (value === "BUSY") return "忙碌";
  if (value === "OFFLINE") return "离线";
  return value;
}

function toVoice(value: string) {
  if (value === "REQUIRED") return "必须语音";
  if (value === "TEXT_ONLY") return "仅文字";
  return "可语音";
}
