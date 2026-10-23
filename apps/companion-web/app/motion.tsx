"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Replays the shared entrance animation (premium.css .dfc-page) whenever the route changes. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div key={pathname} className="dfc-page">{children}</div>;
}

// Layout effect so the starting figure is in place before the first paint; plain effect on the server.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;
const NUMBER = /^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/;

/** Counts a figure such as "¥1,902.00" or "12 单" up from its previous value; anything else renders unchanged. */
export function CountUp({ value }: { value: string }) {
  const [shown, setShown] = useState(value);
  const previous = useRef<number | null>(null);
  useBeforePaint(() => {
    const match = NUMBER.exec(value);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!match || reduce) { setShown(value); return; }
    const [, prefix, digits, suffix] = match;
    const target = Number(digits.replace(/,/g, ""));
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const grouped = digits.includes(",");
    const from = previous.current ?? 0;
    previous.current = target;
    if (!Number.isFinite(target) || from === target) { setShown(value); return; }
    const format = (n: number) => {
      const fixed = n.toFixed(decimals);
      return grouped ? Number(fixed).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed;
    };
    setShown(`${prefix}${format(from)}${suffix}`);
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t < 1 ? `${prefix}${format(from + (target - from) * eased)}${suffix}` : value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown}</>;
}
