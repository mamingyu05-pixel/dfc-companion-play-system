export function MaycatLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <MaycatLogoMark />
      {!compact ? (
        <div className="min-w-0">
          <div className="maycat-text-glow text-lg font-black leading-tight text-white">May猫饼电竞</div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Maycat Club</div>
        </div>
      ) : null}
    </div>
  );
}

export function MaycatLogoMark() {
  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-dfc border border-cyan-300/60 bg-[#07111f] shadow-dfc-glow">
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.55),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(236,72,153,0.45),transparent_42%)]" />
      <svg viewBox="0 0 48 48" aria-hidden="true" className="relative h-9 w-9">
        <path
          d="M12 18 18 10l6 6 6-6 6 8v14c0 5.5-4.2 8.5-12 8.5S12 37.5 12 32V18Z"
          fill="#07111f"
          stroke="#67e8f9"
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <path d="M17 25h6M25 25h6M20 31h8" stroke="#facc15" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M16 17h7M25 17h7" stroke="#ec4899" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M22 36h4" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="absolute -bottom-1 rounded-dfc-control border border-cyan-300/60 bg-[#050711] px-1.5 text-[10px] font-black text-cyan-300">
        MAY
      </span>
    </span>
  );
}
