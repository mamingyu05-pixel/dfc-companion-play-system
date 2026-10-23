"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function CompanionOAuthCallbackPage() {
  const [message, setMessage] = useState("正在完成陪玩登录...");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Sessions arrive in the fragment (never sent to the server); errors arrive in the query.
    new URLSearchParams(window.location.hash.slice(1)).forEach((value, key) => params.set(key, value));
    const error = params.get("error");
    const token = params.get("token");
    const displayName = params.get("displayName");
    // Keep the session token out of browser history and anything copied from the address bar.
    window.history.replaceState(null, "", window.location.pathname);

    if (error || !token) {
      setFailed(true);
      setMessage(error || "第三方登录失败，请重新尝试。");
      return;
    }

    localStorage.setItem("dfc_companion_token", token);
    localStorage.setItem(
      "dfc_companion_user",
      JSON.stringify({
        displayName: displayName || "小小电竞陪玩",
        role: "COMPANION"
      })
    );

    setMessage("登录成功，正在进入陪玩工作台...");
    window.setTimeout(() => {
      window.location.href = "/companion/dashboard/";
    }, 500);
  }, []);

  return (
    <main className="companion-console-bg flex min-h-screen items-center justify-center px-4 text-dfc-text">
      <section className="companion-card w-full max-w-md p-5">
        <div className="text-xs font-black text-fuchsia-200">小小电竞陪玩端</div>
        <h1 className="mt-2 text-xl font-black text-white">小小电竞陪玩端</h1>
        <p className="mt-1 text-xs text-dfc-muted">Discord / KOOK 申请与登录</p>
        <div className={`mt-5 rounded-dfc-control border px-3 py-3 text-sm ${failed ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success"}`}>
          {message}
        </div>
        {failed ? (
          <Link href="/companion/" className="mt-4 block rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-center text-sm font-black text-slate-950">
            返回陪玩登录
          </Link>
        ) : null}
      </section>
    </main>
  );
}
