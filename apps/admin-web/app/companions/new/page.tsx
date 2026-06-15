"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import type { ReactNode } from "react";
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

type UploadPurpose = "avatar" | "photo" | "voice";

export default function NewCompanionPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [voiceIntroUrl, setVoiceIntroUrl] = useState("");
  const [game, setGame] = useState("DELTA_FORCE");
  const [pricePerHour, setPricePerHour] = useState("");
  const [gender, setGender] = useState("MOON");
  const [deltaForceRank, setDeltaForceRank] = useState("UNRANKED");
  const [skillModes, setSkillModes] = useState("Hot Zone, Warfare");
  const [bio, setBio] = useState("");
  const [voicePreference, setVoicePreference] = useState("OPTIONAL");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState("");

  async function uploadMedia(file: File, purpose: UploadPurpose) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) throw new Error("请先登录管理端");
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", file);
    setUploading(purpose);
    try {
      const response = await fetch("/api/uploads/companion-media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string | string[] };
      if (!response.ok || !data.url) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(message ?? "上传失败");
      }
      return data.url;
    } finally {
      setUploading("");
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setAvatarUrl(await uploadMedia(file, "avatar"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "头像上传失败");
    } finally {
      event.target.value = "";
    }
  }

  async function handlePhotosChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, 9 - photoUrls.length));
    if (!files.length) return;
    setError("");
    try {
      const uploaded: string[] = [];
      for (const file of files) uploaded.push(await uploadMedia(file, "photo"));
      setPhotoUrls((current) => [...current, ...uploaded].slice(0, 9));
    } catch (err) {
      setError(err instanceof Error ? err.message : "照片上传失败");
    } finally {
      event.target.value = "";
    }
  }

  async function handleVoiceChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setVoiceIntroUrl(await uploadMedia(file, "voice"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "语音上传失败");
    } finally {
      event.target.value = "";
    }
  }

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
        avatarUrl: avatarUrl || undefined,
        photoUrls,
        voiceIntroUrl: voiceIntroUrl || undefined,
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
    setPhotoUrls([]);
    setVoiceIntroUrl("");
    setGender("MOON");
    setBio("");
    setStatus("陪玩账号已创建，默认待审核。请到陪玩管理页审核上架。");
  }

  return (
    <AdminShell>
      <SectionHeader eyebrow="Roster Intake" title="添加陪玩" desc="创建真实陪玩账号、钱包和资料。头像、展示照片、语音介绍直接上传，不再填写外部 URL。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <form onSubmit={submit} className="admin-panel">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="邮箱" value={email} onChange={setEmail} type="email" required />
            <Field label="初始密码" value={password} onChange={setPassword} type="password" required />
            <Field label="昵称" value={nickname} onChange={setNickname} required />
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
                <option value="MOON">月影声线</option>
                <option value="SOLAR">曜刃声线</option>
                <option value="UNSET">暂不分类</option>
              </select>
            </label>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <UploadBox label="头像" hint="建议方图，展示在列表和详情页" accept="image/*" uploading={uploading === "avatar"} onChange={handleAvatarChange}>
              {avatarUrl ? <img src={avatarUrl} alt="头像预览" className="h-24 w-24 rounded-dfc object-cover" /> : null}
            </UploadBox>
            <UploadBox label="展示照片" hint="最多 9 张，用于陪玩详情展示" accept="image/*" multiple uploading={uploading === "photo"} onChange={handlePhotosChange}>
              <div className="grid grid-cols-3 gap-2">
                {photoUrls.map((url) => (
                  <button key={url} type="button" onClick={() => setPhotoUrls((current) => current.filter((item) => item !== url))} className="overflow-hidden rounded-dfc-control border border-cyan-300/20">
                    <img src={url} alt="展示照片" className="h-16 w-full object-cover" />
                  </button>
                ))}
              </div>
            </UploadBox>
            <UploadBox label="语音介绍" hint="上传 10-30 秒语音，方便客户试听" accept="audio/*" uploading={uploading === "voice"} onChange={handleVoiceChange}>
              {voiceIntroUrl ? <audio controls src={voiceIntroUrl} className="mt-2 w-full" /> : null}
            </UploadBox>
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
          <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-200">Media Rule</div>
          <h2 className="mt-2 text-lg font-black text-white">资料上传规范</h2>
          <div className="mt-4 space-y-3">
            <GuideItem title="头像真实清晰" desc="客户第一眼会看头像，尽量使用清晰、可信的个人形象或统一风格头像。" />
            <GuideItem title="照片不要过多" desc="展示照片最多 9 张，优先放游戏截图、陪玩人设图、服务说明图。" />
            <GuideItem title="语音介绍要短" desc="建议 10-30 秒，说清声线、擅长游戏、服务风格，不要放联系方式。" />
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

function UploadBox({ label, hint, accept, multiple, uploading, onChange, children }: { label: string; hint: string; accept: string; multiple?: boolean; uploading: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void; children?: ReactNode }) {
  return (
    <label className="block rounded-dfc border border-cyan-300/15 bg-[#050711]/50 p-3">
      <span className="block text-xs font-black text-dfc-muted">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-dfc-subtext">{hint}</span>
      <input type="file" accept={accept} multiple={multiple} onChange={onChange} className="mt-3 block w-full text-xs text-dfc-subtext file:mr-3 file:rounded-dfc-control file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:text-xs file:font-black file:text-slate-950" />
      {uploading ? <div className="mt-2 text-xs text-cyan-300">上传中...</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
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
