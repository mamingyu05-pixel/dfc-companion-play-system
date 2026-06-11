import { CustomerShell, PriceSummary, SectionHeader } from "../components";
import { companions } from "../data";

export default function OrderPage() {
  const selected = companions[0];

  return (
    <CustomerShell>
      <SectionHeader
        title="提交订单"
        desc="选择模式和时长后确认下单。订单金额以后端计算为准，支付成功后进入待派单。"
      />

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <form className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">订单信息</h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="rounded-dfc-control border border-dfc-blue bg-dfc-blue/10 p-3">
              <input name="assignmentType" type="radio" defaultChecked className="mr-2" />
              <span className="text-sm font-semibold text-dfc-blue">指定陪玩</span>
              <p className="mt-1 text-xs leading-5 text-dfc-subtext">选择具体陪玩下单，管理员确认后派给该陪玩。</p>
            </label>
            <label className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
              <input name="assignmentType" type="radio" className="mr-2" />
              <span className="text-sm font-semibold">平台代选</span>
              <p className="mt-1 text-xs leading-5 text-dfc-subtext">没选好陪玩时提交需求，管理员按模式、语音、预算人工挑人。</p>
            </label>
          </div>

          <div className="mt-4 rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
            <div className="text-sm font-medium">{selected.nickname}</div>
            <div className="mt-1 text-xs text-dfc-subtext">{selected.rank} · ¥{selected.price}/小时 · {selected.voice} · {selected.voiceStyle}</div>
          </div>

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">游戏模式</span>
            <select className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              <option>烽火地带</option>
              <option>全面战场</option>
            </select>
          </label>

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">服务时长</span>
            <select className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              <option>2 小时</option>
              <option>1 小时</option>
              <option>3 小时</option>
            </select>
          </label>

          <label className="mt-4 block">
            <span className="text-sm text-dfc-subtext">需求备注</span>
            <textarea className="mt-2 min-h-28 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="例如：希望走稳健路线、优先教学、需要语音沟通" />
          </label>

          <label className="mt-4 flex gap-3 rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
            <input type="checkbox" defaultChecked className="mt-1" />
            <span>
              <span className="block text-sm font-semibold">申请进入语音频道试音</span>
              <span className="mt-1 block text-xs leading-5 text-dfc-subtext">
                管理员派单后可创建临时 Discord/KOOK 语音房。试音只确认沟通体验，不代表订单开始或收益结算。
              </span>
            </span>
          </label>

          <button type="button" className="mt-5 w-full rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
            确认下单
          </button>
        </form>

        <PriceSummary />
      </section>
    </CustomerShell>
  );
}
