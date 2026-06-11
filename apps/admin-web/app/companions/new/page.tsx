import { AdminShell, SectionHeader } from "../../components";

export default function NewCompanionPage() {
  return (
    <AdminShell>
      <SectionHeader title="添加陪玩" desc="管理员创建陪玩账号、资料和平台账号绑定。" />
      <form className="grid max-w-4xl gap-4 rounded-dfc border border-dfc-border bg-dfc-surface p-4 md:grid-cols-2">
        {["邮箱", "初始密码", "昵称", "三角洲段位", "每小时价格", "KOOK 用户 ID", "Discord 用户 ID"].map((label) => (
          <label key={label}>
            <span className="text-sm text-dfc-subtext">{label}</span>
            <input className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" />
          </label>
        ))}
        <button type="button" className="rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 md:col-span-2">创建陪玩</button>
      </form>
    </AdminShell>
  );
}
