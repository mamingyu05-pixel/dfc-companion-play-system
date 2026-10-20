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

export default function DemandGuide() {
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [mode, setMode] = useState("");
  const [hours, setHours] = useState("1");
  const [start, setStart] = useState("现在");
  const [time, setTime] = useState("");
  const [trial, setTrial] = useState("不需要试音");
  const [note, setNote] = useState("");
  const ready = Boolean(mode && (start === "现在" || time));
  const demand = `找陪玩；游戏：三角洲行动；模式：${mode || "请选择"}；时长：${hours}小时；开始时间：${start}${start === "现在" ? "" : time}；${trial}；预算：按陪玩报价确认。${note.trim() ? `备注：${note.trim()}` : ""}`;
  const [copyStatus, setCopyStatus] = useState("");

  async function copyDemand() {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(demand);
      setCopyStatus("需求已复制，尚未发送。到群里粘贴并发送，看到需求编号才算记录成功。");
    } catch {
      setCopyStatus("无法自动复制，请选中上方内容后手动复制。");
    }
  }

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
  }, []);

  const kookUrl = publicConfig.support?.kookUrl?.trim() || "";
  const discordUrl = publicConfig.support?.discordUrl?.trim() || "";

  return (
    <CustomerShell>
      <section className="maycat-order-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 md:p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
          <div>
            <div className="maycat-chip px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Maycat Order Guide</div>
            <h1 className="maycat-text-glow mt-4 max-w-3xl text-3xl font-black leading-tight text-white md:text-5xl">
              先试音或预约：只生成需求
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
              选好模式和时长，复制需求到 KOOK 或 Discord。客服核对需求后给出编号；确定陪玩、时长和最终价格，再确认正式订单。
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <GuideStep index="01" title="选服务" desc="模式、时长一次选好" />
            <GuideStep index="02" title="确认需求" desc="复制到群里，核对后发送" />
            <GuideStep index="03" title="看回执" desc="凭编号查看进度，结果不明先核对" />
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="maycat-card p-4 md:p-5">
          <h2 className="text-lg font-black text-white">下单请到群里</h2>
          <div className="mt-4 space-y-3 text-sm leading-7 text-dfc-subtext">
            <p>任选其一：</p>
            <p>▸ KOOK：在 #AI 派单 频道粘贴需求，核对后发送</p>
            <p>▸ Discord：在 #ai-派单 频道粘贴需求，核对后发送</p>
          </div>

          <div className="mt-5 rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 p-4">
            <h3 className="text-sm font-black text-cyan-100">三角洲行动 · 需求选择</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2" onChange={() => setCopyStatus("")}>
              <label>模式<select aria-label="模式" className="maycat-input mt-2 w-full p-3" value={mode} onChange={e => setMode(e.target.value)}><option value="">请选择模式</option><option>烽火地带</option><option>全面战场</option></select></label>
              <label>时长<select aria-label="时长" className="maycat-input mt-2 w-full p-3" value={hours} onChange={e => setHours(e.target.value)}>{[1,2,3,4].map(value => <option key={value} value={value}>{value} 小时</option>)}</select></label>
              <label>开始时间<select aria-label="开始时间" className="maycat-input mt-2 w-full p-3" value={start} onChange={e => setStart(e.target.value)}><option>现在</option><option>今晚</option><option>明天</option></select></label>
              <label>是否试音<select aria-label="是否试音" className="maycat-input mt-2 w-full p-3" value={trial} onChange={e => setTrial(e.target.value)}><option>不需要试音</option><option>需要试音</option></select></label>
              {start !== "现在" ? <label>具体时间<input aria-label="预约时间" type="time" className="maycat-input mt-2 w-full p-3" value={time} onChange={e => setTime(e.target.value)} /></label> : null}
            </div>
            <details className="mt-3"><summary className="cursor-pointer text-sm text-cyan-100">补充偏好或备注（选填）</summary><textarea aria-label="补充备注" className="maycat-input mt-2 w-full p-3" maxLength={300} value={note} onChange={e => { setNote(e.target.value); setCopyStatus(""); }} /></details>
            <label className="mt-4 block text-sm text-dfc-subtext">核对需求<textarea aria-label="下单内容" readOnly className="maycat-input mt-2 min-h-28 w-full p-3" value={demand} /></label>
            <button type="button" className="maycat-button mt-3 px-4 py-3 text-sm font-black" disabled={!ready} onClick={() => void copyDemand()}>复制需求</button>
            {copyStatus ? <p role="status" className="mt-2 text-sm text-cyan-100">{copyStatus}</p> : null}
            <p className="mt-3 text-xs text-dfc-muted">预算默认按陪玩报价确认，无需重复填写游戏、预算和个人资料。复制不会发送消息、下单或扣费；试音安排与正式订单分开确认。</p>
          </div>

          <div className="mt-5 rounded-dfc-control border border-dfc-warning/40 bg-dfc-warning/10 px-3 py-3 text-sm leading-6 text-dfc-warning">
            正式下单前，仍须核对陪玩、时长、单价和总额，并确认余额充足。收到需求编号不代表已扣款或已接单；结果不明先核对原编号，不要重复提交。
          </div>
        </div>

        <aside className="maycat-price-console p-4 lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-base font-black text-white">快速入口</h2>
          <div className="mt-4 grid gap-3">
            <a href={kookUrl || "/support"} target={kookUrl ? "_blank" : undefined} rel={kookUrl ? "noreferrer" : undefined} className="maycat-button px-4 py-3 text-center text-sm font-black">
              {kookUrl ? "进入 KOOK 发需求" : "KOOK 未配置，联系客服"}
            </a>
            <a href={discordUrl || "/support"} target={discordUrl ? "_blank" : undefined} rel={discordUrl ? "noreferrer" : undefined} className="maycat-button-secondary px-4 py-3 text-center text-sm font-black">
              {discordUrl ? "进入 Discord 发需求" : "Discord 未配置，联系客服"}
            </a>
            <Link href="/orders" className="maycat-button-secondary px-4 py-3 text-center text-sm font-black">查看正式订单进度</Link>
            <Link href="/recharge" className="maycat-button-secondary px-4 py-3 text-center text-sm font-black">
              去充值
            </Link>
          </div>
          <div className="mt-5 rounded-dfc-control border border-cyan-300/20 bg-cyan-300/10 p-3 text-xs leading-6 text-cyan-50/85">
            这里仅生成试音或预约需求，不会创建正式订单。直接下单请返回订单页。
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
