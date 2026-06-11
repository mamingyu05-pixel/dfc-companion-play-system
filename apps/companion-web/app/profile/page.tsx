import { CompanionShell, SectionHeader } from "../components";
import { companionProfile } from "../data";

export default function ProfilePage() {
  return (
    <CompanionShell>
      <SectionHeader title="我的资料" desc="资料修改后需要管理员确认，上架状态由后台控制。" />
      <form className="mt-6 grid gap-4 rounded-dfc border border-dfc-border bg-dfc-surface p-4 md:grid-cols-2">
        <Field label="昵称" value={companionProfile.nickname} />
        <Field label="三角洲段位" value={companionProfile.rank} />
        <Field label="每小时价格" value={`¥${companionProfile.price}`} />
        <Field label="语音偏好" value={companionProfile.voice} />
        <label className="md:col-span-2">
          <span className="text-sm text-dfc-subtext">个人简介</span>
          <textarea className="mt-2 min-h-28 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" defaultValue={companionProfile.bio} />
        </label>
        <button type="button" className="rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 md:col-span-2">提交修改</button>
      </form>
    </CompanionShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label>
      <span className="text-sm text-dfc-subtext">{label}</span>
      <input className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" defaultValue={value} />
    </label>
  );
}
