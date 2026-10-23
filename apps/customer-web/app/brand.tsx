// Brand marks for the customer site. The names are kept from the old neon theme so callers stay unchanged.

export function MaycatLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="dfc-brand">
      <MaycatLogoMark />
      {!compact ? <span><b>小小电竞</b><small>XIAOXIAO ESPORTS · 三角洲行动</small></span> : null}
    </span>
  );
}

export function MaycatLogoMark() {
  return <img src="/customer/icon.svg" alt="" width={38} height={38} />;
}

/** Scope crosshair, the same motif as the entry page; the outer ring turns slowly. */
export function MaycatSignalArtwork({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`dfc-scope ${compact ? "dfc-scope-compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 200 200" fill="none" stroke="currentColor">
        <g className="dfc-scope-ring">
          <circle cx="100" cy="100" r="92" strokeWidth="2" strokeDasharray="4 10" opacity=".55" />
        </g>
        <circle cx="100" cy="100" r="70" strokeWidth="2.5" />
        <circle cx="100" cy="100" r="34" strokeWidth="1.5" opacity=".6" />
        <path d="M100 14v40M100 146v40M14 100h40M146 100h40" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="100" cy="100" r="4" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}
