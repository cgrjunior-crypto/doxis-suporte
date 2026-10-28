const { escapeHtml: esc, validCpf, validatePdf } = DoxisSecurity
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth:{storageKey:'doxis_v3_auth'}})
const BUCKET = 'doxis-v3-documentos'
// ── Cores ──
const O='#F97316',OD='#EA580C',BK='#080808',S1='#0F0F0F',S2='#161616',S3='#1E1E1E',S4='#262626',BR='#2C2C2C',TX='#EDEBE8',MU='#666',DG='#EF4444',GR='#22C55E'
const FD="'Barlow Condensed',sans-serif"

// ── Estado da aplicação ──
let A = {
  v:'loading',       // view atual
  profile:null,      // {id, cpf, name, role}
  docs:[],           // documentos
  emps:[],           // colaboradores (admin)
  aT:'overview',     // aba admin
  fC:'all',          // filtro por CPF
  sd:null,           // doc selecionado (viewer)
  bUrl:null,         // URL assinada do PDF
}

// ── Toast ──
function tos(m,t='ok'){
  const e=document.getElementById('toast')
  e.textContent=m; e.style.display='block'
  e.style.background=t==='err'?DG:t==='wa'?'#F59E0B':GR
  clearTimeout(e._t); e._t=setTimeout(()=>e.style.display='none',3200)
}

// ── Modal ──
function cMo(){ document.getElementById('modal').innerHTML='' }

