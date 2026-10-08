
import {Chess} from 'https://esm.sh/chess.js@1.0.0';

const URL='https://qmjkuwbolyfeomjjedup.supabase.co';
const KEY='sb_publishable_e7eqhJj544LpOQ1YnnhCVg_Vmnm0wy4';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let auth=JSON.parse(localStorage.getItem('ct_auth')||'null');
let data=JSON.parse(localStorage.getItem('ct_data')||'{"sessions":[],"folders":[]}');
let base=localStorage.getItem('ct_base')||null;
let dirty=localStorage.getItem('ct_dirty')==='true';

let mode='home', index=-1, edit=null, ply=0, board=new Chess(), selected=null, arrowMode=false, arrowStart=null, hintSq=null, quiz=null, showOpponentArrows=false;

const pieces={p:'♟',r:'♜',n:'♞',b:'♝',q:'♛',k:'♚',P:'♙',R:'♖',N:'♘',B:'♗',Q:'♕',K:'♔'};

function note(s,err=false){
  $('status').textContent=s;
  $('syncmsg').textContent=s;
  $('syncmsg').className=err?'error':'muted';
}

function persist(){
  localStorage.setItem('ct_data',JSON.stringify(data));
  localStorage.setItem('ct_dirty',String(dirty));
  if(base)localStorage.setItem('ct_base',base);
}

function changed(){
  dirty=true;
  persist();
  note('Modifications locales à envoyer');
}

async function api(path,method='GET',body=null,token=auth?.access_token){
  let h={'apikey':KEY,'Content-Type':'application/json'};
  if(token)h.Authorization='Bearer '+token;
  let r=await fetch(URL+path,{
    method,
    headers:h,
    body:body?JSON.stringify(body):undefined
  });
  let t=await r.text(),v=t?JSON.parse(t):null;
  if(!r.ok)throw Error(v?.msg||v?.message||t||'HTTP '+r.status);
  return v;
}

async function refreshToken(){
  if(!auth)throw Error('Connecte-toi');
  if(Date.now()<auth.expires_at-60000)return;
  let a=await api('/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:auth.refresh_token},null);
  auth={...a,expires_at:Date.now()+a.expires_in*1000};
  localStorage.setItem('ct_auth',JSON.stringify(auth));
}

async function remote(){
  await refreshToken();
  let rows=await api('/rest/v1/chess_data?select=sessions,folders,updated_at&user_id=eq.'+encodeURIComponent(auth.user.id));
  return rows[0]||null;
}

function signature(row){
  return row?JSON.stringify({sessions:row.sessions||[],folders:row.folders||[]}):null;
}

async function pull(force=false){
  try{
    let row=await remote();
    if(!row){
      note('Aucune donnée cloud');
      return;
    }
    let sig=signature(row);
    if(dirty&&!force){
      note('Modifications locales non envoyées : réception bloquée',true);
      return;
    }
    data={sessions:row.sessions||[],folders:row.folders||[]};
    base=sig;
    dirty=false;
    persist();
    note('Données reçues du cloud ✓');
    renderHome();
  }catch(e){
    note('Réception : '+e.message,true);
  }
}

async function push(){
  try{
    let row=await remote(),sig=signature(row);
    if(sig!==base){
      note('Le cloud a changé : envoi bloqué. Recharge les données ou conserve une copie locale.',true);
      return;
    }
    let payload={
      user_id:auth.user.id,
      sessions:data.sessions,
      folders:data.folders,
      updated_at:new Date().toISOString()
    };
    await api(
      row?'/rest/v1/chess_data?user_id=eq.'+encodeURIComponent(auth.user.id):'/rest/v1/chess_data',
      row?'PATCH':'POST',
      row?{sessions:payload.sessions,folders:payload.folders,updated_at:payload.updated_at}:payload
    );
    base=signature(payload);
    dirty=false;
    persist();
    note('Synchronisé avec Supabase ✓');
  }catch(e){
    note('Envoi : '+e.message,true);
  }
}

async function login(){
  try{
    let a=await api('/auth/v1/token?grant_type=password','POST',{
      email:$('email').value.trim(),
      password:$('password').value
    },null);
    auth={...a,expires_at:Date.now()+a.expires_in*1000};
    localStorage.setItem('ct_auth',JSON.stringify(auth));
    $('password').value='';
    logged();
    await pull();
  }catch(e){
    $('loginmsg').textContent=e.message;
  }
}

function logged(){
  $('login').classList.toggle('hidden',!!auth);
  $('app').classList.toggle('hidden',!auth);
  if(auth){
    note(dirty?'Modifications locales à envoyer':'Connecté');
    renderHome();
  }
}

function sections(name){
  for(let id of ['home','detail','quizsetup'])
    $(id).classList.toggle('hidden',id!==name);
}

function renderHome(){
  mode='home';
  sections('home');
  let groups=new Map();
  for(let f of data.folders)groups.set(f,[]);
  groups.set('',[]);
  data.sessions.forEach((s,i)=>{
    let f=s.folder||'';
    if(!groups.has(f))groups.set(f,[]);
    groups.get(f).push([s,i]);
  });
  let out='';
  for(let [folder,ss] of [...groups].sort((a,b)=>a[0].localeCompare(b[0],'fr'))){
    out+=`<details class="folder"><summary>📁 ${esc(folder||'Sans dossier')} (${ss.length})</summary>`;
    for(let [s,i] of ss.sort((a,b)=>String(a[0].name).localeCompare(String(b[0].name),'fr')))
      out+=`<div class="item"><div><b>${esc(s.name)}</b><div class="muted">${s.side==='black'?'Noirs':'Blancs'} · ${(s.moves||[]).length} coups</div></div><div><button data-view="${i}">Voir</button> <button data-edit="${i}">✎</button> <button data-delete="${i}">×</button></div></div>`;
    out+='</details>';
  }
  $('listing').innerHTML=out;
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>openView(+b.dataset.view));
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEdit(+b.dataset.edit));
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
    let i=+b.dataset.delete;
    if(confirm('Supprimer '+data.sessions[i].name+' ?')){
      data.sessions.splice(i,1);
      changed();
      renderHome();
    }
  });
}

