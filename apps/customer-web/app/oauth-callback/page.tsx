"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MaycatLogo } from "../brand";

export default function OAuthCallbackPage() {
  const [message, setMessage] = useState("正在完成登录...");
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

    localStorage.setItem("dfc_customer_token", token);
    localStorage.setItem(
      "dfc_customer_user",
      JSON.stringify({
        displayName: displayName || "May猫饼玩家",
        role: "CUSTOMER"
      })
    );

    setMessage("登录成功，正在进入客户中心...");
    window.setTimeout(() => {
      window.location.href = "/customer/home/";
    }, 500);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-dfc-bg px-4 text-dfc-text">
      <section className="w-full max-w-md rounded-dfc border border-dfc-border bg-dfc-surface p-5 shadow-dfc-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black">May猫饼电竞</h1>
            <p className="mt-1 text-xs text-dfc-muted">Discord / KOOK 登录</p>
          </div>
          <MaycatLogo compact />
        </div>
        <div className={`mt-5 rounded-dfc-control border px-3 py-3 text-sm ${failed ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success"}`}>
          {message}
        </div>
        {failed ? (
          <Link href="/" className="mt-4 block rounded-dfc-control bg-dfc-blue px-4 py-3 text-center text-sm font-semibold text-slate-950">
            返回登录页
          </Link>
        ) : null}
      </section>
    </main>
  );
}
