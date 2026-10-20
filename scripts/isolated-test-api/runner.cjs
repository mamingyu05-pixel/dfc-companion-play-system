'use strict';
// Reuses installed PG16.14 and the prior in-memory SCRAM bootstrap. No installation.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),vm=require('node:vm');
const {spawn}=require('node:child_process'),{createRequire}=require('node:module'),{randomUUID,createHash}=require('node:crypto'),assert=require('node:assert/strict');
const here=__dirname,repo=path.resolve(here,'../..');
const {verifyMigrationManifest,readVerifiedMigration}=require('./migration-contract.cjs');
const manifestPath=path.resolve(process.argv[3]||'');
const runDir=path.resolve(process.argv[2]||''),dataDir=path.join(runDir,'data');
if(path.dirname(runDir)!==path.join(path.dirname(manifestPath),'dfc-test-api-runs')||!fs.existsSync(runDir)||fs.existsSync(dataDir))throw Error('Need a fresh owned run directory');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const interactiveMode=process.argv[4]==='--interactive';
const interactiveSeconds=interactiveMode?Number(process.argv[5]):0,workDeadline=interactiveMode?Number(process.argv[6]):0;
if((process.argv.length>4&&!interactiveMode)||(interactiveMode&&(!Number.isInteger(interactiveSeconds)||interactiveSeconds<15||interactiveSeconds>90||!Number.isFinite(workDeadline)||workDeadline<=Date.now()||workDeadline>Date.now()+120000)))throw Error('Invalid interactive TEST bounds');
let controlStopped=false,commandHandler=()=>false;
const deps=createRequire(path.join(repo,'apps/api-server/package.json'));
const er=createRequire(createRequire(path.join(repo,'../dfc-test-tools/package.json')).resolve('embedded-postgres'));
const safe=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,safe,{NODE_ENV:'test',DFC_TEST_MODE:'1',DFC_BACKGROUND_JOBS_ENABLED:'false'});
const result={started:new Date().toISOString(),runDir,candidateSetSha256:manifest.candidateSetSha256,pgManifestSha256:createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),realKook:false,realPayment:false,productionAccess:false,businessLogin:false,migrations:[],tests:[],loadedSources:[],ownedChildren:[],groupsExpected:interactiveMode?0:4,interactiveMode};
let password,server,pglog='',observer,bin,jwtSecret;const clients=[],cleanups=[];
const registerCleanup=fn=>cleanups.push(fn);
const redact=x=>String(x).replaceAll(password||'NONEXISTENT_SECRET','[ephemeral-redacted]').replaceAll(jwtSecret||'NONEXISTENT_JWT_SECRET','[ephemeral-redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[ephemeral-token-redacted]');
const save=()=>fs.writeFileSync(path.join(runDir,'execution.json'),JSON.stringify(result,null,2));
const cancelled=()=>controlStopped||fs.existsSync(path.join(runDir,'stop-request.json'));
function check(){if(cancelled())throw Error('Owned resource/deadline stop requested');}
async function run(name,exe,args,env=safe,input){
 check();let output='';const child=spawn(exe,args,{cwd:runDir,env,windowsHide:true,stdio:['pipe','pipe','pipe']});result.ownedChildren.push({name,pid:child.pid});save();
 child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.stdin.on('error',()=>{});child.stdin.end(input);
 const start=Date.now(),timer=setInterval(()=>{if(Date.now()-start>60000||cancelled())child.kill();},250);
 let code;try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});}finally{clearInterval(timer);}
 fs.writeFileSync(path.join(runDir,name+'.log'),redact(output));if(code!==0)throw Error(name+' failed: '+code);return code;
}
async function test(name,fn){check();const began=Date.now();try{await fn();result.tests.push({name,passed:true,ms:Date.now()-began});}catch(e){result.tests.push({name,passed:false,error:redact(e.stack),ms:Date.now()-began});throw e;}finally{save();console.log(JSON.stringify(result.tests.at(-1)));}}
function loader(){
 const ts=deps('typescript'),cache=new Map(),sources=new Map(manifest.candidateFiles.map(x=>[x.relativePath,x.source]));
 function load(relative){
  relative=relative.replaceAll('\\','/');if(cache.has(relative))return cache.get(relative);
  const file=sources.get(relative)||path.join(repo,relative),source=fs.readFileSync(file,'utf8'),exports={};cache.set(relative,exports);
  result.loadedSources.push({relative,file,sha256:createHash('sha256').update(source).digest('hex')});
  const output=ts.transpileModule(source,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
  const local=name=>name.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(relative),name.endsWith('.ts')?name:name+'.ts'))):/^@dfc\/(shared|auth|config|database)$/.test(name)?load('packages/'+name.slice(5)+'/src/index.ts'):deps(name);
  // Same Error identity as installed Nest, matching the repaired local fixture.
  vm.runInNewContext(output,{exports,require:local,process,Buffer,TextEncoder,Uint8Array,URL,Date,Error,Reflect,globalThis,setTimeout,clearTimeout,setInterval,clearInterval,console,fetch(){throw Error('External fetch forbidden');}},{filename:file});return exports;
 }return load;
}
async function main(){
 const input=require('node:readline').createInterface({input:process.stdin,crlfDelay:Infinity});
 registerCleanup(async()=>input.close());
 const permit=await new Promise(resolve=>{
  let first=true;
  input.on('line',line=>{
   if(first){first=false;resolve(line);return;}
   if(!interactiveMode)return;
   if(line==='STOP'){controlStopped=true;commandHandler(line);}
   else if(/^APPROVE [0-9]{6}$/.test(line))commandHandler(line);
  });
  input.on('close',()=>{if(first)resolve('');if(interactiveMode)controlStopped=true;});
 });
 if(permit!==(interactiveMode?'APPROVED_TEST_API_PG_INTERACTIVE':'APPROVED_TEST_API_PG'))throw Error('Missing verified owned Job permit');
 // Validate complete coverage before checks, credentials, initdb or any PG executable.
 const migrationPlan=verifyMigrationManifest(repo,manifest.migrations);
 result.migrationContract={count:migrationPlan.length,completeInventoryVerified:true};save();
 await run('offline-migrations',process.execPath,['--max-old-space-size=128',path.join(here,'migration-contract.test.cjs')]);
 // All checks must pass inside the same resource deadline before any PG executable is attempted.
 await run('offline-configuration',process.execPath,['--max-old-space-size=384',path.join(here,'offline.test.cjs')]);
 await run('offline-interactive',process.execPath,['--max-old-space-size=128',path.join(here,'interactive.test.cjs')]);
 await run('offline-types',process.execPath,['--max-old-space-size=384',path.join(here,'check-types.cjs')]);
 result.offlinePreflightPassed=true;save();
 // Refuse implicit dotenv loading; this says nothing about historical deployment configuration.
 for(const relative of ['.env','apps/api-server/.env','packages/database/.env','packages/database/prisma/.env'])if(fs.existsSync(path.join(repo,relative)))throw Error('Environment file present; isolated runner refuses implicit loading');
 // Recheck after offline work, immediately before preparing the fresh PG cluster.
 verifyMigrationManifest(repo,migrationPlan);
 password=randomUUID()+randomUUID();jwtSecret=randomUUID()+randomUUID();
 const suffix=randomUUID().replaceAll('-','').slice(0,16),dbUser='dfc_test_'+suffix,database='dfc_test_'+suffix;result.isolatedRole=dbUser;result.database=database;
 bin=Object.fromEntries(Object.entries(manifest.tools).map(([k,v])=>[k,v.path]));
 for(const [name,tool] of Object.entries(manifest.tools))assert.equal(createHash('sha256').update(fs.readFileSync(tool.path)).digest('hex'),tool.sha256,'Tool changed '+name);
 result.tools=manifest.tools;fs.copyFileSync(__filename,path.join(runDir,'runner-source.cjs'));fs.copyFileSync(path.join(here,'cases.cjs'),path.join(runDir,'cases-source.cjs'));save();
 await run('initdb',bin.initdb,['-D',dataDir,'-U',dbUser,'--auth=scram-sha-256','-W','--no-clean','--locale=C','--encoding=UTF8','-c','shared_buffers=32MB','-c','max_connections=8'],{...safe,OSTYPE:'msys'},password+'\n'+password+'\n');
 check();const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p));});});result.port=port;
 server=spawn(bin.postgres,['-D',dataDir,'-h','127.0.0.1','-p',String(port),'-c','max_connections=8','-c','shared_buffers=32MB','-c','work_mem=1MB','-c','maintenance_work_mem=16MB','-c','max_worker_processes=0','-c','max_parallel_workers=0','-c','autovacuum=off','-c','statement_timeout=12000','-c','idle_in_transaction_session_timeout=12000'],{cwd:runDir,env:safe,windowsHide:true,stdio:['ignore','pipe','pipe']});
 result.ownedPgPid=server.pid;result.ownedChildren.push({name:'postgres',pid:server.pid});server.stdout.on('data',x=>pglog=(pglog+x).slice(-(2**20)));server.stderr.on('data',x=>pglog=(pglog+x).slice(-(2**20)));server.on('error',e=>pglog+=e.message);save();
 const {Client}=er('pg'),config={host:'127.0.0.1',port,user:dbUser,password,database:'postgres',connectionTimeoutMillis:1000};
 for(let i=0;i<80;i++){check();observer=new Client(config);try{await observer.connect();break;}catch{await observer.end().catch(()=>{});observer=null;await new Promise(r=>setTimeout(r,100));}}
 if(!observer)throw Error('Owned PG did not start');
 const identity=await observer.query("SELECT current_setting('data_directory') AS path, version() AS version");assert.equal(path.resolve(identity.rows[0].path).toLowerCase(),dataDir.toLowerCase());assert.match(identity.rows[0].version,/PostgreSQL 16\.14,/);result.clusterVerified=identity.rows[0];
 const auth=await observer.query('SELECT DISTINCT auth_method FROM pg_hba_file_rules WHERE error IS NULL');assert(auth.rows.length&&auth.rows.every(r=>r.auth_method==='scram-sha-256'));result.authVerified='SCRAM-only; password supplied through memory/stdin, never saved';
 assert.match(database,/^dfc_test_[a-z0-9_]+$/);await observer.query('CREATE DATABASE '+database);await observer.end();observer=new Client({...config,database});await observer.connect();
 // Recheck the complete sealed set before the first migration SQL.
 verifyMigrationManifest(repo,migrationPlan);
 for(const migration of migrationPlan){check();const sql=readVerifiedMigration(repo,migration);await observer.query('BEGIN');try{await observer.query(sql);await observer.query('COMMIT');}catch(e){await observer.query('ROLLBACK');throw Error('Migration '+migration.name+': '+e.message);}result.migrations.push({name:migration.name,sha256:migration.sha256});save();}
 result.migrationExecution=migrationPlan.length+' current repository SQL migrations in this new synthetic database only. No existing database or Prisma deploy/generate.';
 const {PrismaClient}=deps('@prisma/client'),url=`postgresql://${dbUser}:${password}@127.0.0.1:${port}/${database}?connection_limit=1&pool_timeout=5`;
 const apiPort=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p));});});
 assert.notEqual(apiPort,port);
 Object.assign(process.env,{DATABASE_URL:url,JWT_SECRET:jwtSecret,DFC_ISOLATED_API:'1',DFC_ISOLATED_DATABASE:database,
  DFC_STORE_KEY:'TEST_'+suffix,DFC_TEST_SUBJECT:randomUUID(),API_HOST:'127.0.0.1',API_PORT:String(apiPort),DFC_OUTBOUND_POLICY:'deny'});
 deps('reflect-metadata');const load=loader();
 const isolation=load('apps/api-server/src/isolated-test-runtime.ts').isolatedTestConfig();
 const restoreNetwork=load('apps/api-server/src/isolated-test-network.ts').installIsolatedNetwork(isolation);
 registerCleanup(async()=>restoreNetwork());
 for(let i=0;i<2;i++){const client=new PrismaClient({datasources:{db:{url}},transactionOptions:{maxWait:8000,timeout:12000}});clients.push(client);await client.$connect();}
 const interactive=interactiveMode?{seconds:interactiveSeconds,workDeadline,cancelled,
  setCommandHandler(handler){commandHandler=handler;},onState(state){result.interactive=state;save();fs.writeFileSync(path.join(runDir,'interactive-state.json'),JSON.stringify(state,null,2));}}:null;
 await require('./cases.cjs')({load,prisma:clients[0],second:clients[1],observer,test,result,check,manifest,isolation,registerCleanup,interactive});
 if(interactiveMode){assert.equal(result.interactive.stage,'stopped');assert(['operator','deadline','guard-stop'].includes(result.interactive.stopReason));}
 else{assert.equal(result.tests.length,4);assert(result.tests.every(t=>t.passed));}
 for(const item of result.loadedSources){const expected=manifest.protectedOriginal[item.relative];assert(expected,'Unsealed source '+item.relative);assert.equal(item.sha256,expected,'Loaded source drift '+item.relative);}
 result.success=true;save();
}
main().catch(error=>{result.failure=redact(error.stack);
 const response=typeof error.getResponse==='function'?error.getResponse():null;
 if(response?.code==='ISOLATED_DATABASE_REJECTED')result.failureDiagnostics=response.isolation;
 result.success=false;process.exitCode=1;}).finally(async()=>{
 for(const cleanup of cleanups.reverse()){try{await cleanup();}catch{result.success=false;result.cleanupError=true;process.exitCode=1;}}
 for(const client of clients)await client.$disconnect().catch(()=>{});if(observer)await observer.end().catch(()=>{});
 if(server?.pid){
  const pidfile=path.join(dataDir,'postmaster.pid');let owns=false;try{owns=Number(fs.readFileSync(pidfile,'utf8').split(/\r?\n/)[0])===server.pid;}catch{}
  if(owns){const stop=spawn(bin.pg_ctl,['-D',dataDir,'-m','fast','-w','-t','15','stop'],{cwd:runDir,env:safe,windowsHide:true,stdio:['ignore','pipe','pipe']});result.ownedChildren.push({name:'pg_ctl_stop',pid:stop.pid});let output='';stop.stdout.on('data',x=>output+=x);stop.stderr.on('data',x=>output+=x);result.stopExit=await new Promise(resolve=>{stop.once('error',()=>resolve(-1));stop.once('exit',resolve);});fs.writeFileSync(path.join(runDir,'stop.log'),redact(output));if(result.stopExit!==0){result.success=false;process.exitCode=1;}}
  else{result.stopOwnershipMismatch=true;result.success=false;process.exitCode=1;}
 }
 fs.writeFileSync(path.join(runDir,'postgres.log'),redact(pglog));result.finished=new Date().toISOString();save();console.log(JSON.stringify({success:result.success,passed:result.tests.filter(t=>t.passed).length,failed:result.tests.filter(t=>!t.passed).length,stopExit:result.stopExit,failure:result.failure,runDir}));password=undefined;jwtSecret=undefined;delete process.env.JWT_SECRET;delete process.env.DATABASE_URL;
});