function current(){
  return mode==='edit'?edit:mode==='quiz'?quiz?.session:data.sessions[index];
}

function loadBoard(){
  board=new Chess();
  let moves=current()?.moves||[];
  let n=mode==='quiz'?quiz.ply:ply;
  for(let i=0;i<n;i++){
    try{board.move(moves[i])}catch(e){break}
  }
  selected=null;
  renderBoard();
}

function getAnnotations(){
  let s=current();
  let idx=(mode==='quiz'?quiz.ply:ply)-1;
  if(idx<0)return[];
  if(mode==='quiz'){
    if(quiz.wait)return s.annotations?.[String(idx)]||[];
    return showOpponentArrows?quiz.opponentArrows:[];
  }
  return s.annotations?.[String(idx)]||[];
}

function renderBoard(){
  let side=mode==='quiz'?quiz.side:current()?.side||'white',flipped=side==='black';
  let html='';
  for(let row=0;row<8;row++)for(let col=0;col<8;col++){
    let file=flipped?7-col:col,rank=flipped?row:7-row,sq='abcdefgh'[file]+(rank+1);
    let p=board.get(sq),piece=p?pieces[p.color==='w'?p.type.toUpperCase():p.type]:'';
    html+=`<div class="sq ${(row+col)%2?'dark':'light'} ${selected===sq?'selected':''} ${hintSq===sq?'hint':''}" data-sq="${sq}">${piece}${col===7?`<small>${rank+1}</small>`:''}</div>`;
  }
  $('board').innerHTML=html;
  document.querySelectorAll('[data-sq]').forEach(e=>e.onclick=()=>tap(e.dataset.sq));
  let arrows=getAnnotations(),svg='';
  for(let a of arrows){
    if(a.type==='square'){
      let [x,y]=center(a.square,flipped);
      svg+=`<rect x="${x-45}" y="${y-45}" width="90" height="90" fill="none" stroke="#228858" stroke-width="10"/>`;
    }else if(a.type==='arrow'){
      let [x,y]=center(a.from,flipped),[u,v]=center(a.to,flipped);
      svg+=`<line x1="${x}" y1="${y}" x2="${u}" y2="${v}" stroke="#228858" stroke-width="15" marker-end="url(#head)" opacity=".85"/>`;
    }
  }
  $('arrowsg').innerHTML=svg;
  renderMeta();
}

