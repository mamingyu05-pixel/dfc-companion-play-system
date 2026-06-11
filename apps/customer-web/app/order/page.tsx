"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { CustomerShell, SectionHeader } from "../components";

type CompanionOption = {
  id: string;
  nickname: string;
  onlineStatus: string;
  deltaForceRank: string;
  skillModes: string[];
  pricePerHour: string;
  voicePreference: string;
  bio?: string | null;
};

type WalletSummary = {
  wallet: { availableBalance: string } | null;
};

export default function OrderPage() {
  const [companions, setCompanions] = useState<CompanionOption[]>([]);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [assignmentType, setAssignmentType] = useState<"DIRECT" | "MATCH">("DIRECT");
  const [companionId, setCompanionId] = useState("");
  const [mode, setMode] = useState("Hot Zone");
  const [hours, setHours] = useState("2");
  const [notes, setNotes] = useState("");
  const [voiceTrialRequested, setVoiceTrialRequested] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadData() {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;
    const [companionsResponse, walletResponse] = await Promise.all([
      fetch("/api/orders/companions", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/wallet/customer-summary", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!companionsResponse.ok || !walletResponse.ok) throw new Error("Failed to load order data");
    const companionData = (await companionsResponse.json()) as CompanionOption[];
    setCompanions(companionData);
    setCompanionId(companionData[0]?.id ?? "");
    setWallet((await walletResponse.json()) as WalletSummary);
  }

  useEffect(() => {
    void loadData().catch(() => setError("Failed to load real order data. Please refresh."));
  }, []);

  const selectedCompanion = companions.find((item) => item.id === companionId);
  const unitPrice = assignmentType === "MATCH" ? 50 : Number(selectedCompanion?.pricePerHour ?? 0);
  const totalAmount = useMemo(() => unitPrice * Number(hours || 0), [hours, unitPrice]);
  const availableBalance = Number(wallet?.wallet?.availableBalance ?? 0);
  const balanceAfter = availableBalance - totalAmount;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");
    setIsSubmitting(true);

    const token = localStorage.getItem("dfc_customer_token");
    if (!token) {
      window.location.href = "/";
      return;
    }

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode,
          hours,
          companionId: assignmentType === "DIRECT" ? companionId : undefined,
          notes,
          voiceTrialRequested
        })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[]; orderNo?: string };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(toFriendlyError(message));
      }
      setStatus(`Order created: ${data.orderNo ?? ""}. It is now waiting for dispatch or acceptance.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <CustomerShell>
      <SectionHeader title="Create Order" desc="Choose a companion directly or let an admin manually match one for you. Payment is calculated on the backend." />

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <form onSubmit={submit} className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">Order Details</h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={`rounded-dfc-control border p-3 ${assignmentType === "DIRECT" ? "border-dfc-blue bg-dfc-blue/10" : "border-dfc-border bg-dfc-bg"}`}>
              <input name="assignmentType" type="radio" checked={assignmentType === "DIRECT"} onChange={() => setAssignmentType("DIRECT")} className="mr-2" />
              <span className="text-sm font-semibold text-dfc-blue">Choose Companion</span>
              <p className="mt-1 text-xs leading-5 text-dfc-subtext">Pick a specific companion. Admin dispatch will target this companion.</p>
            </label>
            <label className={`rounded-dfc-control border p-3 ${assignmentType === "MATCH" ? "border-dfc-blue bg-dfc-blue/10" : "border-dfc-border bg-dfc-bg"}`}>
              <input name="assignmentType" type="radio" checked={assignmentType === "MATCH"} onChange={() => setAssignmentType("MATCH")} className="mr-2" />
              <span className="text-sm font-semibold">Manual Match</span>
              <p className="mt-1 text-xs leading-5 text-dfc-subtext">If you have not chosen a companion, admin will manually match based on mode, voice and budget.</p>
            </label>
          </div>

          {assignmentType === "DIRECT" ? (
            <label className="mt-4 block">
              <span className="text-sm text-dfc-subtext">Companion</span>
              <select value={companionId} onChange={(event) => setCompanionId(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
                {companions.map((companion) => (
                  <option key={companion.id} value={companion.id}>
                    {companion.nickname} / {companion.deltaForceRank} / ¥{formatMoney(companion.pricePerHour)}/h
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">Game Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              <option>Hot Zone</option>
              <option>Warfare</option>
            </select>
          </label>

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">Duration</span>
            <select value={hours} onChange={(event) => setHours(event.target.value)} className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              <option value="1">1 hour</option>
              <option value="2">2 hours</option>
              <option value="3">3 hours</option>
            </select>
          </label>

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 min-h-28 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="Play style, voice requirement, schedule, rank goal..." />
          </label>

          <label className="mt-4 flex gap-3 rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
            <input type="checkbox" checked={voiceTrialRequested} onChange={(event) => setVoiceTrialRequested(event.target.checked)} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold">Request voice trial</span>
              <span className="mt-1 block text-xs leading-5 text-dfc-subtext">
                Admin can create a temporary Discord/KOOK voice room after dispatch. Trial is for communication check only.
              </span>
            </span>
          </label>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          {status ? <Alert tone="success">{status}</Alert> : null}

          <button disabled={isSubmitting || totalAmount <= 0} className="mt-5 w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
            {isSubmitting ? "Submitting..." : "Submit Order"}
          </button>
        </form>

        <aside className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">Price Summary</h2>
          <div className="mt-4 space-y-3 text-sm">
            <Line label="Unit Price" value={`¥${formatMoney(String(unitPrice))} / hour`} />
            <Line label="Duration" value={`${hours} hours`} />
            <Line label="Total" value={`¥${formatMoney(String(totalAmount))}`} strong />
            <Line label="Balance" value={`¥${formatMoney(String(availableBalance))}`} />
            <Line label="After Order" value={`¥${formatMoney(String(balanceAfter))}`} />
          </div>
          <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-xs ${balanceAfter >= 0 ? "border-dfc-success/40 bg-dfc-success/10 text-dfc-success" : "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger"}`}>
            {balanceAfter >= 0 ? "Balance is enough. Final amount is calculated by the API." : "Insufficient balance. Please recharge first."}
          </div>
          {balanceAfter < 0 ? <Link href="/recharge" className="mt-3 inline-block text-sm font-semibold text-dfc-blue">Recharge now</Link> : null}
        </aside>
      </section>
    </CustomerShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-dfc-subtext">{label}</span>
      <span className={strong ? "text-lg font-semibold text-dfc-blue" : "font-medium text-dfc-text"}>{value}</span>
    </div>
  );
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function toFriendlyError(message?: string) {
  if (!message) return "Order failed. Please check the order details.";
  if (message.includes("Insufficient balance")) return "Insufficient balance. Please recharge first.";
  if (message.includes("Customer wallet does not exist")) return "Customer wallet does not exist. Please contact support.";
  if (message.includes("Companion is not listed")) return "This companion is not available for orders.";
  if (message.includes("PLATFORM_MATCH_UNIT_PRICE")) return "Manual match price is not configured. Please contact admin.";
  if (message.includes("hours must be a valid amount")) return "Please enter a valid duration.";
  return message;
}