// ── Utilitários ──
const fC=v=>{const d=v.replace(/\D/g,'').slice(0,11);return d.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')}
const rC=v=>v.replace(/\D/g,'')
const fSz=b=>b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB'
const fDt=s=>s?new Date(s).toLocaleDateString('pt-BR'):'—'
const ini=n=>n.split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
const av=(n,z=34)=>`<div style="width:${z}px;height:${z}px;background:${O};border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:${FD};font-weight:700;font-size:${Math.round(z*.38)}px;color:${BK};flex-shrink:0">${esc(ini(n))}</div>`
const lg=big=>`<div style="display:flex;align-items:center;gap:10px"><div style="width:${big?35:23}px;height:${big?48:32}px;background:${O};border-radius:3px 10px 3px 3px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-family:${FD};font-weight:800;font-size:${big?26:17}px;color:${BK};line-height:1">D</span></div><span style="font-family:${FD};font-weight:700;font-size:${big?40:24}px;color:${TX};letter-spacing:5px;line-height:1">OXIS</span></div>`
const nv=()=>`<div style="height:60px;background:${S1};border-bottom:1px solid ${BR};display:flex;align-items:center;justify-content:space-between;padding:0 32px;flex-shrink:0">${lg(false)}<div style="display:flex;align-items:center;gap:10px"><button onclick="A.v='profile';R()" style="display:flex;align-items:center;gap:9px;background:${S3};border:1px solid ${BR};border-radius:8px;padding:6px 14px 6px 8px;transition:border-color .2s" onmouseover="this.style.borderColor='${O}'" onmouseout="this.style.borderColor='${BR}'">${av(A.profile.name,30)}<div style="text-align:left"><div style="font-size:13px;font-weight:600;color:${TX}">${esc(A.profile.name)}</div><div style="font-size:11px;color:${MU}">${A.profile.role==='admin'?'Administrador':'Colaborador'}</div></div></button><button onclick="refreshData()" class="bg" style="padding:8px;font-size:13px">Atualizar</button><button onclick="lo()" class="bg" style="padding:8px 14px;font-size:13px;display:flex;align-items:center;gap:5px"><i class="ti ti-logout" style="font-size:14px"></i>Sair</button></div></div>`

// ── Card de documento ──
function cd(d,del){
  return `<div style="background:${S2};border:1px solid ${BR};border-radius:12px;overflow:hidden;transition:all .2s" onmouseover="this.style.borderColor='${O}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='${BR}';this.style.transform='translateY(0)'">
    <div style="height:3px;background:linear-gradient(90deg,${O},${OD})"></div>
    <div style="padding:16px 18px 14px">
      <div style="display:flex;align-items:flex-start;gap:11px;margin-bottom:13px">
        <div style="width:36px;height:44px;background:${O}14;border:1px solid ${O}28;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ti-file-type-pdf" style="font-size:18px;color:${O}"></i></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;color:${TX};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}${d.status==='deleting'?' (exclusão pendente)':''}</div>
          <div style="font-size:12px;color:${MU};margin-top:3px"><i class="ti ti-calendar" style="font-size:11px"></i> ${fDt(d.uploaded_at)} · ${fSz(d.size||0)}</div>
        </div>
      </div>
      <div style="display:flex;gap:7px">
        <button onclick="oV('${d.id}')" class="bp" style="flex:1;padding:8px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:4px"><i class="ti ti-eye" style="font-size:13px"></i>Visualizar</button>
        <button onclick="dlD('${d.id}')" class="bg" style="flex:1;padding:8px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:4px"><i class="ti ti-download" style="font-size:13px"></i>Download</button>
        ${del?`<button onclick="ddD('${d.id}')" class="bd" style="padding:8px 10px;font-size:13px"><i class="ti ti-trash" style="font-size:14px"></i></button>`:''}
      </div>
    </div>
  </div>`
}

// ════════════════════════════════════════════════
//  VIEWS
// ════════════════════════════════════════════════

function vLoad(){
  return `<div style="height:100vh;display:flex;align-items:center;justify-content:center;background:${BK}"><div style="text-align:center"><div style="font-family:${FD};font-size:40px;color:${O};letter-spacing:5px;margin-bottom:20px">DOXIS</div><div style="width:32px;height:32px;border:3px solid ${BR};border-top-color:${O};border-radius:50%;animation:spin .8s linear infinite;margin:0 auto"></div><div style="font-size:13px;color:${MU};margin-top:16px">Conectando...</div></div></div>`
}

function vLg(){
  return `<div style="min-height:100vh;background:${BK};display:flex;align-items:center;justify-content:center;padding:24px;overflow:hidden">
    <div style="position:fixed;top:-180px;right:-180px;width:500px;height:500px;background:${O};opacity:.04;border-radius:50%;pointer-events:none"></div>
    <div class="fu" style="width:100%;max-width:420px">
      <div style="background:${S1};border:1px solid ${BR};border-radius:16px;padding:42px">
        <div style="display:flex;justify-content:center;margin-bottom:10px">${lg(true)}</div>
        <p style="text-align:center;font-family:${FD};font-size:12px;color:${MU};letter-spacing:2px;margin-bottom:36px;text-transform:uppercase">Gestão Segura de Documentos</p>
        <div style="display:flex;flex-direction:column;gap:15px">
          <div><label class="fl">CPF</label><input id="lc" placeholder="000.000.000-00" oninput="this.value=fC(this.value)" onkeydown="if(event.key==='Enter')dL()"></div>
          <div><label class="fl">Senha</label><input id="lp" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')dL()"></div>
          <div id="le" style="font-size:13px;color:${DG};text-align:center;display:none"></div>
          <button id="lbtn" class="bp" onclick="dL()" style="padding:13px;font-size:15px;width:100%;margin-top:4px">Entrar</button>
          <p style="text-align:center;font-size:12px;color:${MU}">Esqueceu a senha? Fale com o administrador.</p>
        </div>
        <p style="font-size:11px;color:#1E1E1E;text-align:center;margin-top:28px">DOXIS v3 · © 2026 · Powered by Supabase</p>
      </div>
    </div>
  </div>`
}

function vDs(){
  return `<div style="height:100vh;display:flex;flex-direction:column;background:${BK}">
    ${nv()}${loadWarning()}
    <div style="background:linear-gradient(135deg,${S1},${S2});border-bottom:1px solid ${BR};padding:24px 40px">
      <div style="max-width:880px;margin:0 auto;display:flex;align-items:center;justify-content:space-between">
        <div><h1 style="font-family:${FD};font-weight:700;font-size:32px;color:${TX}">Meus Documentos</h1><p style="font-size:13px;color:${MU};margin-top:2px">${A.docs.length} documento${A.docs.length!==1?'s':''} disponível${A.docs.length!==1?'is':''}</p></div>
        <div style="background:${S3};border:1px solid ${BR};border-radius:10px;padding:12px 18px;text-align:center"><div style="font-family:${FD};font-size:30px;font-weight:700;color:${O};line-height:1">${A.docs.length}</div><div style="font-size:11px;color:${MU};text-transform:uppercase;letter-spacing:1px;margin-top:2px">Total</div></div>
      </div>
    </div>
    <div style="flex:1;overflow:auto;padding:28px 40px">
      <div style="max-width:880px;margin:0 auto">
        ${A.docs.length===0
          ?`<div style="text-align:center;padding:72px 0"><div style="width:68px;height:68px;background:${S3};border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px"><i class="ti ti-file-off" style="font-size:30px;color:${MU}"></i></div><p style="font-size:15px;color:${MU};margin-bottom:5px">Nenhum documento disponível</p><p style="font-size:13px;color:#2C2C2C">Seus documentos aparecerão aqui quando enviados pelo RH</p></div>`
          :`<div class="fu" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px">${A.docs.map(d=>cd(d,false)).join('')}</div>`
        }
      </div>
    </div>
  </div>`
}

function vVw(){
  const d=A.sd,bk=A.profile.role==='admin'?'admin':'dashboard'
  return `<div style="height:100vh;display:flex;flex-direction:column;background:${BK}">
    ${nv()}${loadWarning()}
    <div style="display:flex;align-items:center;gap:12px;padding:9px 32px;background:${S1};border-bottom:1px solid ${BR}">
      <button onclick="A.v='${bk}';R()" style="background:transparent;color:${MU};font-size:14px;display:flex;align-items:center;gap:5px"><i class="ti ti-arrow-left" style="font-size:15px"></i>Voltar</button>
      <span style="color:${BR}">|</span>
      <i class="ti ti-file-type-pdf" style="font-size:15px;color:${O}"></i>
      <span style="font-size:14px;color:${TX};font-weight:500;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}${d.status==='deleting'?' (exclusão pendente)':''}</span>
      <span style="font-size:12px;color:${MU};white-space:nowrap">${fDt(d.uploaded_at)}</span>
      <button onclick="dlD('${d.id}')" class="bg" style="padding:6px 13px;font-size:13px;display:flex;align-items:center;gap:5px"><i class="ti ti-download" style="font-size:13px"></i>Download</button>
    </div>
    <div style="flex:1;overflow:hidden;background:${S1}"><iframe src="${esc(A.bUrl)}" style="width:100%;height:100%;border:none" title="${esc(d.name)}${d.status==='deleting'?' (exclusão pendente)':''}"></iframe></div>
  </div>`
}

function vPf(){
  const p=A.profile,bk=p.role==='admin'?'admin':'dashboard'
  return `<div style="height:100vh;display:flex;flex-direction:column;background:${BK}">
    ${nv()}${loadWarning()}
    <div style="flex:1;overflow:auto;padding:38px">
      <div style="max-width:560px;margin:0 auto">
        <button onclick="A.v='${bk}';R()" style="background:transparent;color:${MU};font-size:14px;display:flex;align-items:center;gap:6px;margin-bottom:26px;padding:0"><i class="ti ti-arrow-left" style="font-size:15px"></i>Voltar</button>
        <div class="fu" style="background:${S2};border:1px solid ${BR};border-radius:14px;padding:28px;margin-bottom:18px">
          <div style="display:flex;align-items:center;gap:18px;margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid ${BR}">
            <div style="width:66px;height:66px;background:${O};border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:${FD};font-weight:700;font-size:24px;color:${BK};flex-shrink:0">${esc(ini(p.name))}</div>
            <div><div style="font-family:${FD};font-weight:700;font-size:26px;color:${TX}">${esc(p.name)}</div><div style="font-size:13px;color:${MU};margin-top:2px">${p.role==='admin'?'Administrador':'Colaborador'}</div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
            <div style="background:${S3};border-radius:8px;padding:13px"><div style="font-size:11px;color:${MU};letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">CPF</div><div style="font-size:14px;color:${TX};font-weight:500">${fC(p.cpf)}</div></div>
            <div style="background:${S3};border-radius:8px;padding:13px"><div style="font-size:11px;color:${MU};letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">${p.role==='admin'?'Acesso':'Documentos'}</div><div style="font-size:14px;color:${O};font-weight:600">${p.role==='admin'?'Administrador':A.docs.length+' arquivo'+(A.docs.length!==1?'s':'')}</div></div>
          </div>
        </div>
        <div class="fu" style="background:${S2};border:1px solid ${BR};border-radius:14px;padding:28px">
          <h3 style="font-family:${FD};font-size:21px;font-weight:700;color:${TX};margin-bottom:5px;display:flex;align-items:center;gap:8px"><i class="ti ti-lock" style="font-size:18px;color:${O}"></i>Alterar Senha</h3>
          <p style="font-size:13px;color:${MU};margin-bottom:20px">${p.must_change_password?'Para continuar, altere a senha inicial ou redefinida.':'Use uma senha exclusiva para esta conta.'}</p>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div><label class="fl">Senha atual</label><input id="pc" type="password" placeholder="••••••••"></div>
            <div><label class="fl">Nova senha</label><input id="p1" type="password" placeholder="Mínimo 8 caracteres"></div>
            <div><label class="fl">Confirmar nova senha</label><input id="p2" type="password" onkeydown="if(event.key==='Enter')chP()"></div>
            <div id="pEr" style="font-size:13px;color:${DG};display:none"></div>
            <div id="pOk" style="font-size:13px;color:${GR};display:none"></div>
            <button id="chpBtn" class="bp" onclick="chP()" style="padding:12px;font-size:14px;width:100%"><i class="ti ti-shield-check" style="font-size:14px;vertical-align:-2px;margin-right:5px"></i>Salvar Nova Senha</button>
          </div>
        </div>
      </div>
    </div>
  </div>`
}

function vAd(){
  const tabs=[['overview','Visão Geral','ti-layout-dashboard'],['docs','Documentos','ti-files'],['employees','Colaboradores','ti-users'],['upload','Enviar Documento','ti-upload'],['logs','Registros','ti-history']]
  const fDs=A.fC==='all'?A.docs:A.docs.filter(d=>d.user_cpf===A.fC)
  let ct=''

  if(A.aT==='overview'){
    const rec=[...A.docs].sort((a,b)=>new Date(b.uploaded_at)-new Date(a.uploaded_at)).slice(0,5)
    const now=new Date()
    const thisMo=A.docs.filter(d=>{const dt=new Date(d.uploaded_at);return dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear()}).length
    const sts=[{i:'ti-users',l:'Colaboradores',v:A.emps.length,c:O},{i:'ti-files',l:'Documentos',v:A.docs.length,c:'#60A5FA'},{i:'ti-calendar-stats',l:'Este mês',v:thisMo,c:GR}]
    ct=`<div class="si"><h2 style="font-family:${FD};font-weight:700;font-size:28px;color:${TX};margin-bottom:20px">Visão Geral</h2>
    <div style="display:flex;gap:14px;margin-bottom:24px">${sts.map(s=>`<div class="sc"><div style="width:40px;height:40px;background:${s.c}18;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:12px"><i class="ti ${s.i}" style="font-size:20px;color:${s.c}"></i></div><div style="font-family:${FD};font-size:38px;font-weight:700;color:${TX};line-height:1">${s.v}</div><div style="font-size:13px;color:${MU};margin-top:4px">${s.l}</div></div>`).join('')}</div>
    <div style="background:${S2};border:1px solid ${BR};border-radius:12px;overflow:hidden">
      <div style="padding:16px 20px;border-bottom:1px solid ${BR};display:flex;align-items:center;justify-content:space-between"><h3 style="font-family:${FD};font-size:20px;font-weight:600;color:${TX}">Documentos Recentes</h3><button onclick="A.aT='docs';R()" style="background:transparent;color:${O};font-size:13px;font-weight:500">Ver todos →</button></div>
      ${rec.length===0?`<div style="padding:32px;text-align:center;color:${MU}">Nenhum documento ainda. Envie o primeiro pelo menu <strong style="color:${TX}">Enviar Documento</strong>.</div>`:`
      <table style="width:100%;border-collapse:collapse"><tbody>${rec.map(d=>{const e=A.emps.find(x=>x.cpf===d.user_cpf);return`<tr style="border-bottom:1px solid ${S4}" onmouseover="this.style.background='${S3}'" onmouseout="this.style.background='transparent'"><td style="padding:11px 20px"><div style="display:flex;align-items:center;gap:9px"><div style="width:30px;height:36px;background:${O}14;border:1px solid ${O}22;border-radius:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ti-file-type-pdf" style="font-size:14px;color:${O}"></i></div><div><div style="font-size:14px;color:${TX};font-weight:500">${esc(d.name)}${d.status==='deleting'?' (exclusão pendente)':''}</div><div style="font-size:12px;color:${MU}">${e?esc(e.name):fC(d.user_cpf)}</div></div></div></td><td style="padding:11px 20px;font-size:13px;color:${MU};text-align:right;white-space:nowrap">${fDt(d.uploaded_at)}</td><td style="padding:11px 20px;text-align:right"><button onclick="oV('${d.id}')" style="background:transparent;color:${O};font-size:13px;font-weight:500">Ver →</button></td></tr>`}).join('')}</tbody></table>`}
    </div></div>`
  }

  if(A.aT==='docs'){
    const rows=fDs.length===0?`<tr><td colspan="5" style="padding:36px;text-align:center;color:${MU}">Nenhum documento encontrado.</td></tr>`:fDs.map(d=>{const e=A.emps.find(x=>x.cpf===d.user_cpf);return`<tr style="border-bottom:1px solid ${S4}" onmouseover="this.style.background='${S3}'" onmouseout="this.style.background='transparent'"><td style="padding:11px 12px"><div style="font-size:13px;color:${TX};font-weight:500">${e?esc(e.name):fC(d.user_cpf)}</div><div style="font-size:11px;color:${MU}">${fC(d.user_cpf)}</div></td><td style="padding:11px 12px"><div style="display:flex;align-items:center;gap:6px"><i class="ti ti-file-type-pdf" style="font-size:13px;color:${O}"></i><span style="font-size:13px;color:${TX}">${esc(d.name)}${d.status==='deleting'?' (exclusão pendente)':''}</span></div></td><td style="padding:11px 12px;font-size:12px;color:${MU};white-space:nowrap">${fDt(d.uploaded_at)}</td><td style="padding:11px 12px;font-size:12px;color:${MU}">${fSz(d.size||0)}</td><td style="padding:11px 12px"><div style="display:flex;gap:7px"><button onclick="oV('${d.id}')" class="bg" style="padding:4px 10px;font-size:12px">Ver</button><button onclick="ddD('${d.id}')" class="bd" style="padding:4px 10px;font-size:12px">Excluir</button></div></td></tr>`}).join('')
    ct=`<div class="si"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px"><h2 style="font-family:${FD};font-weight:700;font-size:28px;color:${TX}">Documentos</h2><select onchange="A.fC=this.value;R()" style="width:auto;padding:7px 12px"><option value="all" ${A.fC==='all'?'selected':''}>Todos</option>${A.emps.map(e=>`<option value="${e.cpf}" ${A.fC===e.cpf?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div><div style="background:${S2};border:1px solid ${BR};border-radius:12px;overflow:hidden"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:1px solid ${BR};background:${S3}">${['Colaborador','Documento','Data','Tamanho','Ações'].map(h=>`<th style="font-size:11px;font-weight:600;color:${MU};text-align:left;padding:9px 12px;letter-spacing:1px;text-transform:uppercase">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>`
  }

  if(A.aT==='employees'){
    const eR=A.emps.map(e=>`<tr style="border-bottom:1px solid ${S4}" onmouseover="this.style.background='${S3}'" onmouseout="this.style.background='transparent'"><td style="padding:11px 16px"><div style="display:flex;align-items:center;gap:9px">${av(e.name,32)}<div><div style="font-size:13px;color:${TX};font-weight:500">${esc(e.name)}${e.active?'':' (inativo)'}</div><div style="font-size:12px;color:${MU}">${fC(e.cpf)}</div></div></div></td><td style="padding:11px 16px"><span style="background:${S4};color:${O};font-size:12px;padding:3px 9px;border-radius:20px;font-weight:600">${A.docs.filter(d=>d.user_cpf===e.cpf).length} doc${A.docs.filter(d=>d.user_cpf===e.cpf).length!==1?'s':''}</span></td><td style="padding:11px 16px"><div style="display:flex;gap:10px;align-items:center"><button onclick="A.fC='${e.cpf}';A.aT='docs';R()" style="background:transparent;color:${O};font-size:12px;font-weight:500">Ver docs →</button><button onclick="editEmp('${e.cpf}')" class="bg" style="padding:4px 10px;font-size:12px">Editar</button><button onclick="toggleEmp('${e.cpf}')" class="bg" style="padding:4px 10px;font-size:12px">${e.active?'Desativar':'Reativar'}</button><button onclick="mRst('${e.cpf}')" class="bg" style="padding:4px 10px;font-size:12px;display:flex;align-items:center;gap:3px"><i class="ti ti-key" style="font-size:12px"></i>Redefinir</button></div></td></tr>`).join('')
    ct=`<div class="si"><h2 style="font-family:${FD};font-weight:700;font-size:28px;color:${TX};margin-bottom:20px">Colaboradores</h2>
    <div style="background:${S2};border:1px solid ${BR};border-radius:12px;padding:20px;margin-bottom:22px">
      <h3 style="font-family:${FD};font-size:19px;color:${TX};margin-bottom:13px;display:flex;align-items:center;gap:7px"><i class="ti ti-user-plus" style="font-size:17px;color:${O}"></i>Adicionar Colaborador</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:11px;align-items:flex-end">
        <div><label class="fl">CPF</label><input id="nCP" placeholder="000.000.000-00" oninput="this.value=fC(this.value)"></div>
        <div><label class="fl">Nome</label><input id="nNm" placeholder="Nome completo"></div>
        <div><label class="fl">Senha inicial</label><input id="nPw" type="password" placeholder="Mínimo 8 caracteres"></div>
        <button id="addBtn" onclick="aEm()" class="bp" style="padding:10px 18px;white-space:nowrap"><i class="ti ti-plus" style="font-size:13px;vertical-align:-2px;margin-right:3px"></i>Adicionar</button>
      </div>
    </div>
    <div style="background:${S2};border:1px solid ${BR};border-radius:12px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:1px solid ${BR};background:${S3}">${['Colaborador','Docs',''].map(h=>`<th style="font-size:11px;font-weight:600;color:${MU};text-align:left;padding:9px 16px;letter-spacing:1px;text-transform:uppercase">${h}</th>`).join('')}</tr></thead><tbody>${eR||`<tr><td colspan="3" style="padding:32px;text-align:center;color:${MU}">Nenhum colaborador. Adicione o primeiro acima.</td></tr>`}</tbody></table>
    </div></div>`
  }

  if(A.aT==='upload'){
    const eO=A.emps.filter(e=>e.active).map(e=>`<option value="${e.cpf}">${esc(e.name)} — ${fC(e.cpf)}</option>`).join('')
    ct=`<div class="si" style="max-width:500px"><h2 style="font-family:${FD};font-weight:700;font-size:28px;color:${TX};margin-bottom:20px">Enviar Documento</h2>
    <div style="background:${S2};border:1px solid ${BR};border-radius:12px;padding:28px;display:flex;flex-direction:column;gap:17px">
      <div><label class="fl">Colaborador</label><select id="uE"><option value="">Selecione o colaborador</option>${eO}</select></div>
      <div><label class="fl">Nome do Documento</label><input id="uN" placeholder="Título opcional: usa nome do arquivo"></div>
      <div><label class="fl">Arquivo PDF</label>
        <label id="dA" style="display:block;background:${S3};border:2px dashed ${BR};border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:border-color .2s" onmouseover="this.style.borderColor='${O}'" onmouseout="this.style.borderColor='${BR}'">
          <input type="file" id="uF" accept=".pdf,application/pdf" style="display:none" multiple onchange="uDr(this)">
          <div id="dL"><i class="ti ti-cloud-upload" style="font-size:28px;color:${MU};display:block;margin-bottom:7px"></i><div style="font-size:13px;color:${MU}">Clique para selecionar um ou mais PDFs</div><div style="font-size:11px;color:#333;margin-top:3px">Até 50 MB por arquivo · mesmo destinatário para o lote</div></div>
        </label>
      </div>
      <button id="uB" onclick="upld()" class="bp" style="padding:13px;font-size:15px;width:100%"><i class="ti ti-send" style="font-size:14px;vertical-align:-2px;margin-right:5px"></i>Enviar Documento</button>
    </div></div>`
  }

  if(A.aT==='logs'){
    ct=`<h2 style="font-family:${FD};font-size:28px;margin-bottom:16px">Registros recentes</h2><p style="color:${MU};margin-bottom:12px">Últimos 200 eventos. Visualização e download registram a emissão do link, não a leitura efetiva.</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Documento</th></tr></thead><tbody>${(A.logs||[]).map(l=>`<tr><td style="padding:9px">${esc(new Date(l.created_at).toLocaleString('pt-BR'))}</td><td>${esc(l.actor_cpf)}</td><td>${esc(l.action)}</td><td>${esc(l.document_id||'—')}</td></tr>`).join('')||'<tr><td colspan="4">Nenhum registro disponível.</td></tr>'}</tbody></table></div>`
  }

  return `<div style="height:100vh;display:flex;flex-direction:column;background:${BK}">
    ${nv()}${loadWarning()}
    <div style="background:${S1};border-bottom:1px solid ${BR};display:flex;padding:0 40px">
      ${tabs.map(([id,lb,ic])=>`<button onclick="A.aT='${id}';R()" class="nt ${A.aT===id?'on':''}"><i class="ti ${ic}" style="font-size:14px"></i>${lb}</button>`).join('')}
    </div>
    <div style="flex:1;overflow:auto;padding:30px 40px"><div style="max-width:980px;margin:0 auto">${ct}</div></div>
  </div>`
}

// ════════════════════════════════════════════════
//  MODAL: Redefinir senha (admin)
// ════════════════════════════════════════════════
function mRst(cpf){
  const name=A.emps.find(e=>e.cpf===cpf)?.name||''
  document.getElementById('modal').innerHTML=`<div class="mo" onclick="if(event.target===this)cMo()">
    <div style="background:${S2};border:1px solid ${BR};border-radius:14px;padding:28px;width:100%;max-width:380px;animation:fU .25s ease">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><h3 style="font-family:${FD};font-size:21px;font-weight:700;color:${TX}">Redefinir Senha</h3><button onclick="cMo()" style="background:transparent;color:${MU};font-size:22px;line-height:1;padding:0 4px">×</button></div>
      <div style="display:flex;align-items:center;gap:9px;background:${S3};border-radius:8px;padding:11px;margin-bottom:16px">${av(name,34)}<div><div style="font-size:13px;color:${TX};font-weight:500">${esc(name)}</div><div style="font-size:12px;color:${MU}">${fC(cpf)}</div></div></div>
      <div style="display:flex;flex-direction:column;gap:13px">
        <div><label class="fl">Nova senha</label><input id="mp1" type="password" placeholder="Mínimo 8 caracteres"></div>
        <div><label class="fl">Confirmar</label><input id="mp2" type="password" onkeydown="if(event.key==='Enter')dRs('${cpf}')"></div>
        <div id="mE" style="font-size:13px;color:${DG};display:none"></div>
        <button id="mBtn" onclick="dRs('${cpf}')" class="bp" style="padding:11px;font-size:14px;width:100%"><i class="ti ti-key" style="font-size:13px;vertical-align:-2px;margin-right:4px"></i>Redefinir</button>
      </div>
    </div>
  </div>`
}

// ════════════════════════════════════════════════
//  OPERAÇÕES SUPABASE
// ════════════════════════════════════════════════

let busy = false;
function resetState() {
  A={v:'login',profile:null,docs:[],emps:[],logs:[],aT:'overview',fC:'all',sd:null,bUrl:null,loadError:null};
  cMo();
}
function loadWarning(){
  return A.loadError?`<div role="alert" style="padding:14px;background:#422;color:#fff">${esc(A.loadError)} <button class="bg" onclick="refreshData()" style="padding:6px">Tentar novamente</button></div>`:'';
}
async function profileFromServer(){
  const {data:userData,error:authError}=await sb.auth.getUser();
  if(authError||!userData.user)throw new Error('Sua sessão expirou. Entre novamente.');
  const {data,error}=await sb.from('doxis_profiles').select('id,cpf,name,role,active,must_change_password,session_not_before').eq('id',userData.user.id).single();
  if(error||!data?.active)throw new Error('Conta indisponível. Fale com o administrador.');
  const session=await sb.auth.getSession();
  let issuedAt=0;
  try{issuedAt=JSON.parse(atob(session.data.session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).iat||0}catch{}
  if(issuedAt<data.session_not_before)throw new Error('Entre novamente para renovar a sessão.');
  A.profile=data;
  return data;
}
async function edge(body){
  const {data,error}=await sb.functions.invoke('doxis-admin',{body});
  if(error){
    let message='Não foi possível concluir. Verifique a conexão e tente novamente.';
    try{message=(await error.context.json()).error||message}catch{}
    throw new Error(message);
  }
  if(data?.error)throw new Error(data.error);
  return data;
}
async function allRows(table,columns,configure){
  const rows=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await configure(sb.from(table).select(columns)).range(offset,offset+499);
    if(error)throw new Error('Não foi possível carregar os dados. Tente novamente.');
    rows.push(...data);
    if(data.length<500)return rows;
  }
}
async function loadMyDocs(){
  const docs=await allRows('doxis_documents','*',q=>q.eq('user_cpf',A.profile.cpf).eq('status','ready').order('uploaded_at',{ascending:false}).order('id'));
  A.docs=docs;A.loadError=null;
}
async function loadAdminData(){
  const [docs,emps,logs]=await Promise.all([
    allRows('doxis_documents','*',q=>q.order('uploaded_at',{ascending:false}).order('id')),
    allRows('doxis_profiles','id,cpf,name,role,active,created_at',q=>q.eq('role','employee').order('name').order('id')),
    sb.from('doxis_access_logs').select('id,actor_cpf,action,document_id,created_at').order('created_at',{ascending:false}).limit(200)
  ]);
  if(logs.error)throw new Error('Não foi possível carregar os registros. Tente novamente.');
  A.docs=docs;A.emps=emps;A.logs=logs.data;A.loadError=null;
}
async function refreshData(){
  A.loadError=null;
  try{
    await profileFromServer();
    if(A.profile.must_change_password){A.v='profile';return}
    if(A.profile.role==='admin')await loadAdminData();else await loadMyDocs();
  }catch(e){A.loadError=e.message}
  finally{R()}
}
async function dL(){
  if(busy)return;
  const cpf=rC(document.getElementById('lc')?.value||''),pw=document.getElementById('lp')?.value||'';
  const er=document.getElementById('le'),btn=document.getElementById('lbtn');
  er.style.display='none';
  if(!validCpf(cpf)||!pw){er.textContent='Informe um CPF válido e a senha.';er.style.display='block';return}
  busy=true;btn.disabled=true;btn.textContent='Verificando...';
  let authenticated=false;
  try{
    const {error}=await sb.auth.signInWithPassword({email:`${cpf}@cpf.doxis.invalid`,password:pw});
    if(error)throw new Error('CPF ou senha inválidos, ou limite de tentativas atingido.');
    await profileFromServer();authenticated=true;
    A.v=A.profile.must_change_password?'profile':A.profile.role==='admin'?'admin':'dashboard';
    // These events mean a session was accepted, not a proof of a new password login.
    await edge({action:'session-start'});
    if(!A.profile.must_change_password){
      if(A.profile.role==='admin')await loadAdminData();else await loadMyDocs();
    }
  }catch(e){
    if(authenticated)A.loadError=e.message;
    else{
      await sb.auth.signOut({scope:'local'});resetState();R();
      const message=document.getElementById('le');message.textContent=e.message;message.style.display='block';
    }
  }finally{busy=false;btn.disabled=false;btn.textContent='Entrar'}
  if(authenticated)R();
}
async function lo(){
  try{await edge({action:'session-end'})}catch{tos('Não foi possível registrar a saída.','wa')}
  const {error}=await sb.auth.signOut();
  if(error){tos('Não foi possível revogar a sessão no servidor. Tente sair novamente.','err');return}
  resetState();R();
}
function checkedUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.origin!==new URL(SUPABASE_URL).origin)throw new Error('Link de documento inválido.');
  return url.href;
}
async function oV(id){
  const doc=A.docs.find(d=>d.id===id);if(!doc||doc.status!=='ready')return;
  try{
    const data=await edge({action:'view',document_id:id});
    A.bUrl=checkedUrl(data.url);A.sd=doc;A.v='viewer';R();
  }catch(e){tos(e.message,'err')}
}
async function dlD(id){
  const doc=A.docs.find(d=>d.id===id);if(!doc||doc.status!=='ready')return;
  try{
    const data=await edge({action:'download',document_id:id});
    // Storage's download parameter supplies Content-Disposition across origins.
    const a=document.createElement('a');a.href=checkedUrl(data.url);a.rel='noopener';a.target='_blank';a.click();
  }catch(e){tos(e.message,'err')}
}
async function ddD(id){
  if(busy||!confirm('Excluir este documento permanentemente? Esta ação não pode ser desfeita.'))return;
  busy=true;
  try{await edge({action:'delete',document_id:id});await loadAdminData();tos('Documento excluído.');R()}
  catch(e){tos(e.message,'err');await refreshData()}
  finally{busy=false}
}
function uDr(inp){
  const el=document.getElementById('dL');el.replaceChildren();
  const label=document.createElement('div');label.textContent=Array.from(inp.files).map(f=>`${f.name} (${fSz(f.size)})`).join(' · ')||'Clique para selecionar PDFs';
  el.append(label);
}
async function upld(){
  if(busy)return;
  const emp=document.getElementById('uE')?.value,nm=document.getElementById('uN')?.value?.trim();
  const files=Array.from(document.getElementById('uF')?.files||[]);
  if(!emp||!files.length){tos('Selecione colaborador e arquivo.','err');return}
  try{for(const file of files)await validatePdf(file)}catch(e){tos(e.message,'err');return}
  const btn=document.getElementById('uB');busy=true;btn.disabled=true;
  const failed=[];let sent=0;
  try{
    for(let i=0;i<files.length;i++){
      btn.textContent=`Enviando ${i+1}/${files.length}...`;
      const file=files[i],body=new FormData();
      body.append('action','upload');body.append('cpf',emp);
      body.append('name',files.length===1?(nm||file.name.replace(/\.pdf$/i,'')):(nm?`${nm} — ${file.name.replace(/\.pdf$/i,'')}`:file.name.replace(/\.pdf$/i,'')));
      body.append('file',file);
      try{await edge(body);sent++}catch(e){failed.push({file,error:e.message})}
    }
    // Leave only failed files selected, preventing accidental duplicate retries.
    const transfer=new DataTransfer();failed.forEach(x=>transfer.items.add(x.file));
    document.getElementById('uF').files=transfer.files;uDr(document.getElementById('uF'));
    const result=document.createElement('div');result.setAttribute('role','status');result.style.whiteSpace='pre-wrap';
    result.textContent=`${sent} enviado(s), ${failed.length} falha(s).`+failed.map(x=>`\n${x.file.name}: ${x.error}`).join('');
    document.getElementById('uploadResult')?.remove();result.id='uploadResult';btn.before(result);
    try{await loadAdminData()}catch(e){tos(e.message,'wa')}
  }finally{busy=false;btn.disabled=false;btn.textContent='Enviar Documento'}
}
async function aEm(){
  if(busy)return;
  const cpf=rC(document.getElementById('nCP')?.value||''),name=document.getElementById('nNm')?.value?.trim(),password=document.getElementById('nPw')?.value;
  if(!validCpf(cpf)||!name||name.length>120||!password||password.length<8){tos('Informe CPF válido, nome (até 120 caracteres) e senha de no mínimo 8 caracteres.','err');return}
  const btn=document.getElementById('addBtn');busy=true;btn.disabled=true;
  try{await edge({action:'create-employee',cpf,name,password});await loadAdminData();tos('Colaborador cadastrado. A senha deverá ser alterada no primeiro acesso.');R()}
  catch(e){tos(e.message,'err')}
  finally{busy=false;btn.disabled=false}
}
async function chP(){
  if(busy)return;
  const current_password=document.getElementById('pc')?.value,n1=document.getElementById('p1')?.value,n2=document.getElementById('p2')?.value;
  const er=document.getElementById('pEr'),btn=document.getElementById('chpBtn');er.style.display='none';
  if(!current_password||!n1||n1.length<8||n1!==n2){er.textContent='Informe a senha atual e confirme a nova senha com no mínimo 8 caracteres.';er.style.display='block';return}
  busy=true;btn.disabled=true;
  try{
    await edge({action:'change-password',current_password,password:n1});
    await sb.auth.signOut({scope:'local'});resetState();R();tos('Senha alterada. Entre novamente.');
  }catch(e){er.textContent=e.message;er.style.display='block'}
  finally{busy=false;btn.disabled=false}
}
async function dRs(cpf){
  if(busy)return;
  const password=document.getElementById('mp1')?.value,p2=document.getElementById('mp2')?.value,er=document.getElementById('mE'),btn=document.getElementById('mBtn');
  if(!password||password.length<8||password!==p2){er.textContent='Confirme a senha com no mínimo 8 caracteres.';er.style.display='block';return}
  busy=true;btn.disabled=true;
  try{await edge({action:'reset-password',cpf,password});cMo();tos('Senha redefinida. Troca obrigatória no próximo acesso.')}
  catch(e){er.textContent=e.message;er.style.display='block'}
  finally{busy=false;btn.disabled=false}
}
async function editEmp(cpf){
  if(busy)return;
  const emp=A.emps.find(e=>e.cpf===cpf),name=prompt('Nome completo:',emp?.name||'')?.trim();
  if(!name)return;
  busy=true;
  try{await edge({action:'edit-employee',cpf,name});await loadAdminData();R();tos('Nome atualizado.')}
  catch(e){tos(e.message,'err')}finally{busy=false}
}
async function toggleEmp(cpf){
  if(busy)return;
  const emp=A.emps.find(e=>e.cpf===cpf);if(!emp||!confirm(`${emp.active?'Desativar':'Reativar'} este colaborador?`))return;
  busy=true;
  try{await edge({action:'set-active',cpf,active:!emp.active});await loadAdminData();R();tos('Acesso atualizado.')}
  catch(e){tos(e.message,'err')}finally{busy=false}
}

