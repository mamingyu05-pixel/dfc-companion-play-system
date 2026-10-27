const {test}=require("node:test"),assert=require("node:assert/strict");
const {fixture,page,response,tick}=require("./helpers/users-page.cjs");
const plain=v=>JSON.parse(JSON.stringify(v));
test("6000-account directory renders at most 50 rows and each account selector is bounded",async()=>{
 const f=fixture(),p=page(f);await p.flush();
 assert(p.table().props.rows.length<=50,"page rows="+p.table().props.rows.length);
 assert(p.options().filter(n=>String(n.props.value).startsWith("customer-")).length<=100,"rendered account selectors must contain at most 4 × 25 candidates");
 assert.equal(f.calls.filter(c=>c.url==="/api/admin/users").length,0);
 assert.equal(f.calls.filter(c=>c.url.startsWith("/api/admin/users/directory?")).length,1);
 p.dispose();
});
test("pagination keeps global totals and selection is cleared before a different page is shown",async()=>{
 const f=fixture(),p=page(f);await p.flush();p.pick("选择 合成用户0");await p.flush();assert(p.text().includes("已选")||p.all().some(n=>n.props?.count===1));
 p.button("下一页").props.onClick();await p.flush();
 assert.equal(p.table().props.rows.length,50);assert(p.text().includes("6000"));assert(p.all().some(n=>n.props?.label==="客户"&&n.props.value==="6000"));
 assert(!p.all().some(n=>n.props?.count>0));assert(p.all().some(n=>n.props?.label==="选择 合成用户50"));
 p.dispose();
});
test("server search reaches users outside the first page without selecting a financial target",async()=>{
 const f=fixture(),p=page(f);await p.flush();p.select(0,"customer-00000");await p.flush();
 await p.search("搜索昵称、邮箱、ID、Discord / KOOK","customer-05999");
 assert.equal(p.table().props.rows.length,1);assert(f.calls.some(c=>c.url.includes("/directory?")&&c.url.includes("q=customer-05999")));
 assert.equal(p.fields().filter(n=>n.type==="select")[0].props.value,"customer-00000");assert(p.all().some(n=>n.props?.label==="客户"&&n.props.value==="6000"));
 p.dispose();
});
test("changing candidate keywords preserves the explicitly selected customer",async()=>{
 const f=fixture(),p=page(f);await p.flush();p.select(0,"customer-00000");await p.flush();
 await p.search("搜索昵称、邮箱、ID、角色或状态","customer-05999");
 assert.equal(p.fields().filter(n=>n.type==="select")[0].props.value,"customer-00000");
 assert.equal(f.posts.length,0);assert(p.options().some(n=>n.props.value==="customer-05999"));
 p.dispose();
});
test("refreshing a page that disappeared after data changes falls back to the last available page",async()=>{
 const f=fixture(75),p=page(f);await p.flush();p.button("下一页").props.onClick();await p.flush();assert.equal(p.table().props.rows.length,25);
 f.users=f.users.slice(0,10);p.button("刷新列表").props.onClick();await p.flush();
 assert.equal(p.table().props.rows.length,10);assert(p.button("上一页").props.disabled);p.dispose();
});
test("directory errors show an error and a retry action instead of a false empty page",async()=>{
 const f=fixture(),p=page(f);f.directoryFailure=true;await p.flush();
 assert(p.text().includes("用户数据读取失败")||p.text().includes("SYNTHETIC_DIRECTORY_UNAVAILABLE"));assert(p.button("刷新列表"));assert.equal(p.table()?.props.rows.length||0,0);
 f.directoryFailure=false;p.button("刷新列表").props.onClick();await p.flush();assert.equal(p.table().props.rows.length,50);p.dispose();
});
test("a delayed response from an older search cannot replace the newest matching page",async()=>{
 const f=fixture(10),p=page(f);await p.flush();let release;
 f.onDirectory=u=>u.searchParams.get("q")==="old"?new Promise(r=>release=()=>r(response({items:[f.users[0]],total:1,page:1,limit:50,stats:f.stats()}))):u.searchParams.get("q")==="new"?response({items:[f.users[1]],total:1,page:1,limit:50,stats:f.stats()}):null;
 await p.search("搜索昵称、邮箱、ID、Discord / KOOK","old");assert(release);
 await p.search("搜索昵称、邮箱、ID、Discord / KOOK","new");release();await p.flush();
 assert.equal(p.table().props.rows.length,1);assert(p.all().some(n=>n.props?.label==="选择 合成用户1"));assert(!p.all().some(n=>n.props?.label==="选择 合成用户0"));p.dispose();
});
test("unknown manual intent survives page changes and candidate lookup failures and replays the identical body",async()=>{
 const f=fixture(75),p=page(f);await p.flush();p.select(0,"customer-00000");await p.flush();p.input("金额，例如 300","10");p.input("备注，例如微信转账已确认","原调账");
 f.adjustmentReply=()=>response({message:"unknown"},500);p.button("给客户增加余额").props.onClick();await p.flush();const original=plain(f.posts[0].body);
 p.button("下一页").props.onClick();await p.flush();f.optionsFailure=true;
 await p.search("搜索昵称、邮箱、ID、角色或状态","customer-00074");
 assert.equal(p.fields().filter(n=>n.type==="select")[0].props.value,"customer-00000");assert(p.fields().find(n=>n.props.placeholder==="金额，例如 300").props.disabled);
 f.adjustmentReply=(url,body)=>response({requestId:body.requestId,customerId:"customer-00000",direction:body.direction,replayed:true,wallet:{id:"w",availableBalance:"110",frozenBalance:"0"},transaction:{id:"original-ledger",amount:body.amount,balanceAfter:"110"}});
 p.button("核对原调账").props.onClick();await p.flush();assert.deepEqual(plain(f.posts[1].body),original);assert(p.button("另记一笔调账"));p.dispose();
});

