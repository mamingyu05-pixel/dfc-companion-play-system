"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AdminAuthGate } from "../auth-gate";
import { adminApi } from "../batch-tools";
import { createMoneyIntentClient, emptyMoneyIntentState, type MoneyIntentState } from "@dfc/ui";
import s from "./quick-order.module.css";

type Customer = { id: string; displayName: string; balance: string; platforms: string[]; balanceKnown?: boolean };
type Companion = { userId: string; nickname: string; status: string; onlineStatus: string; game: string; games?: string[]; pricePerHour: string; kookPricePerHour?: string | null };
type Package = { id: string; label: string; price: string; isActive: boolean };
type ServicePackage = { id: string; name: string; category: string; price: string; isActive: boolean };
type Preview = { mode: string; hours: string; unitPrice: string; totalAmount: string; balance: string; shortfall: string };
type Result = { order: { orderNo: string; totalAmount: string }; toppedUp: boolean; dispatched: boolean; dispatchMode: "DIRECT" | "OPEN"; dispatchError?: string };

const GAMES: Array<[string, string]> = [["DELTA_FORCE", "三角洲"], ["VALORANT", "无畏契约"], ["LEAGUE_OF_LEGENDS", "英雄联盟"], ["COUNTER_STRIKE_2", "CS2"], ["PUBG", "PUBG"], ["APEX_LEGENDS", "APEX"]];
const MODES = ["烽火地带", "全面战场", "娱乐陪玩", "排位上分"];
const HOURS = ["1", "2", "3", "4"];
const METHODS: Array<[string, string]> = [["WECHAT", "微信"], ["ALIPAY", "支付宝"], ["BANK", "银行卡"], ["OTHER", "其他"]];
const yuan = (v: string | number) => `¥${Number(v || 0).toFixed(2)}`;

export default function QuickOrderPage() {
  // The rest of admin is still dark; keep overscroll and short pages light while this screen is open.
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = "#f5f6fa";
    return () => { document.body.style.background = previous; };
  }, []);
  return <AdminAuthGate><QuickOrder /></AdminAuthGate>;
}