// ════════════════════════════════════════════════
//  RENDER + INIT
// ════════════════════════════════════════════════
function R(){
  if(A.profile?.must_change_password)A.v='profile'
  const app=document.getElementById('app')
  if(A.profile&&A.loadError){
    app.innerHTML=`<div style="min-height:100vh">${nv()}${loadWarning()}</div>`;
    return;
  }
  if(A.v==='loading')app.innerHTML=vLoad()
  else if(A.v==='login')app.innerHTML=vLg()
  else if(A.v==='dashboard')app.innerHTML=vDs()
  else if(A.v==='viewer')app.innerHTML=vVw()
  else if(A.v==='profile')app.innerHTML=vPf()
  else if(A.v==='admin')app.innerHTML=vAd()
}

async function init(){
  localStorage.removeItem('doxis_s'); // Legacy profile objects never authenticate v3.
  R();
  sb.auth.onAuthStateChange((event)=>{
    if(event==='SIGNED_OUT'){resetState();R()}
  });
  try{
    const {data,error}=await sb.auth.getSession();
    if(error)throw error;
    if(!data.session){resetState();R();return}
    await profileFromServer();
    A.v=A.profile.must_change_password?'profile':A.profile.role==='admin'?'admin':'dashboard';
    if(!A.profile.must_change_password){
      try{if(A.profile.role==='admin')await loadAdminData();else await loadMyDocs()}
      catch(e){A.loadError=e.message}
    }
  }catch(e){await sb.auth.signOut({scope:'local'});resetState();tos('Sessão indisponível. Entre novamente.','err')}
  R();
}
init();
