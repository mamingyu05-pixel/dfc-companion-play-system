export function MaycatLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <MaycatLogoMark />
      {!compact ? (
        <div className="min-w-0">
          <div className="text-lg font-black leading-tight text-dfc-text">May猫饼电竞</div>
          <div className="text-xs font-semibold uppercase text-dfc-blue">Maycat Play Club</div>
        </div>
      ) : null}
    </div>
  );
}

export function MaycatLogoMark() {
  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-dfc border border-dfc-blue/60 bg-dfc-elevated shadow-dfc-glow">
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-9 w-9">
        <path d="M12 16 18 9l6 6 6-6 6 7v16c0 5-4 8-12 8s-12-3-12-8V16Z" fill="#0f172a" stroke="#38bdf8" strokeWidth="2.5" />
        <path d="M17 25h6M25 25h6M20 31h8" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M14 15h8M26 15h8" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="absolute -bottom-1 rounded-dfc-control border border-dfc-blue/50 bg-dfc-bg px-1.5 text-[10px] font-black text-dfc-blue">
        MAY
      </span>
    </span>
  );
}
