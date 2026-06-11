import { CompanionShell, SectionHeader } from "../components";

export default function WithdrawalsPage() {
  return (
    <CompanionShell>
      <SectionHeader title="提现申请" desc="第一阶段由管理员审核后人工打款，后台确认完成后生成流水。" />
      <form className="mt-6 max-w-xl rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <label className="block">
          <span className="text-sm text-dfc-subtext">提现金额</span>
          <input className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="最多 ¥208.80" />
        </label>
        <label className="mt-4 block">
          <span className="text-sm text-dfc-subtext">收款账户</span>
          <input className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="填写收款方式和账号" />
        </label>
        <label className="mt-4 block">
          <span className="text-sm text-dfc-subtext">备注</span>
          <textarea className="mt-2 min-h-24 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" />
        </label>
        <button type="button" className="mt-5 w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">提交提现申请</button>
      </form>
    </CompanionShell>
  );
}
