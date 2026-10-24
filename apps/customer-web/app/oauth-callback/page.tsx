"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { currentPortalUser, redeemLoginReceipt, type LoginReceiptUser } from "@dfc/ui";
import { MaycatLogo } from "../brand";

type Pending = { accessToken: string; user: LoginReceiptUser; previous: string | null };

export default function OAuthCallbackPage() {
  const [message, setMessage] = useState("正在完成登录...");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  function enter(accessToken: string, user: LoginReceiptUser) {
    localStorage.setItem("dfc_customer_token", accessToken);
    localStorage.setItem("dfc_customer_user", JSON.stringify({ displayName: user.displayName || "小小电竞玩家", role: "CUSTOMER" }));
    setPending(null);
    setMessage("登录成功，正在进入客户中心...");
    window.setTimeout(() => { window.location.href = "/customer/home/"; }, 500);
  }

  useEffect(() => {
    void redeemLoginReceipt("第三方登录失败，请重新尝试。").then((result) => {
      if (!result.ok) { setFailed(true); setMessage(result.message); return; }
      if (result.user.role !== "CUSTOMER") { setFailed(true); setMessage("这个账号不是客户账号，请从对应的入口登录。"); return; }
      // A link from a chat card may have been forwarded: show whose account it is before switching to it.
      if (result.confirm) { setPending({ accessToken: result.accessToken, user: result.user, previous: currentPortalUser("dfc_customer_user") }); return; }
      enter(result.accessToken, result.user);
    });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050711] px-4 text-dfc-text">
      <section className="maycat-card w-full max-w-md p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-white">小小电竞</h1>
            <p className="mt-1 text-xs text-dfc-muted">Discord / KOOK 登录</p>
          </div>
          <MaycatLogo compact />
        </div>
        {pending ? (
          <ConfirmAccount pending={pending} onConfirm={() => enter(pending.accessToken, pending.user)}
            onCancel={() => { setPending(null); setFailed(true); setMessage("已取消，没有切换账号。"); }} />
        ) : (
          <div className={`mt-5 rounded-dfc-control border px-3 py-3 text-sm ${failed ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success"}`}>
            {message}
          </div>
        )}
        {failed ? (
          <Link href="/customer/" className="maycat-button mt-4 block px-4 py-3 text-center text-sm font-black">
            返回登录页
          </Link>
        ) : null}
      </section>
    </main>
  );
}

function ConfirmAccount({ pending, onConfirm, onCancel }: { pending: Pending; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="mt-5 space-y-3 text-sm">
      <p>即将登录账号「<b className="text-white">{pending.user.displayName}</b>」。</p>
      {pending.previous && pending.previous !== pending.user.displayName ? (
        <p className="rounded-dfc-control border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-amber-100">这个浏览器现在登录的是「{pending.previous}」，继续会切换账号。</p>
      ) : null}
      <p className="text-dfc-subtext">如果这不是你自己的账号（例如别人发给你的链接），请点“不是我”，不要在里面充值或填写资料。</p>
      <div className="flex gap-3">
        <button type="button" className="maycat-button px-4 py-3 text-sm font-black" onClick={onConfirm}>是我，继续登录</button>
        <button type="button" className="maycat-button-secondary px-4 py-3 text-sm" onClick={onCancel}>不是我</button>
      </div>
    </div>
  );
}
