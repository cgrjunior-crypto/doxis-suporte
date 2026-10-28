const {test,before}=require('node:test');
const assert=require('node:assert/strict');
let createHandler;
before(async()=>{({createHandler}=await import('../supabase/functions/doxis-admin/handler.js'))});
const adminId='11111111-1111-4111-8111-111111111111';
const empId='22222222-2222-4222-8222-222222222222';
const docId='33333333-3333-4333-8333-333333333333';
function setup(options={}){
  const actor={id:adminId,cpf:'52998224725',role:'admin',active:true,must_change_password:false,session_not_before:0,...options.actor};
  const recipient={id:empId,cpf:'11144477735',name:'Employee',role:'employee',active:true};
  const doc={id:docId,user_cpf:recipient.cpf,name:'PDF',storage_path:`${empId}/${docId}.pdf`,status:'ready',...options.doc};
  const state={storage:[],rpc:[],audit:[],authDeletes:[],profiles:[actor,recipient],docs:[doc]};
  const err={message:'database unavailable'};
  function query(table){
    let filters=[],op='select',values,single=false;
    const q={select(){return q},eq(key,value){filters.push([key,value]);return q},single(){single=true;return q},insert(v){op='insert';values=v;return q},update(v){op='update';values=v;return q},then(resolve,reject){
      try{
        if(table==='doxis_access_logs'){state.audit.push(values);return Promise.resolve({error:options.auditFail?err:null}).then(resolve,reject)}
        const rows=table==='doxis_profiles'?state.profiles:state.docs;
        const found=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
        if(op==='update')found.forEach(r=>Object.assign(r,values));
        if(op==='insert'){
          if(options.profileFail)return Promise.resolve({error:err}).then(resolve,reject);
          rows.push(values);
        }
        return Promise.resolve({data:single?found[0]:found,error:null}).then(resolve,reject);
      }catch(e){reject(e)}
    }};return q;
  }
  const service={
    auth:{getUser:async()=>({data:{user:options.badJwt?null:{id:actor.id}},error:options.badJwt?err:null}),admin:{
      createUser:async()=>({data:{user:{id:'44444444-4444-4444-8444-444444444444'}},error:null}),
      deleteUser:async id=>{state.authDeletes.push(id);return {error:null}},
      updateUserById:async()=>({data:{user:{}},error:options.passwordFail?err:null})
    }},from:query,
    rpc:async(name,args)=>{state.rpc.push({name,args});return {error:options.rpcFail?err:null}},
    storage:{from:()=>({
      upload:async(path)=>{state.storage.push(['upload',path]);return {error:null}},
      remove:async(paths)=>{state.storage.push(['remove',paths]);return {error:options.removeFail?err:null}},
      createSignedUrl:async(path,ttl,opts)=>{state.storage.push(['sign',path,ttl,opts]);return {data:{signedUrl:'https://example.supabase.co/test'},error:null}}
    })}
  };
  const verifier={auth:{signInWithPassword:async()=>({data:{user:{id:actor.id}},error:options.wrongPassword?err:null}),signOut:async()=>({error:null})}};
  const env=name=>({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret',SUPABASE_ANON_KEY:'anon',DOXIS_ALLOWED_ORIGINS:'https://doxis.example'}[name]);
  const handler=createHandler({createClient:(_url,key)=>key==='anon'?verifier:service,env});
  const payload=Buffer.from(JSON.stringify({iat:2000000000})).toString('base64url');
  async function call(body,{token=true,origin='https://doxis.example'}={}){
    const headers={origin};if(token)headers.authorization=`Bearer header.${payload}.signature`;
    if(!(body instanceof FormData))headers['content-type']='application/json';
    const response=await handler(new Request('https://edge.example',{method:'POST',headers,body:body instanceof FormData?body:JSON.stringify(body)}));
    return {status:response.status,data:await response.json()};
  }
  return {state,call,actor,doc};
}
test('missing/invalid JWT and unapproved origins are rejected',async()=>{
  assert.equal((await setup().call({action:'view'},{token:false})).status,401);
  assert.equal((await setup({badJwt:true}).call({action:'view'})).status,401);
  assert.equal((await setup().call({action:'view'},{origin:'https://evil.example'})).status,403);
});
test('employee cannot promote themselves by supplying admin CPF or role',async()=>{
  const s=setup({actor:{role:'employee'}});
  const r=await s.call({action:'reset-password',cpf:'11144477735',p_admin_cpf:'52998224725',role:'admin',password:'newpassword'});
  assert.equal(r.status,403);assert.equal(s.state.storage.length,0);
});
test('employee cannot obtain another employee document URL',async()=>{
  const s=setup({actor:{role:'employee'}});
  assert.equal((await s.call({action:'view',document_id:docId})).status,404);
  assert.equal(s.state.storage.length,0);
});
test('first access, inactive account and revoked JWT block reads',async()=>{
  for(const actor of [{must_change_password:true},{active:false},{session_not_before:2000000001}]){
    const s=setup({actor});assert.ok([401,403].includes((await s.call({action:'view',document_id:docId})).status));assert.equal(s.state.storage.length,0);
  }
});
test('owner receives short-lived download URL and server-derived audit identity',async()=>{
  const s=setup({actor:{role:'employee'},doc:{user_cpf:'52998224725'}});
  assert.equal((await s.call({action:'download',document_id:docId,p_cpf:'forged'})).status,200);
  assert.equal(s.state.storage[0][2],300);assert.equal(s.state.storage[0][3].download,'PDF.pdf');
  assert.equal(s.state.audit[0].actor_id,adminId);assert.equal(s.state.audit[0].action,'download-link');
});
test('signed URL is not returned if audit persistence fails',async()=>{
  const s=setup({auditFail:true});const r=await s.call({action:'view',document_id:docId});
  assert.equal(r.status,503);assert.equal(r.data.url,undefined);
});
function upload(contents='%PDF-1.7\n'){
  const form=new FormData();form.set('action','upload');form.set('cpf','11144477735');form.set('name','Report');form.set('file',new File([contents],'report.pdf',{type:'application/pdf'}));return form;
}
test('server independently rejects a disguised PDF',async()=>{
  const s=setup();assert.equal((await s.call(upload('<html>bad'))).status,400);assert.equal(s.state.storage.length,0);
});
test('failed metadata transaction compensates the uploaded object',async()=>{
  const s=setup({rpcFail:true});assert.equal((await s.call(upload())).status,503);
  assert.deepEqual(s.state.storage.map(x=>x[0]),['upload','remove']);
  assert.equal(s.state.storage[0][1],s.state.storage[1][1][0]);
});
test('successful upload uses UUID path and server actor, not filename or client uploaded_by',async()=>{
  const s=setup();assert.equal((await s.call(upload())).status,200);
  assert.match(s.state.storage[0][1],new RegExp(`^${empId}/[a-f0-9-]+\\.pdf$`));
  assert.equal(s.state.rpc[0].args.p_actor,adminId);
});
test('partial deletion remains pending and does not finalize metadata',async()=>{
  const s=setup({removeFail:true});assert.equal((await s.call({action:'delete',document_id:docId})).status,503);
  assert.equal(s.doc.status,'deleting');assert.equal(s.state.rpc.length,0);
});
test('retrying pending deletion finalizes audit and metadata transaction',async()=>{
  const s=setup({doc:{status:'deleting'}});assert.equal((await s.call({action:'delete',document_id:docId})).status,200);
  assert.equal(s.state.rpc[0].name,'doxis_finalize_delete');
});
test('profile failure rolls back newly created Auth user',async()=>{
  const s=setup({profileFail:true});assert.equal((await s.call({action:'create-employee',cpf:'11144477735',name:'Name',password:'password123'})).status,409);
  assert.equal(s.state.authDeletes.length,1);
});
test('deactivation invalidates old JWTs before future reactivation',async()=>{
  const s=setup();assert.equal((await s.call({action:'set-active',cpf:'11144477735',active:false})).status,200);
  assert.equal(s.state.profiles[1].active,false);assert.ok(s.state.profiles[1].session_not_before>Date.now()/1000);
});
test('request body is bounded even without Content-Length',async()=>{
  const s=setup();assert.equal((await s.call({action:'session-start',padding:'x'.repeat(17000)})).status,413);
});
test('password change requires the old password and never stores passwords in profile or audit',async()=>{
  const invalid=setup({wrongPassword:true});
  assert.equal((await invalid.call({action:'change-password',current_password:'old-password',password:'new-password'})).status,403);
  assert.equal(invalid.actor.session_not_before,0);
  const s=setup({actor:{must_change_password:true}});
  assert.equal((await s.call({action:'change-password',current_password:'old-password',password:'new-password'})).status,200);
  assert.equal(s.actor.must_change_password,false);assert.ok(s.actor.session_not_before>Date.now()/1000);
  assert.ok(!JSON.stringify(s.state.profiles).includes('new-password'));assert.ok(!JSON.stringify(s.state.audit).includes('old-password'));
});
test('Auth failure during password reset leaves the account locked for reconciliation',async()=>{
  const s=setup({passwordFail:true});
  assert.equal((await s.call({action:'reset-password',cpf:'11144477735',password:'new-password'})).status,503);
  assert.equal(s.state.profiles[1].must_change_password,true);assert.ok(s.state.profiles[1].session_not_before>0);
});
