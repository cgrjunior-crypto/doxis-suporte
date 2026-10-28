const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function app(){
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',style:{},disabled:false});return elements.get(id)};
  const auth={getSession:async()=>({data:{session:null},error:null}),getUser:async()=>({data:{user:null},error:null}),onAuthStateChange(){},signOut:async()=>({error:null})};
  const sb={auth,from(){throw new Error('unexpected query')}};
  const removed=[];
  const context=vm.createContext({console,URL,TextDecoder,File,Blob,FormData,atob,Date,setTimeout,clearTimeout,
    supabase:{createClient:()=>sb},SUPABASE_URL:'https://example.supabase.co',SUPABASE_KEY:'anon',
    localStorage:{removeItem:key=>removed.push(key)},document:{getElementById:element},prompt:()=>null});
  vm.runInContext(fs.readFileSync('security.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app.js','utf8').replace(/\ninit\(\);\s*$/,''),context);
  return {run:code=>vm.runInContext(code,context),sb,element,removed};
}
function seed(a){a.run(`A.profile={id:'11111111-1111-4111-8111-111111111111',cpf:'52998224725',name:'<img src=x onerror="alert(1)">',role:'admin',active:true};A.docs=[{id:'22222222-2222-4222-8222-222222222222',name:'<svg onload="alert(1)">',user_cpf:'52998224725',size:8,status:'ready',uploaded_at:'2026-01-01'}];A.emps=[{...A.profile,role:'employee'}];A.v='admin';`)}
test('profile, document, collaborator and modal names are rendered as text',()=>{
  const a=app();seed(a);
  for(const code of ["vDs()","vPf()","vAd()","(A.aT='docs',vAd())","(A.aT='employees',vAd())","(A.aT='upload',vAd())"]){
    const html=a.run(code);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<svg'));assert.match(html,/&lt;img/);
  }
  a.run("mRst('52998224725')");assert.ok(!a.element('modal').innerHTML.includes('<img'));
});
test('required password change cannot be bypassed by selecting admin view',()=>{
  const a=app();seed(a);a.run("A.profile.must_change_password=true;A.v='admin';R()");
  assert.equal(a.run('A.v'),'profile');assert.match(a.element('app').innerHTML,/Para continuar, altere a senha/);
});
test('loading error replaces stale data and does not present an empty list',()=>{
  const a=app();seed(a);a.run("A.loadError='Conexão indisponível';R()");
  assert.match(a.element('app').innerHTML,/Conexão indisponível/);
  assert.ok(!a.element('app').innerHTML.includes('Nenhum documento'));
  assert.ok(!a.element('app').innerHTML.includes('&lt;svg'));
});
test('legacy localStorage profile is discarded and cannot restore an admin session',async()=>{
  const a=app();await a.run('init()');assert.deepEqual(a.removed,['doxis_s']);assert.equal(a.run('A.profile'),null);assert.equal(a.run('A.v'),'login');
});
test('failed login displays an error after SDK sign-out and rerender',async()=>{
  const a=app();a.run("A.v='login';R()");a.element('lc').value='52998224725';a.element('lp').value='wrong-password';
  a.sb.auth.signInWithPassword=async()=>({error:{message:'invalid'}});
  await a.run('dL()');assert.match(a.element('le').textContent,/CPF ou senha inválidos/);assert.equal(a.element('le').style.display,'block');
});
test('data query failures reject instead of turning into zero documents',async()=>{
  const a=app();seed(a);
  const q={eq(){return q},order(){return q},range:async()=>({data:null,error:{message:'offline'}})};
  a.sb.from=()=>({select:()=>q});
  await assert.rejects(a.run('loadMyDocs()'),/Não foi possível carregar/);
  assert.equal(a.run('A.docs.length'),1);
});
