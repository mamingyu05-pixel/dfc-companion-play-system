"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { currentPortalUser, redeemLoginReceipt, type LoginReceiptUser } from "@dfc/ui";

type Pending = { accessToken: string; user: LoginReceiptUser; previous: string | null };

export default function CompanionOAuthCallbackPage() {
  const [message, setMessage] = useState("正在完成陪玩登录...");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  function enter(accessToken: string, user: LoginReceiptUser) {
    localStorage.setItem("dfc_companion_token", accessToken);
    localStorage.setItem("dfc_companion_user", JSON.stringify({ displayName: user.displayName || "小小电竞陪玩", role: "COMPANION" }));
    setPending(null);
    setMessage("登录成功，正在进入陪玩工作台...");
    window.setTimeout(() => { window.location.href = "/companion/dashboard/"; }, 500);
  }

  useEffect(() => {
    void redeemLoginReceipt("第三方登录失败，请重新尝试。").then((result) => {
      if (!result.ok) { setFailed(true); setMessage(result.message); return; }
      if (result.user.role !== "COMPANION") { setFailed(true); setMessage("这个账号不是陪玩账号，请从对应的入口登录。"); return; }
      // A link from a chat card may have been forwarded: show whose account it is before switching to it.
      if (result.confirm) { setPending({ accessToken: result.accessToken, user: result.user, previous: currentPortalUser("dfc_companion_user") }); return; }
      enter(result.accessToken, result.user);
    });
  }, []);

  return (
    <main className="companion-console-bg flex min-h-screen items-center justify-center px-4 text-dfc-text">
      <section className="companion-card w-full max-w-md p-5">
        <div className="text-xs font-black text-fuchsia-200">小小电竞陪玩端</div>
        <h1 className="mt-2 text-xl font-black text-white">小小电竞陪玩端</h1>
        <p className="mt-1 text-xs text-dfc-muted">Discord / KOOK 申请与登录</p>
        {pending ? (
          <div className="mt-5 space-y-3 text-sm">
            <p>即将登录陪玩账号「<b className="text-white">{pending.user.displayName}</b>」。</p>
            {pending.previous && pending.previous !== pending.user.displayName ? (
              <p className="rounded-dfc-control border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-amber-100">这个浏览器现在登录的是「{pending.previous}」，继续会切换账号。</p>
            ) : null}
            <p className="text-dfc-subtext">如果这不是你自己的账号（例如别人发给你的链接），请点“不是我”。</p>
            <div className="flex gap-3">
              <button type="button" className="rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950" onClick={() => enter(pending.accessToken, pending.user)}>是我，继续登录</button>
              <button type="button" className="rounded-dfc-control border border-dfc-border px-4 py-3 text-sm" onClick={() => { setPending(null); setFailed(true); setMessage("已取消，没有切换账号。"); }}>不是我</button>
            </div>
          </div>
        ) : (
          <div className={`mt-5 rounded-dfc-control border px-3 py-3 text-sm ${failed ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success"}`}>
            {message}
          </div>
        )}
        {failed ? (
          <Link href="/companion/" className="mt-4 block rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-center text-sm font-black text-slate-950">
            返回陪玩登录
          </Link>
        ) : null}
      </section>
    </main>
  );
}
