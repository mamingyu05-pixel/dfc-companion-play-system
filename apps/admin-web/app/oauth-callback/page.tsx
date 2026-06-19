"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminOAuthCallbackPage() {
  const [message, setMessage] = useState("正在完成管理员登录...");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const token = params.get("token");
    const displayName = params.get("displayName");
    const role = params.get("role");

    if (error || !token) {
      setFailed(true);
      setMessage(error || "Discord 管理员登录失败，请重新尝试。");
      return;
    }

    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      setFailed(true);
      setMessage("这个 Discord 账号没有后台权限。");
      return;
    }

    localStorage.setItem("dfc_admin_token", token);
    localStorage.setItem(
      "dfc_admin_user",
      JSON.stringify({
        displayName: displayName || "May猫饼管理员",
        role
      })
    );

    setMessage("登录成功，正在进入运营后台...");
    window.setTimeout(() => {
      window.location.href = "/admin/dashboard/";
    }, 500);
  }, []);

  return (
    <main className="admin-console-bg flex min-h-screen items-center justify-center px-4 text-dfc-text">
      <section className="admin-panel w-full max-w-md p-5">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100">Discord Admin OAuth</div>
        <h1 className="mt-2 text-xl font-black text-white">May猫饼运营后台</h1>
        <p className="mt-1 text-xs text-dfc-muted">仅已绑定 Discord 的管理员可进入。</p>
        <div className={`mt-5 rounded-dfc-control border px-3 py-3 text-sm ${failed ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success"}`}>
          {message}
        </div>
        {failed ? (
          <Link href="/admin/" className="mt-4 block rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-center text-sm font-black text-slate-950">
            返回后台登录
          </Link>
        ) : null}
      </section>
    </main>
  );
}