function center(s,flip){
  if(!s||s.length!==2)return[0,0];
  let f=s.charCodeAt(0)-97,r=+s[1]-1;
  return[(flip?7-f:f)*100+50,(flip?r:7-r)*100+50];
}

function tap(sq){
  if(mode==='view')return;
  if(mode==='edit'&&arrowMode){
    if(!arrowStart){
      arrowStart=sq;
      selected=sq;
      renderBoard();
      return;
    }
    let i=ply-1;
    if(i>=0){
      edit.annotations??={};
      let a=edit.annotations[String(i)]||[],v=arrowStart===sq?{type:'square',square:sq}:{type:'arrow',from:arrowStart,to:sq};
      let j=a.findIndex(x=>JSON.stringify(x)===JSON.stringify(v));
      if(j>=0)a.splice(j,1);
      else a.push(v);
      edit.annotations[String(i)]=a;
    }
    arrowStart=null;
    selected=null;
    renderBoard();
    return;
  }
  if(mode==='quiz'&&quiz.wait)return;
  if(!selected){
    if(board.get(sq)?.color===board.turn()){
      selected=sq;
      renderBoard();
    }
    return;
  }
  let from=selected;
  selected=null;
  let move;
  try{move=board.move({from,to:sq,promotion:'q'})}catch(e){}
  if(!move){
    renderBoard();
    return;
  }
  if(mode==='edit'){
    if(ply!==edit.moves.length){
      board.undo();
      note('Va au dernier coup pour ajouter un coup',true);
      renderBoard();
      return;
    }
    edit.moves.push(move.from+move.to+(move.promotion||''));
    ply++;
    renderBoard();
  }else if(mode==='quiz'){
    let expected=quiz.session.moves[quiz.ply];
    let actual=move.from+move.to+(move.promotion||'');
    if(actual!==expected){
      board.undo();
      quiz.errors++;
      $('feedback').textContent='❌ Ce n’est pas le coup enregistré';
      renderBoard();
      return;
    }
    quiz.correct++;
    let idx=quiz.ply;
    quiz.ply++;
    quiz.session.progress??={};
    let p=quiz.session.progress[String(idx)]||{correct:0,wrong:0};
    p.correct++;
    quiz.session.progress[String(idx)]=p;
    changed();
    let comment=quiz.session.comments?.[String(idx)]||'';
    let anns=quiz.session.annotations?.[String(idx)]||[];
    if(comment||anns.length){
      quiz.wait=true;
      $('feedback').textContent='✅ Bon coup ! '+comment;
      $('continue').disabled=false;
      renderBoard();
    }else{
      nextQuiz();
    }
  }
}

function renderMeta(){
  let s=current();
  if(!s)return;
  $('detailtitle').textContent=s.name||'Nouvelle séquence';
  $('positionmsg').textContent=mode==='quiz'?`Séquence ${quiz.queuePos+1}/${quiz.queue.length} · Coup ${quiz.ply+1}/${s.moves.length}`:`Position ${ply}/${s.moves.length}`;
  $('comment').textContent=mode==='quiz'?'':(s.comments?.[String(ply-1)]||s.global_comment||'');
  let b=new Chess(),html='';
  for(let i=0;i<s.moves.length;i++){
    let san=s.moves[i];
    try{san=b.move(san).san}catch(e){}
    html+=`<button data-ply="${i+1}" ${mode==='quiz'?'disabled':''}>${i%2===0?Math.floor(i/2)+1+'.':'…'}${esc(san)}</button>`;
  }
  $('moves').innerHTML=html;
  document.querySelectorAll('[data-ply]').forEach(x=>x.onclick=()=>{
    ply=+x.dataset.ply;
    loadBoard();
    if(mode==='edit')fillEditFields();
  });
  $('viewcontrols').classList.toggle('hidden',mode==='quiz');
  $('quizcontrols').classList.toggle('hidden',mode!=='quiz');
  $('editcontrols').classList.toggle('hidden',mode!=='edit');
  if(mode==='edit')fillEditFields();
}

