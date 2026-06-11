"use client";

import { FormEvent, useState } from "react";
import { AdminShell, SectionHeader } from "../../components";

export default function NewCompanionPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [pricePerHour, setPricePerHour] = useState("68");
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
      setError(message ?? "Failed to create companion");
      return;
    }

    setEmail("");
    setPassword("");
    setNickname("");
    setBio("");
    setStatus("Companion account created. Go to Companion Management to list it.");
  }

  return (
    <AdminShell>
      <SectionHeader title="Add Companion" desc="Create a real companion account with wallet and profile. New profiles start as PENDING_REVIEW." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <form onSubmit={submit} className="max-w-3xl rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Email" value={email} onChange={setEmail} type="email" required />
          <Field label="Initial Password" value={password} onChange={setPassword} type="password" required />
          <Field label="Nickname" value={nickname} onChange={setNickname} required />
          <Field label="Price Per Hour" value={pricePerHour} onChange={setPricePerHour} required />
          <label className="block">
            <span className="text-sm text-dfc-subtext">Rank</span>
            <select value={deltaForceRank} onChange={(event) => setDeltaForceRank(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
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
            <span className="text-sm text-dfc-subtext">Voice Preference</span>
            <select value={voicePreference} onChange={(event) => setVoicePreference(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              <option value="REQUIRED">REQUIRED</option>
              <option value="OPTIONAL">OPTIONAL</option>
              <option value="TEXT_ONLY">TEXT_ONLY</option>
            </select>
          </label>
        </div>
        <label className="mt-4 block">
          <span className="text-sm text-dfc-subtext">Skill Modes, comma separated</span>
          <input value={skillModes} onChange={(event) => setSkillModes(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" />
        </label>
        <label className="mt-4 block">
          <span className="text-sm text-dfc-subtext">Bio</span>
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} className="mt-2 min-h-28 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" />
        </label>
        <button className="mt-5 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">Create Companion</button>
      </form>
    </AdminShell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm text-dfc-subtext">{label}</span>
      <input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" />
    </label>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
