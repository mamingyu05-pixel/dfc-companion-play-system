import { AdminShell, SectionHeader } from "../components";

export default function AdminLoginPage() {
  return (
    <AdminShell>
      <section className="mx-auto max-w-md rounded-dfc border border-dfc-border bg-dfc-surface p-5">
        <SectionHeader title="管理员登录" desc="仅 ADMIN 和 SUPER_ADMIN 可进入后台。" />
        <input className="w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="管理员邮箱" />
        <input className="mt-3 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="密码" type="password" />
        <button className="mt-5 w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">登录</button>
      </section>
    </AdminShell>
  );
}
