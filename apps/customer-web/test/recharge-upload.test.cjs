const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{test}=require('node:test');
const app=process.env.DFC_RECHARGE_APP_ROOT||path.resolve(__dirname,'..');
const localRequire=createRequire(path.join(app,'package.json'));
const ts=localRequire('typescript'),React=localRequire('react'),{renderToStaticMarkup}=localRequire('react-dom/server');
const source=process.env.DFC_RECHARGE_PAGE_PATH||path.join(app,'app/recharge/page.tsx');
const ok=data=>({ok:true,status:200,json:async()=>data});
const summary={wallet:{availableBalance:'100',frozenBalance:'0'},pendingRechargeAmount:'0',rechargeRequests:[]};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function elements(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(elements);return [node,...elements(node.props?.children)];}
function page(fetchImpl=async()=>ok(summary)){
 const state=[],refs=[],effects=[],readers=[];let cursor=0,refCursor=0,effectCursor=0;
 const hooks={...React,useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useRef(initial){return refs[refCursor++]??(refs[refCursor-1]={current:initial});},useEffect(effect){const i=effectCursor++;effects[i]??={effect};}};
 class Reader{constructor(){readers.push(this);}readAsDataURL(file){this.file=file;}success(value='data:'+this.file.type+';base64,AAAA'){this.result=value;this.onload?.();}fail(){this.onerror?.();}abort(){this.onabort?.();}}
 const compiled=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:source}).outputText;
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,require(name){if(name==='react')return hooks;if(name==='@dfc/ui')return {submitIntentId:()=>'synthetic-intent-0001',clearSubmitIntent:()=>{}};if(name==='../components')return {CustomerShell:({children})=>React.createElement('div',null,children)};return localRequire(name);},fetch:fetchImpl,FileReader:Reader,Error,window:{location:{}},localStorage:{getItem:()=> 'synthetic-in-memory-test'}},{filename:source});
 const api={readers,tree(){cursor=0;refCursor=0;effectCursor=0;return module.exports.default();},all(){return elements(this.tree());},html(){return renderToStaticMarkup(this.tree());},input(){return this.all().find(e=>e.type==='input'&&e.props.type==='file');},select(file){const target={files:[file],value:'synthetic-selection'};return {target,done:this.input().props.onChange({target})};},setAmount(value='100'){this.all().find(e=>e.type==='input'&&e.props.placeholder==='也可以手动输入金额').props.onChange({target:{value}});},submit(){return this.all().find(e=>e.type==='form').props.onSubmit({preventDefault(){}});},submitButton(){return this.all().find(e=>e.type==='button'&&String(e.props.children).includes('提交'));},mount(){this.tree();effects.forEach(e=>e.cleanup=e.effect());},unmount(){effects.forEach(e=>e.cleanup?.());}};return api;
}
async function choose(p,file,value){const selection=p.select(file);p.readers.at(-1).success(value);await selection.done;return selection;}
const file=(size=100,type='image/png',name='receipt.png')=>({size,type,name});

