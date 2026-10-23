"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export const navItems = [
  { label: "工作台", href: "/dashboard", tab: true, icon: icon("M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z") },
  { label: "可接订单", href: "/available-orders", tab: true, short: "接单", icon: icon("M12 3v12M7 10l5 5 5-5M5 21h14") },
  { label: "我的订单", href: "/orders", tab: true, short: "订单", icon: icon("M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1M8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4") },
  { label: "代客派单", href: "/customer-drafts", tab: false, icon: null },
  { label: "收益", href: "/earnings", tab: true, icon: icon("M3 17l6-6 4 4 8-8M15 7h6v6") },
  { label: "提现", href: "/withdrawals", tab: false, icon: null },
  { label: "资料", href: "/profile", tab: false, icon: null }
] as const;

function useIsActive(href: string) {
  const pathname = usePathname();
  return !!pathname && (pathname === href || pathname === `${href}/` || pathname.startsWith(`${href}/`));
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = useIsActive(href);
  return <Link href={href} aria-current={active ? "page" : undefined} className="dfc-navlink">{children}</Link>;
}

function Tab({ href, icon: glyph, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const active = useIsActive(href);
  return <Link href={href} aria-current={active ? "page" : undefined} className="dfc-tab">{glyph}{children}</Link>;
}

export function CompanionTopNav() {
  return (
    <nav className="hidden items-center gap-0.5 lg:flex" aria-label="陪玩端导航">
      {navItems.map(item => <NavLink key={item.href} href={item.href}>{item.label}</NavLink>)}
    </nav>
  );
}

export function CompanionTabBar() {
  return (
    <nav className="dfc-tabbar grid grid-cols-4 lg:hidden" aria-label="移动端陪玩导航">
      {navItems.filter(item => item.tab).map(item => (
        <Tab key={item.href} href={item.href} icon={item.icon}>{"short" in item ? item.short : item.label}</Tab>
      ))}
    </nav>
  );
}
