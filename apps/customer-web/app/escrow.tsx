import { ESCROW_PROMISE, orderEscrowView, type EscrowTone } from "@dfc/ui";

const toneClass: Record<EscrowTone, string> = {
  held: "border-cyan-300/40 bg-cyan-300/10 text-cyan-50",
  warning: "border-amber-300/40 bg-amber-300/10 text-amber-50",
  settled: "border-emerald-300/40 bg-emerald-300/10 text-emerald-50",
  returned: "border-sky-300/40 bg-sky-300/10 text-sky-50",
  neutral: "border-cyan-300/20 bg-[#050711]/70 text-dfc-subtext",
};

export function EscrowPromise({ compact = false }: { compact?: boolean }) {
  return (
    <section aria-label="资金托管说明" className="rounded-dfc border border-emerald-300/30 bg-emerald-300/[0.06] p-4 text-sm">
      <h2 className="font-black text-emerald-100">🛡 {ESCROW_PROMISE.title}</h2>
      {compact ? (
        <p className="mt-2 text-dfc-subtext">{ESCROW_PROMISE.points[0]}；{ESCROW_PROMISE.points[1]}。</p>
      ) : (
        <ul className="mt-2 space-y-1 text-dfc-subtext">
          {ESCROW_PROMISE.points.map((point) => <li key={point}>· {point}</li>)}
        </ul>
      )}
    </section>
  );
}

export function EscrowProgress({ order }: { order: { status: string; totalAmount: string; refundAmount?: string | null } }) {
  const view = orderEscrowView(order);
  return (
    <div className={`my-3 rounded-dfc border p-3 text-sm ${toneClass[view.tone]}`}>
      <p className="font-black">{view.headline}</p>
      {view.steps.length ? (
        <ol aria-label="资金进度" className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
          {view.steps.map((step, index) => (
            <li key={step.label} className="flex items-center gap-1" aria-current={step.state === "current" ? "step" : undefined}>
              {index > 0 ? <span aria-hidden className="text-dfc-muted">→</span> : null}
              <span className={`rounded-full border px-2 py-0.5 ${
                step.state === "done" ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-100"
                  : step.state === "current" ? "border-current font-bold"
                  : "border-cyan-300/15 text-dfc-muted"}`}>
                {step.state === "done" ? "✓ " : ""}{step.label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="mt-2 text-xs leading-5 opacity-90">{view.detail}</p>
    </div>
  );
}
