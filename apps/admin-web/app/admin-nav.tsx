"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Counts = { drafts: number; dispatch: number; recharges: number; withdrawals: number; complaints: number; disputes: number };
type Item = { label: string; href: string; badge?: (c: Counts) => number };

// Grouped by the job an operator is doing; badges show where work is waiting right now.
export const navGroups: Array<{ title: string; items: Item[] }> = [
  { title: "今日处理", items: [
    { label: "看板", href: "/dashboard" },
    { label: "草稿台", href: "/order-drafts", badge: c => c.drafts },
    { label: "派单", href: "/dispatch", badge: c => c.dispatch },
    { label: "充值审核", href: "/recharges", badge: c => c.recharges },
    { label: "提现审核", href: "/withdrawals", badge: c => c.withdrawals },
    { label: "投诉与争议", href: "/complaints", badge: c => c.complaints + c.disputes }
  ] },
  { title: "订单", items: [
    { label: "全部订单", href: "/orders" },
    { label: "评价与验收", href: "/order-reviews" }
  ] },
  { title: "人员", items: [
    { label: "陪玩", href: "/companions" },
    { label: "添加陪玩", href: "/companions/new" },
    { label: "用户", href: "/users" }
  ] },
  { title: "价格与优惠", items: [
    { label: "价格设置", href: "/pricing" },
    { label: "优惠", href: "/promotions" }
  ] },
  { title: "数据与记录", items: [
    { label: "经营与绩效", href: "/operations" },
    { label: "客户/陪玩数据", href: "/analytics" },
    { label: "财务", href: "/finance" },
    { label: "日志", href: "/logs" }
  ] }
];

function usePendingCounts() {
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    let token: string | null = null;
    try { token = localStorage.getItem("dfc_admin_token"); } catch { /* badges stay hidden */ }
    if (!token) return;
    let closed = false;
    // Badges are hints only: any failure hides them rather than showing a misleading zero.
    void fetch("/api/admin/pending-counts", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!closed && data && typeof data.dispatch === "number") setCounts(data as Counts); })
      .catch(() => undefined);
    return () => { closed = true; };
  }, []);
  return counts;
}

const isActive = (pathname: string | null, href: string) =>
  !!pathname && (pathname === href || pathname === `${href}/` || (href !== "/companions" && pathname.startsWith(`${href}/`)));

function Badge({ value }: { value: number }) {
  if (!value) return null;
  return <span className="ml-auto rounded-full bg-dfc-gold px-2 text-xs font-black text-slate-950 tabular-nums">{value > 99 ? "99+" : value}</span>;
}

export function AdminSidebarNav() {
  const counts = usePendingCounts();
  const pathname = usePathname();
  return (
    <nav className="space-y-4 p-3" aria-label="后台导航">
      {navGroups.map(group => (
        <div key={group.title}>
          <div className="px-3 pb-1 text-xs font-black text-dfc-muted">{group.title}</div>
          <div className="space-y-1">
            {group.items.map(item => (
              <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={`admin-nav-item flex items-center gap-2 ${isActive(pathname, item.href) ? "text-white" : ""}`}>
                {item.label}
                {counts && item.badge ? <Badge value={item.badge(counts)} /> : null}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AdminMobileNav() {
  const counts = usePendingCounts();
  const pathname = usePathname();
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {navGroups.flatMap(group => group.items).map(item => (
        <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className={`flex shrink-0 items-center gap-1 rounded-dfc-control border px-3 py-2 text-xs font-semibold ${isActive(pathname, item.href) ? "border-cyan-300/60 text-white" : "border-cyan-300/20 text-dfc-subtext"} bg-[#050711]/80`}>
          {item.label}
          {counts && item.badge ? <Badge value={item.badge(counts)} /> : null}
        </Link>
      ))}
    </div>
  );
}
