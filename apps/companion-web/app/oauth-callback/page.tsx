"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function CompanionOAuthCallbackPage() {
  const [message, setMessage] = useState("正在完成陪玩登录...");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const token = params.get("token");
    const displayName = params.get("displayName");

    if (error || !token) {
      setFailed(true);
      setMessage(error || "第三方登录失败，请重新尝试。");
      return;
    }

    localStorage.setItem("dfc_companion_token", token);
    localStorage.setItem(
      "dfc_companion_user",
      JSON.stringify({
        displayName: displayName || "May猫饼陪玩",
        role: "COMPANION"
      })
    );

    setMessage("登录成功，正在进入陪玩工作台...");
    window.setTimeout(() => {
      window.location.href = "/companion/dashboard/";
    }, 500);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-dfc-bg px-4 text-dfc-text">
      <section className="w-full max-w-md rounded-dfc border border-dfc-border bg-dfc-surface p-5 shadow-dfc-card">
        <h1 className="text-xl font-black">May猫饼陪玩端</h1>
        <p className="mt-1 text-xs text-dfc-muted">Discord / KOOK 申请与登录</p>
        <div className={`mt-5 rounded-dfc-control border px-3 py-3 text-sm ${failed ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success"}`}>
          {message}
        </div>
        {failed ? (
          <Link href="/" className="mt-4 block rounded-dfc-control bg-dfc-blue px-4 py-3 text-center text-sm font-semibold text-slate-950">
            返回陪玩登录
          </Link>
        ) : null}
      </section>
    </main>
  );
}