test('256KiB and exact 2MiB image files remain eligible for submission',async()=>{
 for(const size of [262144,2097152]){let posted;const p=page(async(url,options)=>{if(options?.method==='POST'){posted=JSON.parse(options.body);return ok({});}return ok(summary);});p.setAmount();await choose(p,file(size),`data:image/png;base64,${Buffer.alloc(size).toString('base64')}`);assert.match(p.html(),/已选择：receipt.png/);assert.equal(p.submitButton().props.disabled,false);await p.submit();assert.equal(posted.amount,'100');assert.equal(Buffer.from(posted.screenshotUrl.split(',')[1],'base64').length,size);}
});
test('PNG, JPEG, WebP and GIF are allowed and input restricts the same MIME set',async()=>{
 for(const mime of ['image/png','image/jpeg','image/webp','image/gif']){const p=page();await choose(p,file(64,mime));assert.match(p.html(),/已选择：receipt.png/);}
 assert.equal(page().input().props.accept,'image/png,image/jpeg,image/webp,image/gif');
});
test('2MiB plus one byte is rejected before reading and clears a previously selected receipt',async()=>{
 const p=page();await choose(p,file());const n=p.readers.length;const s=p.select(file(2097153,'image/png','too-large.png'));await s.done;assert.equal(p.readers.length,n);assert.equal(s.target.value,'');assert.match(p.html(),/2 MiB/);assert.doesNotMatch(p.html(),/已选择：/);
});
test('unsupported image and non-image selections cannot silently reuse the previous receipt',async()=>{
 for(const mime of ['image/svg+xml','text/plain','']){let posted;const p=page(async(u,o)=>{if(o?.method==='POST')posted=JSON.parse(o.body);return ok(summary);});p.setAmount();await choose(p,file());const n=p.readers.length;const s=p.select(file(100,mime,'rejected'));if(p.readers.length>n)p.readers.at(-1).success();await s.done;assert.equal(p.readers.length,n);assert.equal(s.target.value,'');assert.match(p.html(),/仅支持 PNG、JPEG、WebP 或 GIF/);assert.doesNotMatch(p.html(),/已选择：/);await p.submit();assert.equal(posted.screenshotUrl,undefined);}
});
test('pending FileReader disables submit and handler prevents premature requests',async()=>{
 let posts=0;const p=page(async()=>{posts++;return ok(summary);});p.setAmount();const s=p.select(file());assert.match(p.html(),/正在读取截图/);assert.equal(p.submitButton().props.disabled,true);await p.submit();assert.equal(posts,0);p.readers[0].success();await s.done;assert.equal(p.submitButton().props.disabled,false);
});
test('late reader success cannot replace the newer selected screenshot',async()=>{
 let posted;const p=page(async(u,o)=>{if(o?.method==='POST')posted=JSON.parse(o.body);return ok(summary);});p.setAmount();const a=p.select(file(100,'image/png','old.png')),b=p.select(file(100,'image/png','new.png'));p.readers[1].success('data:image/png;base64,TkVX');await b.done;p.readers[0].success('data:image/png;base64,T0xE');await a.done;assert.match(p.html(),/已选择：new.png/);assert.doesNotMatch(p.html(),/已选择：old.png/);await p.submit();assert.equal(posted.screenshotUrl,'data:image/png;base64,TkVX');
});
test('late reader error cannot erase a newer valid selection',async()=>{
 const p=page();const a=p.select(file()),b=p.select(file(100,'image/png','current.png'));p.readers[1].success();await b.done;p.readers[0].fail();await a.done;assert.match(p.html(),/已选择：current.png/);assert.doesNotMatch(p.html(),/截图读取失败/);
});
test('rejecting a newer file invalidates a still-pending older image read',async()=>{
 const p=page();const a=p.select(file(100,'image/png','old.png'));const b=p.select(file(2097153,'image/png','oversize.png'));await b.done;p.readers[0].success();await a.done;assert.doesNotMatch(p.html(),/已选择：/);assert.match(p.html(),/截图不能超过/);
});
test('read failure or abort is visible, clears stale receipt and supports reselection',async()=>{
 for(const failure of ['fail','abort']){const p=page();p.setAmount();await choose(p,file(100,'image/png','previous.png'));const s=p.select(file());p.readers.at(-1)[failure]();await s.done;assert.match(p.html(),/截图读取失败，请重新选择图片后重试/);assert.doesNotMatch(p.html(),/已选择：/);assert.equal(s.target.value,'');assert.equal(p.submitButton().props.disabled,false);await choose(p,file(100,'image/jpeg','retry.jpg'));assert.match(p.html(),/已选择：retry.jpg/);assert.doesNotMatch(p.html(),/截图读取失败/);}
});
test('unmount invalidates a pending image read',async()=>{
 const p=page();p.mount();await new Promise(r=>setImmediate(r));const s=p.select(file());p.unmount();const html=p.html();p.readers[0].success();await s.done;assert.equal(p.html(),html);
});
test('413 with non-JSON response produces Chinese recovery guidance and keeps form inputs',async()=>{
 let reject=true,body;const p=page(async(u,o)=>{
  if(o?.method==='POST'){
   body=JSON.parse(o.body);
   if(reject)return {ok:false,status:413,json:async()=>{throw Error('HTML proxy body');}};
  }
  return ok(summary);
 });
 p.setAmount('200');await choose(p,file());await p.submit();assert.match(p.html(),/本次提交超过服务器允许的大小，请压缩凭证图片后重试/);assert.doesNotMatch(p.html(),/HTML proxy body|request entity too large/);assert.match(p.html(),/已选择：receipt.png/);assert.equal(p.submitButton().props.disabled,false);reject=false;await p.submit();assert.equal(body.amount,'200');assert.match(p.html(),/充值申请已提交/);
});
test('file input stays disabled while an actual submission is pending',async()=>{
 const d=deferred();const p=page(async(u,o)=>o?.method==='POST'?d.promise:ok(summary));p.setAmount();const pending=p.submit();assert.equal(p.input().props.disabled,true);d.resolve(ok({}));await pending;assert.equal(p.input().props.disabled,false);
});
test('successful submit resets native file input so the same image can be selected again',async()=>{
 const p=page();p.setAmount();await choose(p,file());const ref=p.input().props.ref;assert.ok(ref);ref.current={value:'previous-native-selection'};await p.submit();assert.equal(ref.current.value,'');assert.doesNotMatch(p.html(),/已选择：/);
});