function openView(i){
  index=i;
  mode='view';
  ply=0;
  hintSq=null;
  sections('detail');
  $('feedback').textContent='';
  loadBoard();
}

function openEdit(i=-1){
  index=i;
  mode='edit';
  edit=i<0?{name:'',side:'white',moves:[],comments:{},annotations:{},progress:{},folder:'',global_comment:''}:structuredClone(data.sessions[i]);
  ply=edit.moves.length;
  arrowMode=false;
  arrowStart=null;
  sections('detail');
  $('feedback').textContent='';
  $('sessionfolder').innerHTML='<option value="">Sans dossier</option>'+data.folders.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');
  $('sessionname').value=edit.name;
  $('sessionside').value=edit.side;
  $('sessionfolder').value=edit.folder||'';
  $('globalcomment').value=edit.global_comment||'';
  loadBoard();
}

function fillEditFields(){
  if(mode==='edit'){
    $('movecomment').value=edit.comments?.[String(ply-1)]||'';
    $('arrowmode').textContent='↗ Mode flèche : '+(arrowMode?'ON':'OFF');
  }
}

function captureEdit(){
  if(mode!=='edit')return;
  edit.name=$('sessionname').value.trim();
  edit.side=$('sessionside').value;
  edit.folder=$('sessionfolder').value;
  edit.global_comment=$('globalcomment').value;
  edit.comments??={};
  if(ply>0){
    let t=$('movecomment').value.trim();
    if(t)edit.comments[String(ply-1)]=t;
    else delete edit.comments[String(ply-1)];
  }
}

function quizSetup(){
  mode='setup';
  sections('quizsetup');
  $('quizfolder').innerHTML='<option value="*">Tous les dossiers</option><option value="">Sans dossier</option>'+data.folders.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');
  quizChoices();
}

function quizChoices(){
  let f=$('quizfolder').value,side=$('quizside').value;
  $('quizsessions').innerHTML=data.sessions.map((s,i)=>{
    if(f!=='*'&&(s.folder||'')!==f)return'';
    if(!s.moves?.some((_,j)=>(j%2===0?'white':'black')===side))return'';
    return`<label><input type="checkbox" class="qcheck" value="${i}" checked style="width:auto"> ${esc(s.name)}</label>`;
  }).join('')||'<p>Aucune séquence compatible</p>';
}

function startQuiz(){
  let ids=[...document.querySelectorAll('.qcheck:checked')].map(x=>+x.value);
  if(!ids.length)return alert('Sélectionne au moins une séquence');
  quiz={queue:ids,queuePos:0,side:$('quizside').value,correct:0,errors:0};
  mode='quiz';
  sections('detail');
  loadQuizSession();
}

function loadQuizSession(){
  if(quiz.queuePos>=quiz.queue.length){
    $('feedback').textContent=`Terminé : ${quiz.correct} bons coups, ${quiz.errors} erreurs`;
    mode='view';
    openView(quiz.queue[quiz.queue.length-1]);
    $('feedback').textContent=`Quiz terminé : ${quiz.correct} bons coups, ${quiz.errors} erreurs`;
    return;
  }
  quiz.session=data.sessions[quiz.queue[quiz.queuePos]];
  quiz.ply=0;
  quiz.wait=false;
  quiz.opponentArrows=[];
  showOpponentArrows=false;
  hintSq=null;
  nextQuiz();
}

function nextQuiz(){
  quiz.wait=false;
  $('continue').disabled=true;
  hintSq=null;
  showOpponentArrows=false;
  quiz.opponentArrows=[];
  while(quiz.ply<quiz.session.moves.length&&(quiz.ply%2===0?'white':'black')!==quiz.side){
    quiz.opponentArrows=quiz.session.annotations?.[String(quiz.ply)]||[];
    quiz.ply++;
  }
  if(quiz.ply>=quiz.session.moves.length){
    quiz.queuePos++;
    loadQuizSession();
    return;
  }
  $('feedback').textContent='À toi de trouver le coup enregistré';
  loadBoard();
}

