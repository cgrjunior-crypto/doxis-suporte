import { cpf, text, password, uuid, validatePdf } from './validation.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const ADMIN_ACTIONS = new Set(['create-employee','edit-employee','set-active','reset-password','upload','delete']);
const SELF_ACTIONS = new Set(['session-start','session-end','change-password','view','download']);
const BUCKET = 'doxis-v3-documentos';
function checked(result) {
  if (result.error) throw new HttpError(503, 'Falha no serviço. A operação não foi confirmada; tente novamente.');
  return result.data;
}
async function boundedRequest(req, limit) {
  if(!req.body)throw new HttpError(400,'Requisição inválida.');
  const reader=req.body.getReader(),chunks=[];let size=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>limit){await reader.cancel();throw new HttpError(413,'Requisição muito grande.')}
    chunks.push(value);
  }
  return new Request(req.url,{method:'POST',headers:req.headers,body:new Blob(chunks)});
}

// Inject clients so authorization and failure recovery can be tested without production.
export function createHandler({ createClient, env }) {
  return async function handle(req) {
    const origin = req.headers.get('origin');
    const allowed = (env('DOXIS_ALLOWED_ORIGINS') || '').split(',').map(x=>x.trim()).filter(Boolean);
    const headers = { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Vary':'Origin' };
    if (origin && allowed.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }
    const respond = (data, status=200)=>new Response(JSON.stringify(data), {status,headers});
    if (origin && !allowed.includes(origin)) return respond({error:'Origem não autorizada.'},403);
    if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if (req.method!=='POST') return respond({error:'Método não permitido.'},405);
    try {
      const url=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
      if (!url||!key||!anon||!allowed.length) throw new HttpError(503,'Serviço ainda não configurado.');
      const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) throw new HttpError(401,'Autenticação necessária.');
      const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data:auth,error:authError}=await admin.auth.getUser(token);
      if (authError||!auth.user) throw new HttpError(401,'Sessão inválida ou expirada.');
      const actor=checked(await admin.from('doxis_profiles').select('*').eq('id',auth.user.id).single());
      if (!actor?.active) throw new HttpError(403,'Conta indisponível.');
      // getUser validates the JWT first; iat is then compared to the server's revocation floor.
      let issuedAt=0;
      try{issuedAt=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).iat||0}catch{}
      if(issuedAt < actor.session_not_before)throw new HttpError(401,'Entre novamente para renovar a sessão.');

      let body;
      const multipart=req.headers.get('content-type')?.startsWith('multipart/form-data');
      const declared=Number(req.headers.get('content-length')||0);
      if(declared>(multipart?53*1024*1024:16384))throw new HttpError(413,'Requisição muito grande.');
      const bounded=await boundedRequest(req,multipart?53*1024*1024:16384);
      if (multipart) body=Object.fromEntries((await bounded.formData()).entries());
      else {try{body=await bounded.json()}catch{throw new HttpError(400,'Requisição inválida.')}}
      if(!body||typeof body!=='object')throw new HttpError(400,'Requisição inválida.');
      const action=body.action;
      if (!ADMIN_ACTIONS.has(action)&&!SELF_ACTIONS.has(action))throw new HttpError(400,'Ação inválida.');
      if (actor.must_change_password&&!['change-password','session-start','session-end'].includes(action))throw new HttpError(403,'Altere sua senha para continuar.');
      if (ADMIN_ACTIONS.has(action)&&actor.role!=='admin')throw new HttpError(403,'Acesso restrito ao administrador.');
      const audit=async(action,document_id=null,target_cpf=null)=>checked(await admin.from('doxis_access_logs').insert({actor_id:actor.id,actor_cpf:actor.cpf,action,document_id,target_cpf}));
      const employee=async(value)=>{
        const target=checked(await admin.from('doxis_profiles').select('*').eq('cpf',cpf(value)).eq('role','employee').single());
        if(!target)throw new HttpError(404,'Colaborador não encontrado.');
        return target;
      };
      if(action==='session-start'||action==='session-end'){
        await audit(action);return respond({ok:true});
      }
      if(action==='change-password'){
        const next=password(body.password),current=password(body.current_password);
        if(current===next)throw new HttpError(400,'Escolha uma senha diferente da atual.');
        const verifier=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
        const verified=await verifier.auth.signInWithPassword({email:`${actor.cpf}@cpf.doxis.invalid`,password:current});
        if(verified.error||verified.data?.user?.id!==actor.id)throw new HttpError(403,'Senha atual incorreta.');
        // Lock access first. If Auth fails, retrying password change remains possible.
        const floor=Math.floor(Date.now()/1000)+1;
        checked(await admin.from('doxis_profiles').update({must_change_password:true,session_not_before:floor}).eq('id',actor.id));
        const changed=await admin.auth.admin.updateUserById(actor.id,{password:next});
        // End the transient reauthentication session; never return it to the browser.
        await verifier.auth.signOut();
        checked(changed);
        await audit(action);
        checked(await admin.from('doxis_profiles').update({must_change_password:false}).eq('id',actor.id));
        return respond({ok:true});
      }
      if(action==='create-employee'){
        const targetCpf=cpf(body.cpf),name=text(body.name,120),pw=password(body.password);
        const created=await admin.auth.admin.createUser({email:`${targetCpf}@cpf.doxis.invalid`,password:pw,email_confirm:true});
        if(created.error)throw new HttpError(409,'Cadastro não concluído. Verifique se o CPF já foi cadastrado e a política de senhas.');
        const id=created.data.user.id;
        const inserted=await admin.from('doxis_profiles').insert({id,cpf:targetCpf,name,role:'employee',must_change_password:true});
        if(inserted.error){
          const rollback=await admin.auth.admin.deleteUser(id);
          if(rollback.error)throw new HttpError(503,'Cadastro incompleto. O administrador deve reconciliar a conta no Supabase Auth.');
          throw new HttpError(409,'Cadastro não concluído. Verifique se o CPF já existe.');
        }
        await audit(action,null,targetCpf);return respond({ok:true});
      }
      if(['edit-employee','set-active','reset-password'].includes(action)){
        const target=await employee(body.cpf);
        if(action==='edit-employee')checked(await admin.from('doxis_profiles').update({name:text(body.name,120)}).eq('id',target.id));
        if(action==='set-active'){
          if(typeof body.active!=='boolean')throw new HttpError(400,'Status inválido.');
          // Increment the floor on deactivation, so reactivation does not revive old JWTs.
          const values=body.active?{active:true}:{active:false,session_not_before:Math.floor(Date.now()/1000)+1};
          checked(await admin.from('doxis_profiles').update(values).eq('id',target.id));
        }
        if(action==='reset-password'){
          const pw=password(body.password);
          checked(await admin.from('doxis_profiles').update({must_change_password:true,session_not_before:Math.floor(Date.now()/1000)+1}).eq('id',target.id));
          checked(await admin.auth.admin.updateUserById(target.id,{password:pw}));
        }
        await audit(action,null,target.cpf);return respond({ok:true});
      }
      if(action==='upload'){
        const target=await employee(body.cpf),name=text(body.name,200),file=body.file;
        if(!target.active)throw new HttpError(400,'Colaborador inativo.');
        if(!(file instanceof File))throw new HttpError(400,'Selecione um PDF.');
        await validatePdf(file);
        const id=crypto.randomUUID(),path=`${target.id}/${id}.pdf`;
        checked(await admin.storage.from(BUCKET).upload(path,file,{contentType:'application/pdf',upsert:false}));
        const registered=await admin.rpc('doxis_register_document',{p_actor:actor.id,p_cpf:target.cpf,p_name:name,p_path:path,p_size:file.size,p_id:id});
        if(registered.error){
          const cleanup=await admin.storage.from(BUCKET).remove([path]);
          if(cleanup.error){
            // Only non-sensitive identifiers are logged for operator reconciliation.
            console.error('DOXIS orphan cleanup required',{document_id:id,storage_path:path});
            throw new HttpError(503,'Metadados não confirmados e limpeza pendente. Informe ao administrador.');
          }
          throw new HttpError(503,'Não foi possível salvar os metadados. O arquivo enviado foi removido.');
        }
        return respond({ok:true,id});
      }
      const doc=checked(await admin.from('doxis_documents').select('*').eq('id',uuid(body.document_id)).single());
      if(!doc||(actor.role!=='admin'&&doc.user_cpf!==actor.cpf))throw new HttpError(404,'Documento não encontrado.');
      if(action==='delete'){
        // Persist intermediate state so a partial failure is visible and safely retryable.
        checked(await admin.from('doxis_documents').update({status:'deleting'}).eq('id',doc.id));
        const removed=await admin.storage.from(BUCKET).remove([doc.storage_path]);
        if(removed.error)throw new HttpError(503,'Exclusão pendente. Tente excluir novamente.');
        const finalized=await admin.rpc('doxis_finalize_delete',{p_actor:actor.id,p_id:doc.id});
        if(finalized.error)throw new HttpError(503,'Arquivo removido; finalização pendente. Tente excluir novamente.');
        return respond({ok:true});
      }
      if(doc.status!=='ready')throw new HttpError(409,'Documento em exclusão.');
      const download=action==='download';
      const signed=checked(await admin.storage.from(BUCKET).createSignedUrl(doc.storage_path,300,download?{download:doc.name.replace(/[\r\n/\\]/g,'_')+'.pdf'}:{}));
      await audit(download?'download-link':'view-link',doc.id);
      return respond({url:signed.signedUrl});
    }catch(error){
      if(error instanceof HttpError)return respond({error:error.message},error.status);
      if(error instanceof Error&&['Campo inválido.','CPF inválido.','Identificador inválido.','Selecione um arquivo PDF.','O arquivo não possui assinatura de PDF.','O PDF deve ter até 50 MB e não pode estar vazio.','A senha deve ter entre 8 e 128 caracteres.'].includes(error.message))return respond({error:error.message},400);
      return respond({error:'Não foi possível concluir a operação. Tente novamente.'},500);
    }
  };
}
