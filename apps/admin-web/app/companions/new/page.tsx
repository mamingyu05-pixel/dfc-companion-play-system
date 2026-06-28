"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AdminShell, SectionHeader } from "../../components";

const gameOptions = [
  ["DELTA_FORCE", "三角洲行动"],
  ["LEAGUE_OF_LEGENDS", "英雄联盟"],
  ["VALORANT", "无畏契约"],
  ["COUNTER_STRIKE_2", "CS2"],
  ["PUBG", "PUBG 绝地求生"],
  ["APEX_LEGENDS", "Apex 英雄"],
  ["NARAKA_BLADEPOINT", "永劫无间"],
  ["CALL_OF_DUTY", "塔科夫 / COD"]
] as const;

type UploadPurpose = "avatar" | "photo" | "voice";
type CreationMode = "existing" | "email";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  status: string;
  displayName: string;
  companionProfile: { nickname: string } | null;
  externalAccounts: Array<{
    platform: string;
    externalUserId: string;
    displayName?: string | null;
  }>;
};

export default function NewCompanionPage() {
  const [mode, setMode] = useState<CreationMode>("existing");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [voiceIntroUrl, setVoiceIntroUrl] = useState("");
  const [game, setGame] = useState("DELTA_FORCE");
  const [selectedGames, setSelectedGames] = useState<string[]>(["DELTA_FORCE"]);
  const [pricePerHour, setPricePerHour] = useState("");
  const [kookPricePerHour, setKookPricePerHour] = useState("");
  const [discordPricePerHour, setDiscordPricePerHour] = useState("");
  const [entertainmentPricePerHour, setEntertainmentPricePerHour] = useState("");
  const [rankedPricePerHour, setRankedPricePerHour] = useState("");
  const [highRankedPricePerHour, setHighRankedPricePerHour] = useState("");
  const [gender, setGender] = useState("MOON");
  const [deltaForceRank, setDeltaForceRank] = useState("UNRANKED");
  const [skillModes, setSkillModes] = useState("Hot Zone, Warfare");
  const [bio, setBio] = useState("");
  const [voicePreference, setVoicePreference] = useState("OPTIONAL");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState("");

  async function loadUsers() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setIsLoadingUsers(true);
    try {
      const response = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("无法加载用户列表");
      setUsers((await response.json()) as AdminUser[]);
    } finally {
      setIsLoadingUsers(false);
    }
  }

  useEffect(() => {
    void loadUsers().catch(() => {
      setIsLoadingUsers(false);
      setError("无法加载已注册或平台入会用户，请刷新后重试");
    });
  }, []);

  const companionCandidates = useMemo(
    () =>
      users.filter(
        (user) =>
          ["CUSTOMER", "ADMIN", "SUPER_ADMIN", "COMPANION"].includes(user.role) &&
          user.status === "ACTIVE" &&
          !user.companionProfile
      ),
    [users]
  );

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

    if (mode === "existing" && !selectedUserId) {
      setError("请先选择一个已注册或已进入 Discord / KOOK 的账号");
      return;
    }

    const endpoint = mode === "existing" ? `/api/admin/users/${selectedUserId}/become-companion` : "/api/admin/companions";
    const method = mode === "existing" ? "PATCH" : "POST";
    const games = normalizeSelectedGames(selectedGames, game);
    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...(mode === "email" ? { email, password } : {}),
        nickname,
        avatarUrl: avatarUrl || undefined,
        photoUrls,
        voiceIntroUrl: voiceIntroUrl || undefined,
        gender: gender === "UNSET" ? undefined : gender,
        game: games[0],
        games,
        pricePerHour,
        kookPricePerHour: kookPricePerHour || undefined,
        discordPricePerHour: discordPricePerHour || undefined,
        entertainmentPricePerHour: entertainmentPricePerHour || undefined,
        rankedPricePerHour: rankedPricePerHour || undefined,
        highRankedPricePerHour: highRankedPricePerHour || undefined,
        deltaForceRank,
        skillModes: skillModes.split(",").map((item) => item.trim()).filter(Boolean),
        bio,
        voicePreference,
        note: mode === "existing" ? "管理端添加陪玩页开通陪玩身份" : undefined
      })
    });

    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message ?? (mode === "existing" ? "开通陪玩身份失败" : "创建陪玩失败"));
      return;
    }

    setEmail("");
    setPassword("");
    setSelectedUserId("");
    setNickname("");
    setAvatarUrl("");
    setPhotoUrls([]);
    setVoiceIntroUrl("");
    setGender("MOON");
    setGame("DELTA_FORCE");
    setSelectedGames(["DELTA_FORCE"]);
    setPricePerHour("");
    setKookPricePerHour("");
    setDiscordPricePerHour("");
    setEntertainmentPricePerHour("");
    setRankedPricePerHour("");
    setHighRankedPricePerHour("");
    setBio("");
    setStatus(mode === "existing" ? "陪玩身份已开通，默认待审核。请到陪玩管理页审核上架。" : "陪玩账号已创建，默认待审核。请到陪玩管理页审核上架。");
    await loadUsers().catch(() => undefined);
  }

  return (
    <AdminShell>
      <SectionHeader eyebrow="Roster Intake" title="添加陪玩" desc="创建真实陪玩账号、钱包和资料。头像、展示照片、语音介绍直接上传，不再填写外部 URL。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <form onSubmit={submit} className="admin-panel">
          <div className="mb-5 grid gap-3 md:grid-cols-2">
            <ModeButton active={mode === "existing"} title="已入会用户开通" desc="优先选择 Discord / KOOK / 已注册账号，不需要邮箱和初始密码。" onClick={() => setMode("existing")} />
            <ModeButton active={mode === "email"} title="邮箱创建账号" desc="只在对方没有 Discord / KOOK，也没有网站账号时使用。" onClick={() => setMode("email")} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {mode === "existing" ? (
              <label className="block md:col-span-2">
                <span className="mb-2 block text-xs font-black text-dfc-muted">选择要开通陪玩身份的账号</span>
                <select
                  value={selectedUserId}
                  onChange={(event) => {
                    const user = users.find((item) => item.id === event.target.value);
                    setSelectedUserId(event.target.value);
                    if (user && !nickname) setNickname(user.displayName);
                  }}
                  className="input"
                  required
                >
                  <option value="">{isLoadingUsers ? "正在加载用户..." : "选择 Discord / KOOK / 已注册账号"}</option>
                  {companionCandidates.map((user) => (
                    <option key={user.id} value={user.id}>
                      {userOptionLabel(user)}
                    </option>
                  ))}
                </select>
                <span className="mt-2 block text-xs leading-5 text-dfc-subtext">
                  没看到账号时，先让对方进入 Discord / KOOK 或登录网站，再运行同步用户脚本。邮箱创建只作为备用方式。
                </span>
              </label>
            ) : (
              <>
                <Field label="邮箱" value={email} onChange={setEmail} type="email" required />
                <Field label="初始密码" value={password} onChange={setPassword} type="password" required />
              </>
            )}
            <Field label="昵称" value={nickname} onChange={setNickname} required />
            <Field label="默认单价" value={pricePerHour} onChange={setPricePerHour} required />
            <Field label="KOOK 单价" value={kookPricePerHour} onChange={setKookPricePerHour} />
            <Field label="Discord 单价" value={discordPricePerHour} onChange={setDiscordPricePerHour} />
            <Field label="娱乐陪玩价" value={entertainmentPricePerHour} onChange={setEntertainmentPricePerHour} />
            <Field label="排位单价" value={rankedPricePerHour} onChange={setRankedPricePerHour} />
            <Field label="高等级排位价" value={highRankedPricePerHour} onChange={setHighRankedPricePerHour} />
            <label className="block">
              <span className="mb-2 block text-xs font-black text-dfc-muted">游戏</span>
              <select
                value={game}
                onChange={(event) => {
                  const nextGame = event.target.value;
                  setGame(nextGame);
                  setSelectedGames((current) => normalizeSelectedGames(current, nextGame));
                }}
                className="input"
              >
                {gameOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
              <span className="mt-2 block text-xs leading-5 text-dfc-subtext">主游戏用于列表优先展示；下方可勾选更多能接的游戏。</span>
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

          <GameMultiSelect selectedGames={selectedGames} primaryGame={game} onChange={setSelectedGames} onPrimaryGameChange={setGame} />

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <UploadBox label="头像" hint="建议方图，展示在列表和详情页" accept="image/*" uploading={uploading === "avatar"} onChange={handleAvatarChange}>
              {avatarUrl ? <SafeMediaImage src={avatarUrl} alt="头像预览" className="h-24 w-24 rounded-dfc object-cover" fallbackText="头像预览" /> : null}
            </UploadBox>
            <UploadBox label="展示照片" hint="最多 9 张，用于陪玩详情展示" accept="image/*" multiple uploading={uploading === "photo"} onChange={handlePhotosChange}>
              <div className="grid grid-cols-3 gap-2">
                {photoUrls.map((url) => (
                  <button key={url} type="button" onClick={() => setPhotoUrls((current) => current.filter((item) => item !== url))} className="overflow-hidden rounded-dfc-control border border-cyan-300/20">
                    <SafeMediaImage src={url} alt="展示照片" className="h-16 w-full object-cover" fallbackText="照片" />
                  </button>
                ))}
              </div>
            </UploadBox>
            <UploadBox label="语音介绍" hint="上传 10-30 秒语音，方便客户试听" accept="audio/*" uploading={uploading === "voice"} onChange={handleVoiceChange}>
              {voiceIntroUrl ? <audio controls src={mediaUrl(voiceIntroUrl)} className="mt-2 w-full" /> : null}
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
            {mode === "existing" ? "开通陪玩身份" : "创建陪玩"}
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

function ModeButton({ active, title, desc, onClick }: { active: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-dfc border p-4 text-left transition ${
        active ? "border-cyan-300/60 bg-cyan-300/15 shadow-dfc-glow" : "border-cyan-300/15 bg-[#050711]/60 hover:border-cyan-300/35"
      }`}
    >
      <div className="text-sm font-black text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-dfc-subtext">{desc}</div>
    </button>
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

function GameMultiSelect({
  selectedGames,
  primaryGame,
  onChange,
  onPrimaryGameChange
}: {
  selectedGames: string[];
  primaryGame: string;
  onChange: (games: string[]) => void;
  onPrimaryGameChange: (game: string) => void;
}) {
  return (
    <section className="mt-5 rounded-dfc border border-cyan-300/15 bg-[#050711]/50 p-3">
      <div className="text-xs font-black text-dfc-muted">可接游戏，多选</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {gameOptions.map(([code, name]) => {
          const checked = selectedGames.includes(code);
          const isPrimary = code === primaryGame;
          return (
            <label key={code} className={`rounded-dfc-control border px-3 py-2 text-sm transition ${checked ? "border-cyan-300/60 bg-cyan-300/10 text-white" : "border-cyan-300/15 bg-[#07111f] text-dfc-subtext"}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange(normalizeSelectedGames([...selectedGames, code], primaryGame));
                    return;
                  }
                  const next = selectedGames.filter((item) => item !== code);
                  if (!next.length) return;
                  if (isPrimary) {
                    const nextPrimary = next[0];
                    onPrimaryGameChange(nextPrimary);
                    onChange(normalizeSelectedGames(next, nextPrimary));
                    return;
                  }
                  onChange(normalizeSelectedGames(next, primaryGame));
                }}
                className="mr-2 accent-cyan-300"
              />
              {name}
              {isPrimary ? <span className="ml-2 text-xs text-dfc-gold">主显示</span> : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}

function mediaUrl(src?: string | null): string | undefined {
  if (!src) return undefined;
  return src.startsWith("/uploads/") ? `/api${src}` : src;
}

function SafeMediaImage({ src, alt, className, fallbackText }: { src: string; alt: string; className: string; fallbackText: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className={`${className} flex items-center justify-center border border-cyan-300/20 bg-[#101827] px-2 text-center text-xs font-black text-cyan-200`}>
        {fallbackText}
      </div>
    );
  }

  return <img src={mediaUrl(src)} alt={alt} className={className} onError={() => setFailed(true)} />;
}

function userOptionLabel(user: AdminUser) {
  const platform = user.externalAccounts.map((account) => `${account.platform}:${account.displayName || account.externalUserId}`).join(" / ");
  const account = formatAccountEmail(user.email);
  return `${user.displayName} / ${platform || account}`;
}

function formatAccountEmail(email: string) {
  if (email.endsWith("@platform.maycatplay.local")) return "平台频道用户";
  if (email.endsWith("@oauth.maycatplay.local")) return "第三方登录用户";
  return email;
}

function normalizeSelectedGames(values: string[], primaryGame: string) {
  const validGames = new Set(gameOptions.map(([code]) => code));
  return Array.from(new Set([primaryGame, ...values].filter((value) => validGames.has(value as (typeof gameOptions)[number][0]))));
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
