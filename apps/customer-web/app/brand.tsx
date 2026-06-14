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

export function MaycatSignalArtwork({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`maycat-signal-art ${compact ? "maycat-signal-art-compact" : ""}`} aria-label="Maycat Club 自绘霓虹品牌视觉">
      <div className="maycat-art-grid" />
      <div className="maycat-art-rail maycat-art-rail-left" />
      <div className="maycat-art-rail maycat-art-rail-right" />
      <div className="maycat-art-core">
        <svg viewBox="0 0 260 230" role="img" aria-labelledby="maycat-art-title" className="h-full w-full">
          <title id="maycat-art-title">Maycat Club 霓虹猫耳控制台</title>
          <defs>
            <linearGradient id="maycatStroke" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="52%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#facc15" />
            </linearGradient>
            <radialGradient id="maycatFace" cx="50%" cy="38%" r="72%">
              <stop offset="0%" stopColor="#ffe7ef" />
              <stop offset="56%" stopColor="#ff9fb4" />
              <stop offset="100%" stopColor="#7dd3fc" />
            </radialGradient>
          </defs>
          <circle cx="130" cy="112" r="92" fill="rgba(5,7,17,.76)" stroke="url(#maycatStroke)" strokeWidth="4" />
          <circle cx="130" cy="112" r="72" fill="rgba(34,211,238,.08)" stroke="rgba(125,211,252,.34)" strokeDasharray="9 8" strokeWidth="2" />
          <path
            d="M70 92 86 43l38 31h12l38-31 16 49c17 15 25 33 25 54 0 44-36 72-85 72s-85-28-85-72c0-21 8-39 25-54Z"
            fill="url(#maycatFace)"
            stroke="#050711"
            strokeLinejoin="round"
            strokeWidth="9"
          />
          <path d="M84 82 93 58l21 19M176 82l-9-24-21 19" fill="#050711" opacity=".9" />
          <path d="M92 126c15 11 31 11 46 0M168 126c-15 11-31 11-46 0" fill="none" stroke="#050711" strokeLinecap="round" strokeWidth="9" />
          <path d="M115 147c7 8 23 8 30 0" fill="none" stroke="#050711" strokeLinecap="round" strokeWidth="7" />
          <path d="M130 136v12" stroke="#050711" strokeLinecap="round" strokeWidth="6" />
          <path d="M130 132 120 124h20Z" fill="#050711" />
          <path d="M82 141H35M82 155H42M178 141h47M178 155h40" stroke="#050711" strokeLinecap="round" strokeWidth="6" />
          <path d="M110 67v24M130 62v26M150 67v24" stroke="#ef4444" strokeLinecap="round" strokeWidth="7" opacity=".75" />
          <path d="M78 112h24M158 112h24" stroke="#fff7ed" strokeLinecap="round" strokeWidth="5" opacity=".85" />
          <path d="M86 171c22 18 66 19 88 0" fill="none" stroke="#050711" strokeLinecap="round" strokeWidth="8" opacity=".78" />
          <path d="M85 196h90" stroke="#22d3ee" strokeLinecap="round" strokeWidth="5" />
        </svg>
      </div>
    </div>
  );
}