$('signin').onclick=login;
$('logoutbtn').onclick=()=>{
  auth=null;
  localStorage.removeItem('ct_auth');
  logged();
};
$('homebtn').onclick=renderHome;
$('backbtn').onclick=renderHome;
$('newbtn').onclick=()=>openEdit();
$('quizbtn').onclick=quizSetup;
$('quizfolder').onchange=quizChoices;
$('quizside').onchange=quizChoices;
$('startquiz').onclick=startQuiz;
$('folderbtn').onclick=()=>{
  let f=prompt('Nom du dossier');
  if(f?.trim()&&!data.folders.includes(f.trim())){
    data.folders.push(f.trim());
    changed();
    renderHome();
  }
};

$('save').onclick=async()=>{
  captureEdit();
  if(!edit.name||!edit.moves.length)return alert('Ajoute un nom et au moins un coup');
  if(index<0)data.sessions.push(edit);
  else data.sessions[index]=edit;
  changed();
  renderHome();
  await push();
};
$('cancel').onclick=renderHome;
$('arrowmode').onclick=()=>{
  captureEdit();
  arrowMode=!arrowMode;
  fillEditFields();
};
$('undo').onclick=()=>{
  if(edit.moves.length){
    captureEdit();
    edit.moves.pop();
    delete edit.comments?.[String(edit.moves.length)];
    delete edit.annotations?.[String(edit.moves.length)];
    ply=edit.moves.length;
    loadBoard();
  }
};

$('first').onclick=()=>{ply=0;loadBoard()};
$('prev').onclick=()=>{ply=Math.max(0,ply-1);loadBoard()};
$('next').onclick=()=>{ply=Math.min(current().moves.length,ply+1);loadBoard()};
$('last').onclick=()=>{ply=current().moves.length;loadBoard()};
$('hint').onclick=()=>{hintSq=quiz.session.moves[quiz.ply]?.slice(0,2);renderBoard()};
$('opparrows').onclick=()=>{showOpponentArrows=!showOpponentArrows;renderBoard()};
$('continue').onclick=()=>{if(quiz?.wait)nextQuiz()};
$('syncbtn').onclick=()=>dirty?push():pull();
$('refresh').onclick=()=>pull();
$('push').onclick=push;

$('movecomment').onchange=()=>captureEdit();
$('sessionname').onchange=()=>captureEdit();
$('sessionside').onchange=()=>{captureEdit();renderBoard()};
$('sessionfolder').onchange=()=>captureEdit();
$('globalcomment').onchange=()=>captureEdit();

logged();
if(auth)pull();

/* Synchronisation automatique ChessTrainer Mobile */

let autoSyncBusy=false;

async function autoSync(){
  if(!auth||autoSyncBusy||document.hidden)return;

  // Ne pas interrompre une edition ou un quiz.
  if(mode!=='home')return;

  autoSyncBusy=true;

  try{
    const row=await remote();
    const cloudSignature=signature(row);

    if(dirty){
      // Conserver les changements locaux.
      if(cloudSignature!==base){
        note('Conflit de synchronisation : modifications sur deux appareils',true);
        return;
      }

      // Envoyer uniquement si le cloud n'a pas change.
      await push();
      return;
    }

    if(cloudSignature!==base){
      // Recuperer la derniere version du cloud.
      if(row){
        await pull();
      }else{
        note('Aucune donnee dans le cloud');
      }
    }
  }catch(e){
    note('Synchronisation automatique : '+e.message,true);
  }finally{
    autoSyncBusy=false;
  }
}

// Verification toutes les 20 secondes.
setInterval(autoSync,20000);

// Verification au retour dans l'application.
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)autoSync();
});

// Verification quand Internet revient.
window.addEventListener('online',autoSync);

// Verification au lancement.
if(auth)autoSync();
