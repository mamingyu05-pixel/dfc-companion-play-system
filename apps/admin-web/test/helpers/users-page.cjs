const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"../../../.."),deps=require("node:module").createRequire(path.join(root,"apps/admin-web/package.json"));
const ts=deps("typescript"),React=deps("react"),jsx=deps("react/jsx-runtime"),{renderToStaticMarkup}=deps("react-dom/server");
const tick=()=>new Promise(r=>setImmediate(r));
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
function fixture(count=6000){
 const f={users:Array.from({length:count},(_,i)=>({id:"customer-"+String(i).padStart(5,"0"),email:"customer-"+i+"@synthetic.invalid",displayName:"合成用户"+i,role:"CUSTOMER",status:"ACTIVE",createdAt:"2026-10-27T00:00:00Z",wallet:{availableBalance:"100",frozenBalance:"0",availableIncome:"0",pendingIncome:"0"},companionProfile:null,externalAccounts:[]})),token:"synthetic-admin-token",calls:[],posts:[],storage:new Map()};
 f.matches=(u,q)=>!q||q.toLowerCase().trim().split(/\s+/).every(word=>[u.id,u.email,u.displayName,...u.externalAccounts.flatMap(a=>[a.externalUserId,a.displayName])].some(v=>String(v||"").toLowerCase().includes(word)));
 f.stats=()=>({customers:f.users.filter(u=>u.role==="CUSTOMER").length,companions:f.users.filter(u=>u.companionProfile).length,admins:f.users.filter(u=>["ADMIN","SUPER_ADMIN"].includes(u.role)).length,banned:f.users.filter(u=>u.status==="BANNED").length});
 f.directory=url=>{const q=url.searchParams.get("q")||"",page=Number(url.searchParams.get("page")),limit=Number(url.searchParams.get("limit")),all=f.users.filter(u=>f.matches(u,q));return{items:all.slice((page-1)*limit,page*limit),total:all.length,page,limit,stats:f.stats()}};
 f.options=url=>{const purpose=url.searchParams.get("purpose"),q=url.searchParams.get("q")||"",selectedId=url.searchParams.get("selectedId"),limit=Number(url.searchParams.get("limit"));const eligible=f.users.filter(u=>u.status==="ACTIVE"&&(purpose!=="balance-adjustment"||u.role==="CUSTOMER"&&u.wallet)&&(purpose!=="companion-onboarding"||!u.companionProfile));const selected=eligible.find(u=>u.id===selectedId);const all=eligible.filter(u=>f.matches(u,q)&&u.id!==selected?.id);const items=[...(selected?[selected]:[]),...all].slice(0,limit);return{purpose,selectedId:selected?.id||null,limit,items,hasMore:all.length+(selected?1:0)>limit}};
 f.fetch=async(url,init={})=>{f.calls.push({url,method:init.method||"GET"});if(url==="/api/auth/me")return response({user:{id:"admin-fixture",role:"ADMIN"}});
 if(url==="/api/admin/users")return response(f.users);
 const parsed=new URL(url,"http://synthetic.invalid");
 if(parsed.pathname==="/api/admin/users/directory"){if(f.directoryFailure)throw Error("SYNTHETIC_DIRECTORY_UNAVAILABLE");if(f.onDirectory){const result=await f.onDirectory(parsed);if(result)return result}return response(f.directory(parsed))}
 if(parsed.pathname==="/api/admin/users/options"){if(f.optionsFailure)throw Error("SYNTHETIC_OPTIONS_UNAVAILABLE");return response(f.options(parsed))}
 if(parsed.pathname.endsWith("/balance-adjustments")){const body=JSON.parse(init.body);f.posts.push({url,body});return f.adjustmentReply?f.adjustmentReply(url,body):response({requestId:body.requestId,customerId:parsed.pathname.split("/")[4],direction:body.direction,replayed:false,wallet:{id:"wallet",availableBalance:"200",frozenBalance:"0"},transaction:{id:"original-ledger",amount:body.amount,balanceAfter:"200"}})}
 throw Error("Unexpected request "+parsed.pathname);};
 f.localStorage={getItem:key=>key==="dfc_admin_token"?f.token:f.storage.get(key)||null,setItem:(key,v)=>f.storage.set(key,v),removeItem:key=>f.storage.delete(key)};
 return f;
}
function page(f){
 const states=[],refs=[],memos=[],effectDeps=[],cleanups=[],effects=[];let a=0,b=0,c=0,d=0,serial=0;
 const hooks={useState(v){const i=a++;if(!(i in states))states[i]=typeof v==="function"?v():v;return[states[i],n=>states[i]=typeof n==="function"?n(states[i]):n]},useRef(v){return refs[b++]||=( {current:v})},useMemo(fn,deps){const i=c++,old=memos[i];if(old&&deps.every((v,j)=>Object.is(v,old.deps[j])))return old.value;const value=fn();memos[i]={deps,value};return value},useEffect(fn,deps){const i=d++,old=effectDeps[i];if(!old||deps.some((v,j)=>!Object.is(v,old[j]))){effectDeps[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}};
 const Wrapper=({children})=>React.createElement("div",null,children),components=new Proxy({}, {get:()=>Wrapper}),modules=new Map(),lockMap=new Map();
 const lockManager={request(key,work){const previous=lockMap.get(key)||Promise.resolve(),run=previous.then(work,work);lockMap.set(key,run.catch(()=>{}));return run}};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);const source=ts.transpileModule(fs.readFileSync(path.join(root,file),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{exports,fetch:f.fetch,localStorage:f.localStorage,crypto:{randomUUID:()=>"directory-adjust-"+String(++serial).padStart(8,"0")},navigator:{locks:lockManager},window:{location:{origin:"http://synthetic.invalid"},confirm:()=>true},AbortController,URLSearchParams,setTimeout,clearTimeout,console,require(id){if(id==="react")return hooks;if(id==="react/jsx-runtime")return jsx;if(id==="../components")return components;if(id==="../batch-tools")return load("apps/admin-web/app/batch-tools.tsx");if(id==="@dfc/ui")return load("packages/ui/src/money-intent-client.ts");if(id==="./user-directory-client")return load("apps/admin-web/app/users/user-directory-client.ts");throw Error("Unexpected import "+id)}});return exports}
 const Component=load("apps/admin-web/app/users/page.tsx").default;
 const tree=()=>{a=b=c=d=0;return Component()};
 function nodes(n){return !n||typeof n!=="object"?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children),...nodes(n.props?.rows),...nodes(n.props?.columns)]}
 function text(n){return Array.isArray(n)?n.map(text).join(""):n&&typeof n==="object"?text(n.props?.children):String(n??"")}
 const all=()=>nodes(tree()),panel=title=>all().find(n=>n.props?.title===title);
 const p={all,text:()=>text(tree()),table:()=>all().find(n=>n.props?.columns&&Array.isArray(n.props?.rows)),options:()=>all().filter(n=>n.type==="option"&&n.props.value),panel,button:label=>all().find(n=>n.type==="button"&&text(n)===label),fields:()=>nodes(panel("搜索用户 / 人工调账")).filter(n=>n.type==="input"||n.type==="select"),input(placeholder,value){const el=all().find(n=>n.type==="input"&&n.props.placeholder===placeholder);if(!el)throw Error("Input not found "+placeholder);el.props.onChange({target:{value}})},select(index,value){p.fields().filter(n=>n.type==="select")[index].props.onChange({target:{value}})},pick(label){const el=all().find(n=>n.props?.label===label||n.props?.["aria-label"]===label);if(!el)throw Error("Pick not found "+label);el.props.onChange()},async flush(){for(let i=0;i<8;i++){tree();effects.splice(0).forEach(fn=>fn());await tick()}},async search(placeholder,value){p.input(placeholder,value);await p.flush();await new Promise(r=>setTimeout(r,280));await p.flush()},dispose(){cleanups.forEach(fn=>typeof fn==="function"&&fn())}};
 return p;
}
module.exports={fixture,page,response,tick,root};
