"use client";

import { FormEvent, useState } from "react";
import { AdminShell, SectionHeader } from "../../components";

const gameOptions = [
  ["DELTA_FORCE", "三角洲行动"],
  ["LEAGUE_OF_LEGENDS", "英雄联盟"],
  ["VALORANT", "无畏契约"],
  ["COUNTER_STRIKE_2", "CS2"],
  ["PUBG", "PUBG 绝地求生"],
  ["PUBG_MOBILE", "PUBG Mobile"],
  ["APEX_LEGENDS", "Apex 英雄"],
  ["NARAKA_BLADEPOINT", "永劫无间"],
  ["HONOR_OF_KINGS", "王者荣耀"],
  ["PEACEKEEPER_ELITE", "和平精英"],
  ["DOTA_2", "Dota 2"],
  ["OVERWATCH_2", "守望先锋 2"],
  ["RAINBOW_SIX_SIEGE", "彩虹六号：围攻"],
  ["ROCKET_LEAGUE", "火箭联盟"],
  ["EA_SPORTS_FC", "EA Sports FC"],
  ["STREET_FIGHTER_6", "街头霸王 6"],
  ["CALL_OF_DUTY", "使命召唤"],
  ["WILD_RIFT", "英雄联盟手游"],
  ["MOBILE_LEGENDS", "Mobile Legends"],
  ["MINECRAFT", "我的世界"],
  ["GENSHIN_IMPACT", "原神"]
] as const;

export default function NewCompanionPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [game, setGame] = useState("DELTA_FORCE");
  const [pricePerHour, setPricePerHour] = useState("");
  const [gender, setGender] = useState("MOON");
  const [deltaForceRank, setDeltaForceRank] = useState("UNRANKED");
  const [skillModes, setSkillModes] = useState("Hot Zone, Warfare");
  const [bio, setBio] = useState("");
  const [voicePreference, setVoicePreference] = useState("OPTIONAL");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");

    const response = await fetch("/api/admin/companions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        nickname,
        avatarUrl: avatarUrl.trim() || undefined,
        gender: gender === "UNSET" ? undefined : gender,
        game,
        pricePerHour,
        deltaForceRank,
        skillModes: skillModes.split(",").map((item) => item.trim()).filter(Boolean),
        bio,
        voicePreference
      })
    });

    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message ?? "创建陪玩失败");
      return;
    }

    setEmail("");
    setPassword("");
    setNickname("");
    setAvatarUrl("");
    setGender("MOON");
    setBio("");
    setStatus("陪玩账号已创建，请到陪玩管理页面审核上架。");
  }

  return (
    <AdminShell>
      <SectionHeader eyebrow="Roster Intake" title="添加陪玩" desc="创建真实陪玩账号、钱包和资料。新陪玩默认进入待审核状态，上架后客户才能下单。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <form onSubmit={submit} className="admin-panel">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="邮箱" value={email} onChange={setEmail} type="email" required />
            <Field label="初始密码" value={password} onChange={setPassword} type="password" required />
            <Field label="昵称" value={nickname} onChange={setNickname} required />
            <Field label="头像 URL" value={avatarUrl} onChange={setAvatarUrl} />
            <Field label="每小时价格" value={pricePerHour} onChange={setPricePerHour} required />
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">游戏</span>
              <select value={game} onChange={(event) => setGame(event.target.value)} className="input">
                {gameOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">段位/水平</span>
              <select value={deltaForceRank} onChange={(event) => setDeltaForceRank(event.target.value)} className="input">
                <option value="UNRANKED">UNRANKED</option>
                <option value="BRONZE">BRONZE</option>
                <option value="SILVER">SILVER</option>
                <option value="GOLD">GOLD</option>
                <option value="PLATINUM">PLATINUM</option>
                <option value="DIAMOND">DIAMOND</option>
                <option value="ASCENDANT">ASCENDANT</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">语音偏好</span>
              <select value={voicePreference} onChange={(event) => setVoicePreference(event.target.value)} className="input">
                <option value="REQUIRED">必须语音</option>
                <option value="OPTIONAL">可语音</option>
                <option value="TEXT_ONLY">仅文字</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">声线标签</span>
              <select value={gender} onChange={(event) => setGender(event.target.value)} className="input">
                <option value="MOON">🌙 月影声线</option>
                <option value="SOLAR">☀️ 曜刃声线</option>
                <option value="UNSET">暂不分类</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-black text-dfc-muted">擅长模式，用逗号分隔</span>
            <input value={skillModes} onChange={(event) => setSkillModes(event.target.value)} className="input" />
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-black text-dfc-muted">个人简介</span>
            <textarea value={bio} onChange={(event) => setBio(event.target.value)} className="input min-h-28" />
          </label>
          <button className="mt-5 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200">
            创建陪玩
          </button>
        </form>

        <aside className="admin-panel">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-200">Checklist</div>
          <h2 className="mt-2 text-lg font-black text-white">建档前检查</h2>
          <div className="mt-4 space-y-3">
            <GuideItem title="资料真实" desc="昵称、价格、段位和擅长模式会影响客户选择。" />
            <GuideItem title="先建后审" desc="新陪玩创建后不会自动上架，需要到陪玩管理页审核。" />
            <GuideItem title="平台绑定" desc="KOOK / Discord 绑定后，派单通知才更稳定。" />
          </div>
        </aside>
      </section>
    </AdminShell>
  );
}

function Field({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-black text-dfc-muted">{label}</span>
      <input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="input" />
    </label>
  );
}

function GuideItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="admin-queue-item">
      <div className="text-sm font-black text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-dfc-subtext">{desc}</div>
    </div>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
