"use client";

import { useEffect, useState } from "react";

export function countdownText(dueAt: string | null | undefined, now: number) {
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return "自动验收暂不可用，请核对订单或联系客服。";
  const minutes = Math.ceil((Date.parse(dueAt) - now) / 60_000);
  if (minutes <= 0) return "已到自动验收时间，系统处理中；请刷新订单查看结果。";
  return `还有${Math.floor(minutes / 60)}小时${minutes % 60}分钟自动验收`;
}

export function AcceptanceCountdown({ dueAt }: { dueAt?: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <p className="my-3 text-sm text-cyan-200">{countdownText(dueAt, now)} 有异议请在验收前提交投诉，未处理投诉会阻止自动验收。</p>;
}
