import { CustomerShell, SectionHeader, StatCard } from "../components";

export default function RechargePage() {
  return (
    <CustomerShell>
      <SectionHeader
        title="余额充值"
        desc="第一阶段采用人工审核充值。请完成转账后上传截图，管理员审核通过后余额会增加。"
      />

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <StatCard label="当前可用余额" value="¥164.00" hint="可用于下单支付" />
        <StatCard label="审核中充值" value="¥0.00" hint="暂无待审核充值" />
        <StatCard label="预计审核" value="人工处理" hint="管理员确认截图后入账" />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">充值步骤</h2>
          <div className="mt-4 space-y-4">
            {["向指定账户人工转账", "填写充值金额并上传截图", "等待管理员审核入账"].map((step, index) => (
              <div key={step} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dfc-blue text-sm font-bold text-slate-950">
                  {index + 1}
                </span>
                <div>
                  <div className="text-sm font-medium">{step}</div>
                  <p className="mt-1 text-xs leading-5 text-dfc-subtext">请确保金额和截图清晰，审核拒绝时会显示原因。</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">提交充值申请</h2>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">充值金额</span>
            <input className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="例如 300" />
          </label>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">转账截图</span>
            <div className="mt-2 rounded-dfc border border-dashed border-dfc-border bg-dfc-bg px-4 py-8 text-center text-sm text-dfc-muted">
              点击上传截图
            </div>
          </label>
          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">备注</span>
            <textarea className="mt-2 min-h-24 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="可填写付款账号、订单备注等" />
          </label>
          <button type="button" className="mt-5 w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
            提交审核
          </button>
        </form>
      </section>
    </CustomerShell>
  );
}