function directoryHelper() {
 const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{createRequire}=require("node:module");
 const deps=createRequire(path.join(require("./helpers/users-page.cjs").root,"apps/admin-web/package.json")),ts=deps("typescript"),exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(require("./helpers/users-page.cjs").root,"apps/admin-web/app/users/user-directory-client.ts"),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,AbortController,URLSearchParams});
 return exports;
}
test("directory request settles safely when login storage stops being readable after the request was sent",async()=>{
 const {createLatestUserLoader}=directoryHelper(),states=[];let fail=false,release;
 const loader=createLatestUserLoader({fetcher:()=>new Promise(r=>release=r),getToken:()=>{if(fail)throw Error("SYNTHETIC_STORAGE_BLOCKED");return"synthetic-admin-token"},onChange:s=>states.push(s)});
 const pending=loader.load("/api/admin/users/directory",x=>x);await tick();fail=true;release(response({items:[]}));
 assert.equal(await pending,null);assert.equal(states.at(-1).loading,false);assert.equal(states.at(-1).data,null);assert(states.at(-1).error);loader.dispose();
});
test("directory payloads exceeding the requested cap or naming a foreign pinned target are rejected",()=>{
 const {decodeUserDirectory,decodeUserOptions}=directoryHelper(),f=fixture(51);
 assert.throws(()=>decodeUserDirectory({items:f.users,total:51,page:1,limit:50,stats:f.stats()},1));
 assert.throws(()=>decodeUserOptions({items:f.users.slice(0,25),limit:25,purpose:"balance-adjustment",selectedId:"another-target",hasMore:true},"balance-adjustment","customer-00000"));
});
test("a disposed directory request cannot publish its late response",async()=>{
 const {createLatestUserLoader}=directoryHelper(),states=[];let release;
 const loader=createLatestUserLoader({fetcher:()=>new Promise(r=>release=r),getToken:()=>"synthetic-admin-token",onChange:s=>states.push(s)});
 const pending=loader.load("/api/admin/users/directory",x=>x);await tick();loader.dispose();const count=states.length;release(response({items:[]}));
 assert.equal(await pending,null);assert.equal(states.length,count);
});