function QuickOrder() {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [kind, setKind] = useState<"HOURLY" | "GUARANTEE" | "PACKAGE">("HOURLY");
  const [game, setGame] = useState("DELTA_FORCE");
  const [mode, setMode] = useState(MODES[0]);
  const [hours, setHours] = useState("2");
  const [customPrice, setCustomPrice] = useState("");
  const [packages, setPackages] = useState<Package[]>([]);
  const [packageId, setPackageId] = useState("");
  const [servicePackages, setServicePackages] = useState<ServicePackage[]>([]);
  const [servicePackageId, setServicePackageId] = useState("");
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [companionId, setCompanionId] = useState(""); // empty = open to the dispatch channel
  const [companionQuery, setCompanionQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [topUp, setTopUp] = useState({ on: false, amount: "", method: "WECHAT", screenshot: "" });
  const money = useRef<ReturnType<typeof createMoneyIntentClient> | null>(null);
  const [intent, setIntent] = useState<MoneyIntentState>(emptyMoneyIntentState);
  const busy = intent.busy;
  const locked = busy || !intent.connected || intent.phase !== "empty";
  const orderLocked = busy || !intent.connected || intent.phase === "unknown" || intent.phase === "confirmed";
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function runIntent(action: () => Promise<MoneyIntentState>) {
    if (!money.current || money.current.state().busy) return null;
    setIntent({ ...money.current.state(), busy: true });
    const next = await action(); setIntent(next); setError(next.error);
    if (next.body) {
      const body = next.body;
      setCustomer({ id: next.targetId!, displayName: next.targetLabel || "原申请客户", balance: "0", platforms: [], balanceKnown: false });
      setKind(body.kind as "HOURLY" | "GUARANTEE" | "PACKAGE"); setGame(String(body.game ?? "DELTA_FORCE")); setMode(String(body.mode ?? MODES[0])); setHours(String(body.hours ?? "1"));
      setCompanionId(String(body.companionId ?? "")); setCustomPrice(String(body.customUnitPrice ?? "")); setNotes(String(body.notes ?? ""));
      if (body.kind === "GUARANTEE") setPackageId(String(body.packageId ?? ""));
      if (body.kind === "PACKAGE") setServicePackageId(String(body.packageId ?? ""));
      const top = body.topUp as { amount?: string; method?: string; screenshotUrl?: string } | null;
      setTopUp({ on: Boolean(top), amount: String(top?.amount ?? ""), method: String(top?.method ?? "WECHAT"), screenshot: String(top?.screenshotUrl ?? "") });
      setQuery(""); setFound([]);
    } else if (intent.subject && next.subject !== intent.subject) { setCustomer(null); setQuery(""); setNotes(""); setTopUp({ on: false, amount: "", method: "WECHAT", screenshot: "" }); }
    setResult(next.phase === "confirmed" ? next.receipt as unknown as Result : null);
    return next;
  }
  useEffect(() => {
    money.current = createMoneyIntentClient({ purpose: "quick-order", storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) }, fetcher: fetch,
      getToken: () => localStorage.getItem("dfc_admin_token"), makeRequestId: () => crypto.randomUUID(), scope: window.location.origin });
    void runIntent(() => money.current!.refresh());
  }, []);

  useEffect(() => {
    adminApi<Companion[]>("/api/admin/companions").then(setCompanions).catch(e => setError(e.message));
    adminApi<Package[]>("/api/admin/guarantee-packages").then(list => {
      const active = list.filter(p => p.isActive);
      setPackages(active);
      setPackageId(id => id || active[0]?.id || "");
    }).catch(e => setError(e.message));
    adminApi<ServicePackage[]>("/api/admin/service-packages").then(list => {
      const active = list.filter(p => p.isActive);
      setServicePackages(active);
      setServicePackageId(id => id || active[0]?.id || "");
    }).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!term || customer) { setFound([]); return; }
    const timer = setTimeout(() => adminApi<Customer[]>(`/api/admin/customers/search?q=${encodeURIComponent(term)}`).then(setFound).catch(e => setError(e.message)), 250);
    return () => clearTimeout(timer);
  }, [query, customer]);

  const order = useMemo(() => kind === "GUARANTEE"
    ? { kind, packageId, companionId }
    : kind === "PACKAGE"
      ? { kind, packageId: servicePackageId, companionId }
      : { kind, game, mode: mode.trim(), hours: hours.trim(), companionId, customUnitPrice: customPrice.trim() }, [kind, packageId, servicePackageId, game, mode, hours, customPrice, companionId]);

  // Re-price whenever anything that affects the price changes; the order is submitted at exactly this total.
  useEffect(() => {
    setPreview(null);
    if (!customer || (kind === "HOURLY" && (!order.mode || !Number(order.hours))) || (kind === "GUARANTEE" && !packageId) || (kind === "PACKAGE" && !servicePackageId)) return;
    let live = true;
    const timer = setTimeout(() => {
      adminApi<Preview>("/api/admin/quick-order/preview", { method: "POST", body: JSON.stringify({ customerId: customer.id, ...order }) })
        .then(p => {
          if (!live) return;
          setPreview(p); setError("");
          const short = Number(p.shortfall);
          if (money.current?.state().phase === "empty") setTopUp(t => ({ ...t, on: short > 0 ? true : t.on, amount: short > 0 ? String(Math.ceil(short)) : t.amount }));
        })
        .catch(e => live && setError(e.message));
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [customer, order, kind, packageId, servicePackageId]);

  const qualified = useMemo(() => {
    const term = companionQuery.trim().toLowerCase();
    const rank = (c: Companion) => (c.onlineStatus === "ONLINE" ? 0 : c.onlineStatus === "BUSY" ? 2 : 1);
    return companions
      .filter(c => c.status === "LISTED" && (c.game === game || c.games?.includes(game) || kind !== "HOURLY"))
      .filter(c => !term || c.nickname.toLowerCase().includes(term))
      .sort((a, b) => rank(a) - rank(b));
  }, [companions, companionQuery, game, kind]);
  const chosen = companions.find(c => c.userId === companionId);

  const short = Number(preview?.shortfall ?? 0);
  const topUpAmount = Number(topUp.amount || 0);
  const coversShortfall = short <= 0 || (intent.phase === "empty" && topUp.on && topUpAmount >= short);
  const canSubmit = Boolean(customer && preview && coversShortfall && !orderLocked);

  function readImage(file?: File | null) {
    if (locked || !file?.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) { setError("截图不能超过 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => { if (money.current?.state().phase === "empty" && !money.current.state().busy) setTopUp(t => ({ ...t, screenshot: String(reader.result) })); };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!customer || !preview || !canSubmit || !money.current) return;
    const who = chosen ? '直接派给「' + chosen.nickname + '」' : "发到派单频道，陪玩抢单";
    const pay = intent.phase === "partial" ? "\n原充值已经入账，本次只继续原订单，不重新代充。" : topUp.on && short > 0 ? '\n先代充 ' + yuan(topUp.amount) : "";
    if (!window.confirm('给「' + customer.displayName + '」下单 ' + preview.mode + '，' + yuan(preview.totalAmount) + pay + '\n' + who + '？')) return;
    const body = { customerId: customer.id, ...order, notes, expectedTotalAmount: preview.totalAmount,
      topUp: topUp.on && short > 0 ? { amount: topUp.amount, method: topUp.method, screenshotUrl: topUp.screenshot || undefined } : null };
    if (intent.phase === "partial") await runIntent(() => money.current!.continueOrder(body));
    else await runIntent(() => money.current!.submit(body, customer.displayName));
  }
  async function nextOrder(sameCustomer: boolean) {
    const next = await runIntent(() => money.current!.beginNew());
    if (!next || next.error || next.phase !== "empty") return;
    setResult(null); setNotes(""); setCompanionId(""); setCustomPrice("");
    setTopUp({ on: false, amount: "", method: "WECHAT", screenshot: "" });
    if (!sameCustomer) { setCustomer(null); setQuery(""); }
    else if (customer) {
      setCustomer({ ...customer, balanceKnown: false }); setPreview(null);
      void adminApi<Customer[]>('/api/admin/customers/search?q=' + encodeURIComponent(customer.displayName))
        .then(list => { const fresh = list.find(c => c.id === customer.id); if (fresh) setCustomer(fresh); }).catch(() => undefined);
    }
  }

  return (
    <div className={s.page}>
      <header className={s.top}>
        <span className={s.logo} /><b>小小电竞 · 快速开单</b><span className={s.spacer} />
        <a href="/admin/dispatch">派单台</a><a href="/admin/orders">全部订单</a><a href="/admin/dashboard">返回后台</a>
      </header>

      <section className={s.card}>
        <button disabled={busy} onClick={() => void runIntent(() => money.current!.refresh())}>核对登录与原申请</button>
        {intent.phase !== "empty" ? <div role="status">
          <p>原快捷单：{String(intent.body?.requestId)} · {intent.targetLabel}</p>
          {intent.receipt?.recharge ? <p>已代充本金 ¥{String((intent.receipt.recharge as { amount: string }).amount)}；充值记录 {String((intent.receipt.recharge as { id: string }).id)}。这笔已入账，不要再次代充。</p> : null}
          <p>{intent.phase === "partial" ? "订单尚未创建。客户和原代充金额已锁定；请核对服务与最新报价，再继续原订单。" : intent.phase === "confirmed" ? "原订单回执已保留，明确另开一单后才会生成新编号。" : "原申请结果待核对，客户、服务与原代充内容已保留；请原编号核对，不要另开一单。"}</p>
          {intent.phase === "partial" && intent.receipt?.error ? <p>{String((intent.receipt.error as { message?: string }).message ?? "请核对订单条件")}</p> : null}
          {intent.phase !== "confirmed" ? <button disabled={busy} onClick={() => void runIntent(() => money.current!.retry())}>核对原申请</button> : null}
        </div> : null}
      </section>
      <main className={s.layout}>
        <fieldset disabled={orderLocked} className={s.stack} style={{ minWidth: 0, margin: 0, padding: 0, border: 0 }}>
          {error ? <div className={s.error} role="alert">{error}</div> : null}

          <section className={s.card}>
            <h2 className={s.step}><span>1</span>客户</h2>
            {customer ? (
              <div className={s.picked}>
                <div><b>{customer.displayName}</b><div className={s.muted}>{intent.phase === "empty" ? customer.balanceKnown === false ? "余额待核对" : "余额 " + yuan(customer.balance) : "原申请客户，最新余额请核对报价"}{customer.platforms.length ? ` · ${customer.platforms.join(" / ")}` : ""}</div></div>
                <button className={s.link} disabled={locked} onClick={() => { setCustomer(null); setQuery(""); }}>换客户</button>
              </div>
            ) : (
              <>
                <input disabled={locked} className={s.input} autoFocus placeholder="输入客户的 KOOK 昵称、网站昵称或 KOOK ID" value={query} onChange={e => setQuery(e.target.value)} />
                {found.length ? (
                  <div className={s.list}>
                    {found.map(c => (
                      <button disabled={locked} key={c.id} className={s.row} onClick={() => setCustomer(c)}>
                        <span className={s.rowMain}><b>{c.displayName}</b><small>{c.platforms.join(" / ") || "未绑定平台"}</small></span>
                        <span className={s.money}>{yuan(c.balance)}</span>
                      </button>
                    ))}
                  </div>
                ) : query.trim() ? <p className={s.muted}>没找到。新客户先让他私聊机器人发「首次使用」，或在「导入 KOOK 成员」里导入。</p> : null}
              </>
            )}
          </section>

          <section className={s.card}>
            <h2 className={s.step}><span>2</span>服务</h2>
            <div className={s.tabs}>
              <button className={`${s.tab} ${kind === "HOURLY" ? s.tabOn : ""}`} onClick={() => setKind("HOURLY")}>小时陪玩</button>
              <button className={`${s.tab} ${kind === "GUARANTEE" ? s.tabOn : ""}`} onClick={() => setKind("GUARANTEE")}>保底护航</button>
              <button className={`${s.tab} ${kind === "PACKAGE" ? s.tabOn : ""}`} onClick={() => setKind("PACKAGE")}>套餐</button>
            </div>
            {kind === "HOURLY" ? (
              <div className={s.stack}>
                <div className={s.chips}>{GAMES.map(([code, label]) => <button key={code} className={`${s.chip} ${game === code ? s.chipOn : ""}`} onClick={() => setGame(code)}>{label}</button>)}</div>
                <div>
                  <div className={s.chips}>{MODES.map(m => <button key={m} className={`${s.chip} ${mode === m ? s.chipOn : ""}`} onClick={() => setMode(m)}>{m}</button>)}</div>
                  <input className={s.input} style={{ marginTop: 8 }} placeholder="或者直接写模式，例如：双排上分" value={mode} onChange={e => setMode(e.target.value)} />
                </div>
                <div className={s.chips} style={{ alignItems: "center" }}>
                  {HOURS.map(h => <button key={h} className={`${s.chip} ${hours === h ? s.chipOn : ""}`} onClick={() => setHours(h)}>{h} 小时</button>)}
                  <input className={`${s.input} ${s.small}`} inputMode="decimal" placeholder="其他时长" value={HOURS.includes(hours) ? "" : hours} onChange={e => setHours(e.target.value)} />
                </div>
                <label className={s.muted}>谈好的单价（选填，不填按价目表）
                  <input className={`${s.input} ${s.small}`} style={{ marginLeft: 8 }} inputMode="decimal" placeholder="¥/小时" value={customPrice} onChange={e => setCustomPrice(e.target.value)} />
                </label>
              </div>
            ) : kind === "PACKAGE" ? (
              servicePackages.length
                ? <div className={s.chips}>{servicePackages.map(p => <button key={p.id} className={`${s.chip} ${servicePackageId === p.id ? s.chipOn : ""}`} onClick={() => setServicePackageId(p.id)}>{p.name} · {yuan(p.price)}</button>)}</div>
                : <p className={s.muted}>还没有上架的套餐，先到「配置 → 套餐」上架。</p>
            ) : (
              <div className={s.chips}>{packages.map(p => <button key={p.id} className={`${s.chip} ${packageId === p.id ? s.chipOn : ""}`} onClick={() => setPackageId(p.id)}>{p.label} · {yuan(p.price)}</button>)}</div>
            )}
          </section>

          <section className={s.card}>
            <h2 className={s.step}><span>3</span>派给谁</h2>
            <button className={`${s.row} ${!companionId ? s.rowOn : ""}`} onClick={() => setCompanionId("")}>
              <span className={s.rowMain}><b>发到派单频道，让陪玩抢单</b><small>KOOK 派单频道会收到卡片，第一个点接单的人接走</small></span>
            </button>
            <input className={s.input} style={{ marginTop: 10 }} placeholder="或者搜陪玩昵称，直接指定" value={companionQuery} onChange={e => setCompanionQuery(e.target.value)} />
            <div className={s.list}>
              {qualified.map(c => (
                <button key={c.userId} className={`${s.row} ${companionId === c.userId ? s.rowOn : ""}`} onClick={() => setCompanionId(c.userId)}>
                  <span className={s.av} />
                  <span className={s.rowMain}><b>{c.nickname}</b><small>KOOK {yuan(c.kookPricePerHour ?? c.pricePerHour)}/小时</small></span>
                  <span className={c.onlineStatus === "ONLINE" ? s.online : c.onlineStatus === "BUSY" ? s.busy : s.offline}>
                    {c.onlineStatus === "ONLINE" ? "● 在线" : c.onlineStatus === "BUSY" ? "忙碌" : "离线"}
                  </span>
                </button>
              ))}
              {!qualified.length ? <p className={s.muted}>没有符合条件的已上架陪玩。</p> : null}
            </div>
          </section>

          <section className={s.card}>
            <h2 className={s.step}><span>4</span>备注（选填）</h2>
            <input className={s.input} maxLength={500} placeholder="例如：客户要求女生、晚上 9 点开、需要试音" value={notes} onChange={e => setNotes(e.target.value)} />
          </section>
        </fieldset>

        <aside className={`${s.card} ${s.summary}`}>
          {result ? (
            <div className={s.success}>
              <b>已下单 {result.order.orderNo}</b>
              <span>金额 {yuan(result.order.totalAmount)}{result.toppedUp ? "，已先代充入账" : ""}</span>
              <span>{result.dispatched ? (result.dispatchMode === "DIRECT" ? "已派给指定陪玩，等对方接单" : "已发到派单频道，等陪玩抢单") : `订单已建好但还没派出：${result.dispatchError ?? "请到派单台处理"}`}</span>
              <button className={s.primary} onClick={() => nextOrder(true)}>同一个客户再开一单</button>
              <button className={s.ghost} onClick={() => nextOrder(false)}>换个客户开单</button>
            </div>
          ) : (
            <>
              <div className={s.line}><span className={s.muted}>订单金额</span></div>
              <div className={s.total}>{preview ? yuan(preview.totalAmount) : "—"}</div>
              {preview ? <div className={s.muted}>{preview.mode}{kind === "HOURLY" ? ` · ${preview.hours} 小时 × ${yuan(preview.unitPrice)}` : ""}</div> : <div className={s.muted}>选好客户和服务后自动算价</div>}
              <div className={s.line}><span>客户余额</span><span className={s.money}>{customer ? preview ? yuan(preview.balance) : intent.phase === "empty" && customer.balanceKnown !== false ? yuan(customer.balance) : "待核对" : "—"}</span></div>
              <div className={s.line}><span>派给</span><span>{chosen ? chosen.nickname : "派单频道抢单"}</span></div>

              {short > 0 ? (
                <div className={s.warnBox}>
                  <b>余额还差 {yuan(short)}</b>
                  {intent.phase === "partial" ? <p>原代充已经入账，当前余额仍不足；请另行核对或补足余额后刷新报价，这里不会重复代充。</p> : null}
                  <label><input disabled={locked} type="checkbox" checked={topUp.on} onChange={e => setTopUp(t => ({ ...t, on: e.target.checked }))} /> 客户已转账给我，先代充</label>
                  {topUp.on ? (
                    <>
                      <label>实收 ¥<input className={`${s.input} ${s.small}`} disabled={locked} inputMode="decimal" value={topUp.amount} onChange={e => setTopUp(t => ({ ...t, amount: e.target.value }))} /></label>
                      <div className={s.chips}>{METHODS.map(([v, l]) => <button disabled={locked} key={v} className={`${s.chip} ${topUp.method === v ? s.chipOn : ""}`} onClick={() => setTopUp(t => ({ ...t, method: v }))}>{l}</button>)}</div>
                      <div className={s.drop} tabIndex={0} onPaste={e => readImage(e.clipboardData.files[0])}>
                        {topUp.screenshot ? <img src={topUp.screenshot} alt="转账截图" /> : "点这里 Ctrl+V 粘贴转账截图（建议）"}
                      </div>
                      {topUpAmount < short ? <span style={{ color: "var(--bad)" }}>实收金额不够付这单</span> : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              <button className={s.primary} disabled={!canSubmit} onClick={() => void submit()}>{busy ? "处理中…" : intent.phase === "partial" ? "核对后继续原订单" : chosen ? "下单并派给 TA" : "下单并发到派单频道"}</button>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
