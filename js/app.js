import {PROTOCOL_VERSION,CONDITION_ORDER,STATUS_NAMES,TRIAL_MS,REVEAL_MS,seedFor,createSchedule,createTrials,retryTrials,summarizeTrials,toCSV} from './protocol.js';
import {parseMeasureWizCSV,mergeEEG,extractBandFeature} from './eeg.js';
import {groupedCrossValidation,recommendFromPast} from './model.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const STORAGE_KEY='yurip-workload-session-v1',LOCK_KEY='yurip-workload-active-lock-v1';
const SCHEMA='yurip-workload-session-v1';
const tabId=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
const qaRequested=new URLSearchParams(location.search).get('qa')==='1';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const iso=()=>new Date().toISOString();
const round=n=>Number.isFinite(n)?Math.round(n*1000)/1000:null;
let session=null,activeTimer=null,paintFrame=null,heartbeat=null,activeTrial=null,revealTimer=null;
let analysisSession=null,eegFiles=[],merged=null,features={},mappingLog=[],cvResult=null,recommendation=null;

function toast(message){const el=$('#toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add('hidden'),4200);}
function persist(){
  if(!session)return;
  session.updated_at=iso();
  try {localStorage.setItem(STORAGE_KEY,JSON.stringify(session));}
  catch(error){toast('브라우저 저장에 실패했습니다. 현재 기록을 바로 내려받아 주세요.');console.error(error);}
}
function event(type,details={}) {
  if(!session)return;
  session.events.push({type,at:iso(),epoch_ms:Date.now(),performance_ms:round(performance.now()),time_origin_ms:round(performance.timeOrigin),...details});
}
function lockInfo(){try{return JSON.parse(localStorage.getItem(LOCK_KEY)||'null');}catch{return null;}}
function acquireLock(){
  const lock=lockInfo();
  if(lock&&lock.owner!==tabId&&lock.expires>Date.now())return false;
  localStorage.setItem(LOCK_KEY,JSON.stringify({owner:tabId,expires:Date.now()+10000}));
  if(lockInfo()?.owner!==tabId)return false;
  clearInterval(heartbeat);
  heartbeat=setInterval(()=>{
    const current=lockInfo();
    if(current?.owner!==tabId){clearInterval(heartbeat);if(session?.stage==='running')interrupt('다른 탭에서 실행이 감지됨');return;}
    localStorage.setItem(LOCK_KEY,JSON.stringify({owner:tabId,expires:Date.now()+10000}));
  },2500);
  return true;
}
function releaseLock(){clearInterval(heartbeat);heartbeat=null;if(lockInfo()?.owner===tabId)localStorage.removeItem(LOCK_KEY);}
function formatCondition(plan){return plan?.label||CONDITION_ORDER.find(c=>c.id===plan?.condition)?.label||'확인 필요';}
function sessionValid(data){return data&&data.schema===SCHEMA&&Array.isArray(data.schedule)&&Array.isArray(data.blocks)&&Array.isArray(data.events)&&typeof data.participant_id==='string';}
function loadSaved(){try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');return sessionValid(value)?value:null;}catch{return null;}}
function download(filename,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function prefix(s){return `${s.participant_id}_${s.session_id}_${s.mode}`.replace(/[^A-Za-z0-9_-]/g,'_');}
function downloadJSON(s=session){if(s)download(`${prefix(s)}_session.json`,JSON.stringify(s,null,2),'application/json;charset=utf-8');}
function downloadTables(s=session){
  if(!s)return;
  const trialCols=['participant_id','session_id','mode','protocol_version','block_index','attempt','round','condition','difficulty','layout','block_status','flags','trial_number','kind','cycle','a','b','shown','target','states','truth','response','correct','rt_ms','onset_iso','onset_epoch_ms','onset_performance_ms','elapsed_start_ms','elapsed_end_ms','reveal_count','reveals'];
  const trials=s.blocks.flatMap(b=>(b.trials||[]).map((t,i)=>({participant_id:s.participant_id,session_id:s.session_id,mode:s.mode,protocol_version:s.protocol_version,block_index:b.index,attempt:b.attempt,round:b.round,condition:b.condition,difficulty:b.difficulty,layout:b.layout,block_status:b.status,flags:b.flags,trial_number:i+1,...t,reveal_count:t.reveals?.length||0})));
  const blockCols=['participant_id','session_id','mode','protocol_version','index','attempt','round','condition','difficulty','layout','status','flags','started_at','finished_at','rating','math_accuracy','math_median_correct_rt_ms','math_unanswered','status_accuracy','status_median_correct_rt_ms','status_unanswered','reveal_count','trigger_start_ack_at','trigger_end_ack_at'];
  const blocks=s.blocks.map(b=>({participant_id:s.participant_id,session_id:s.session_id,mode:s.mode,protocol_version:s.protocol_version,...b,math_accuracy:b.summary?.math?.accuracy,math_median_correct_rt_ms:b.summary?.math?.median_correct_rt_ms,math_unanswered:b.summary?.math?.unanswered,status_accuracy:b.summary?.status?.accuracy,status_median_correct_rt_ms:b.summary?.status?.median_correct_rt_ms,status_unanswered:b.summary?.status?.unanswered,reveal_count:b.summary?.reveal_count}));
  const eventCols=['participant_id','session_id','mode','type','at','epoch_ms','performance_ms','time_origin_ms','block_index','attempt','details'];
  const events=s.events.map(e=>({participant_id:s.participant_id,session_id:s.session_id,mode:s.mode,...e,details:e.details||''}));
  download(`${prefix(s)}_trials.csv`,toCSV(trialCols,trials),'text/csv;charset=utf-8');
  setTimeout(()=>download(`${prefix(s)}_blocks.csv`,toCSV(blockCols,blocks),'text/csv;charset=utf-8'),180);
  setTimeout(()=>download(`${prefix(s)}_markers.csv`,toCSV(eventCols,events),'text/csv;charset=utf-8'),360);
  toast('브라우저에서 파일 여러 개의 다운로드를 허용해 주세요.');
}
function setView(name){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $('#crumb').textContent={home:'실험 준비',analysis:'데이터 분석',guide:'진행 안내'}[name];
  $('#app').classList.remove('hidden');$('#runner').classList.add('hidden');
  if(name==='home')renderSaved();window.scrollTo(0,0);
}
$$('.nav-item').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));

function renderSaved(){
  const el=$('#saved-session');session=loadSaved()||session;
  if(!session){el.classList.add('hidden');return;}
  const finished=session.next_plan_index>=session.schedule.length;
  const type={MAIN:'본실험',PILOT:'파일럿',QA:'자동 검사용',ADAPTIVE_DEMO:'선택 시연'}[session.mode]||session.mode;
  el.classList.remove('hidden');el.innerHTML=`<div class="card-title"><div><h3>${finished?'저장된 세션':'진행 중인 세션'}</h3><p>${esc(session.participant_id)} · ${esc(session.session_id)} · ${esc(type)}</p></div><span class="round-icon">↗</span></div><p>완료 ${session.next_plan_index} / ${session.schedule.length} 블록. 익명 기록은 이 브라우저에 보관됩니다.</p><div class="button-row"><button class="button primary" id="resume-session" type="button">${finished?'결과 확인':'이어서 진행'} →</button><button class="button secondary" id="save-partial" type="button">JSON 저장 ↓</button></div>`;
  $('#resume-session').addEventListener('click',()=>{session=loadSaved()||session;openRunner();});
  $('#save-partial').addEventListener('click',()=>downloadJSON(session));
}

$('#setup-form').addEventListener('submit',e=>{
  e.preventDefault();const participant=$('#participant').value.trim(),sessionCode=$('#session-code').value.trim();
  if(!/^[A-Za-z0-9_-]{1,24}$/.test(participant)||!/^[A-Za-z0-9_-]{1,24}$/.test(sessionCode)){$('#setup-error').textContent='참가자와 세션 코드는 영문, 숫자, _ 또는 -만 사용해 주세요.';return;}
  const existing=loadSaved();
  if(existing&&!confirm('이 브라우저의 기존 세션이 교체됩니다. 필요한 경우 먼저 기존 JSON을 저장했나요?'))return;
  if(existing)releaseLock();
  const mode=qaRequested?'QA':$('#mode').value;
  const seed=seedFor(`${participant}:${sessionCode}:${Date.now()}`);
  session={schema:SCHEMA,protocol_version:PROTOCOL_VERSION,participant_id:participant,session_id:sessionCode,mode,seed,
    created_at:iso(),updated_at:iso(),stage:'between',next_plan_index:0,schedule:createSchedule(seed,mode),blocks:[],events:[],active_block:null};
  event('SESSION_CREATED',{details:qaRequested?'QA 자료: 연구 사용 금지':'실제 상태는 파일럿에서 확인'});persist();openRunner();
});

function runnerShell(){
  $('#app').classList.add('hidden');$('#runner').classList.remove('hidden');
  const label={MAIN:'본실험',PILOT:'파일럿',QA:'QA 테스트 · 연구 사용 금지',ADAPTIVE_DEMO:'화면 선택 시연'}[session.mode]||session.mode;
  $('#runner-progress').textContent=`${label} · ${Math.min(session.next_plan_index+1,session.schedule.length)} / ${session.schedule.length}`;
}
function openRunner(){
  if(!session)return;runnerShell();
  if(session.stage==='running'){
    const lock=lockInfo();
    if(lock&&lock.owner!==tabId&&lock.expires>Date.now()){
      $('#runner-content').innerHTML=`<div class="runner-center"><div class="phase-icon">!</div><h1>다른 탭에서 진행 중이에요</h1><p>동일한 세션을 두 탭에서 동시에 실행할 수 없습니다.</p><div class="button-row"><button class="button secondary" id="back-home">돌아가기</button></div></div>`;
      $('#back-home').onclick=()=>setView('home');return;
    }
    recoverInterrupted();return;
  }
  if(session.stage==='end_sync'){renderEndSync();return;}
  if(session.stage==='rating'){renderRating();return;}
  if(session.next_plan_index>=session.schedule.length){renderFinish();return;}
  renderBetween();
}
function renderBetween(){
  session.stage='between';persist();runnerShell();const plan=session.schedule[session.next_plan_index];
  const isFirst=session.next_plan_index===0;
  const isRoundBreak=!isFirst&&plan.round!==session.schedule[session.next_plan_index-1]?.round;
  $('#runner-content').innerHTML=`<div class="runner-center"><div class="phase-icon">${isRoundBreak?'☕':'◌'}</div><div class="phase-label">${isRoundBreak?'BREAK TIME':'READY FOR THE NEXT BLOCK'}</div><h1>${isRoundBreak?'잠깐 쉬어 가요':'실험을 시작할 준비가 됐나요?'}</h1><p>${isRoundBreak?'편하게 쉬고 준비되면 다음 블록으로 넘어가 주세요.':'산수와 상태 질문에 맞으면 F, 틀리면 J를 누릅니다.'}<br>간결 화면의 상태 질문에서는 스페이스바로 정보를 확인할 수 있어요.</p><div class="key-grid"><div class="key-card"><b>F</b>맞아요 · O</div><div class="key-card"><b>J</b>틀려요 · X</div><div class="key-card"><b>SPACE</b>정보 열기</div></div><p>다음: <b>${esc(formatCondition(plan))}</b><br>${session.mode==='QA'?'QA 단축 시간 · 연구 사용 금지':'한 블록 60초 · 이후 자기보고'}</p><div class="button-row"><button class="button primary" id="open-start-sync">다음 블록 준비 →</button><button class="button secondary" id="partial-save">기록 저장 ↓</button></div></div>`;
  $('#open-start-sync').onclick=renderStartSync;$('#partial-save').onclick=()=>downloadJSON();
}
function renderStartSync(){
  if(!acquireLock()){toast('다른 탭에서 실험이 진행 중입니다.');return;}
  const plan=session.schedule[session.next_plan_index];
  session.stage='start_sync';event('START_TRIGGER_REQUEST',{block_index:plan.index,details:'장비 앱에서 수동으로 시작 트리거를 누름'});persist();
  $('#runner-content').innerHTML=`<div class="runner-center"><div class="phase-icon">◎</div><div class="phase-label">MANUAL TRIGGER · START</div><h1>장비 앱에서 시작 트리거를<br>눌러 주세요.</h1><p>MeasureWiz 앱의 <b>trigger point</b>를 누른 뒤<br>바로 아래 버튼을 누르면 1분 블록이 시작됩니다.</p><p class="field-help">사이트는 클릭 시각을 기록합니다. 앱과 PC의 실제 시간차는 별도 파일럿에서 확인해야 합니다.</p><div class="button-row"><button class="button primary" id="start-confirm">눌렀어요 · 블록 시작 →</button><button class="button secondary" id="cancel-start">이전으로</button></div></div>`;
  $('#start-confirm').onclick=startBlock;$('#cancel-start').onclick=()=>{releaseLock();renderBetween();};
}
function startBlock(){
  if(session.stage!=='start_sync')return;
  const plan=session.schedule[session.next_plan_index],attempt=1+session.blocks.filter(b=>b.index===plan.index).length;
  const planned=attempt===1?plan.trials:retryTrials(plan,session.seed,attempt);
  session.active_block={index:plan.index,attempt,round:plan.round,condition:plan.condition,difficulty:plan.difficulty,layout:plan.layout,status:'running',flags:[],trials:[],planned_trials:planned,
    started_at:iso(),started_epoch_ms:Date.now(),started_performance_ms:round(performance.now()),trigger_start_ack_at:iso(),rating:null};
  session.stage='running';event('START_TRIGGER_ACK',{block_index:plan.index,attempt});event('BLOCK_START',{block_index:plan.index,attempt});persist();
  const trialMs=session.mode==='QA'?150:TRIAL_MS;
  session.active_block.duration_per_trial_ms=trialMs;activeTrial=null;
  renderTrial(0);
}
function renderTrial(i){
  const block=session?.active_block;if(!block||session.stage!=='running')return;
  if(i>=block.planned_trials.length){finishRunning(false);return;}
  const spec=block.planned_trials[i],ms=block.duration_per_trial_ms,now=performance.now(),expected=block.started_performance_ms+i*ms;
  if(Math.abs(now-expected)>Math.max(300,ms*0.8)&&!block.flags.includes('시각 지연'))block.flags.push('시각 지연');
  activeTrial={...spec,response:null,correct:false,rt_ms:null,onset_iso:iso(),onset_epoch_ms:Date.now(),onset_performance_ms:round(now),elapsed_start_ms:round(now-block.started_performance_ms),reveals:[]};
  const total=Math.max(0,20*ms-(now-block.started_performance_ms)),seconds=Math.ceil(total/1000);
  const prompt=spec.kind==='math'?`${spec.a} + ${spec.b} = ${spec.shown}`:`${spec.target}는 주의 상태인가요?`;
  const showStates=block.layout==='detailed';
  const statusHTML=STATUS_NAMES.map(n=>`<div class="hud-status status-${n.toLowerCase()} ${spec.states[n]==='주의'?'attention':''} ${showStates?'':'hidden-panel'}"><span>상태 ${n}</span><b>${spec.states[n]}</b></div>`).join('');
  $('#runner-content').innerHTML=`<div class="block-screen"><div class="trial-top"><span>블록 진행 중</span><span>${i+1} / 20</span></div><div class="hud-frame"><div class="hud-common hud-timer">남은 시간<b id="remaining">${seconds}초</b></div><div class="hud-common hud-prompt">현재 과제<b>${spec.kind==='math'?'중앙 산수':'상태 확인'}</b></div><div class="hud-center"><small>${spec.kind==='math'?'CALCULATION':'STATUS CHECK'}</small><h2>${esc(prompt)}</h2><p id="answer-feedback">맞으면 O, 틀리면 X</p></div>${statusHTML}</div><div class="timer-bar"><div id="timer-fill" class="timer-fill"></div></div><div class="answer-row"><button id="answer-true" type="button"><kbd>F</kbd>맞아요 O</button><button id="answer-false" type="button"><kbd>J</kbd>틀려요 X</button></div><p class="trial-hint">${block.layout==='compact'&&spec.kind==='status'?'상태를 보려면 스페이스바를 누르세요.':'화면을 벗어나지 말고 정해진 시간 안에 응답해 주세요.'}</p>${block.layout==='compact'&&spec.kind==='status'?'<div class="button-row" style="justify-content:center"><button class="button secondary" id="reveal-status" type="button">상태 열기 · SPACE</button></div>':''}</div>`;
  $('#answer-true').onclick=()=>answer(true,'pointer');$('#answer-false').onclick=()=>answer(false,'pointer');
  if($('#reveal-status'))$('#reveal-status').onclick=()=>reveal('pointer');
  event('TRIAL_ONSET',{block_index:block.index,attempt:block.attempt,details:{trial:i+1,kind:spec.kind,cycle:spec.cycle}});
  const deadline=block.started_performance_ms+(i+1)*ms;
  clearTimeout(activeTimer);activeTimer=setTimeout(()=>endTrial(i),Math.max(0,deadline-performance.now()));
  const paint=()=>{if(session?.stage!=='running')return;const elapsed=performance.now()-block.started_performance_ms;
    const remain=Math.max(0,20*ms-elapsed);const rem=$('#remaining');if(rem)rem.textContent=`${Math.ceil(remain/1000)}초`;
    const fill=$('#timer-fill');if(fill)fill.style.transform=`scaleX(${Math.max(0,1-elapsed/(20*ms))})`;paintFrame=requestAnimationFrame(paint);};
  cancelAnimationFrame(paintFrame);paintFrame=requestAnimationFrame(paint);
}
function answer(value,source){
  const block=session?.active_block;if(session?.stage!=='running'||!activeTrial||activeTrial.response!==null)return;
  const deadline=block.started_performance_ms+(block.trials.length+1)*block.duration_per_trial_ms;
  const now=performance.now();if(now>=deadline)return;
  activeTrial.response=value?'O':'X';activeTrial.correct=value===activeTrial.truth;activeTrial.rt_ms=round(now-activeTrial.onset_performance_ms);activeTrial.response_source=source;
  $('#answer-true').disabled=true;$('#answer-false').disabled=true;$('#answer-feedback').textContent='응답을 기록했어요.';
  event('TRIAL_RESPONSE',{block_index:block.index,attempt:block.attempt,details:{trial:block.trials.length+1,response:activeTrial.response,rt_ms:activeTrial.rt_ms}});persist();
}
function reveal(source){
  const block=session?.active_block;if(session?.stage!=='running'||!activeTrial||block.layout!=='compact'||activeTrial.kind!=='status')return;
  const now=performance.now(),deadline=block.started_performance_ms+(block.trials.length+1)*block.duration_per_trial_ms;if(now>=deadline)return;
  activeTrial.reveals.push({at:iso(),elapsed_ms:round(now-activeTrial.onset_performance_ms),source});
  $$('.hud-status').forEach(el=>el.classList.remove('hidden-panel'));
  clearTimeout(revealTimer);revealTimer=setTimeout(()=>$$('.hud-status').forEach(el=>el.classList.add('hidden-panel')),session.mode==='QA'?75:REVEAL_MS);
  event('STATUS_REVEAL',{block_index:block.index,attempt:block.attempt,details:{trial:block.trials.length+1,source}});persist();
}
function endTrial(i){
  const block=session?.active_block;if(session?.stage!=='running'||!activeTrial)return;
  activeTrial.elapsed_end_ms=round(performance.now()-block.started_performance_ms);
  block.trials.push(activeTrial);activeTrial=null;clearTimeout(revealTimer);persist();renderTrial(i+1);
}
function finishRunning(interrupted,reason=''){
  if(session?.stage!=='running')return;
  clearTimeout(activeTimer);clearTimeout(revealTimer);cancelAnimationFrame(paintFrame);
  const block=session.active_block;
  if(interrupted){
    if(reason&&!block.flags.includes(reason))block.flags.push(reason);
    if(activeTrial){activeTrial.elapsed_end_ms=round(performance.now()-block.started_performance_ms);activeTrial.interrupted=true;block.trials.push(activeTrial);activeTrial=null;}
    block.status='interrupted';
  } else block.status='awaiting_rating';
  block.finished_at=iso();block.finished_epoch_ms=Date.now();block.summary=summarizeTrials(block.trials);
  event(interrupted?'BLOCK_INTERRUPTED':'BLOCK_END',{block_index:block.index,attempt:block.attempt,details:reason});
  session.stage='end_sync';persist();renderEndSync();
}
function interrupt(reason){if(session?.stage==='running')finishRunning(true,reason);}
function recoverInterrupted(){
  const block=session.active_block;if(!block){session.stage='between';persist();renderBetween();return;}
  if(!block.flags.includes('새로고침 또는 브라우저 종료'))block.flags.push('새로고침 또는 브라우저 종료');
  block.status='interrupted';block.finished_at=iso();block.summary=summarizeTrials(block.trials||[]);session.stage='end_sync';event('BLOCK_INTERRUPTED',{block_index:block.index,attempt:block.attempt,details:'새로고침 또는 브라우저 종료'});persist();renderEndSync();
}
function renderEndSync(){
  runnerShell();const block=session.active_block;
  if(!block){session.stage='between';persist();renderBetween();return;}
  if(!block.end_prompt_at){block.end_prompt_at=iso();event('END_TRIGGER_REQUEST',{block_index:block.index,attempt:block.attempt,details:'장비 앱에서 수동으로 종료 트리거를 누름'});persist();}
  $('#runner-content').innerHTML=`<div class="runner-center"><div class="phase-icon">◎</div><div class="phase-label">MANUAL TRIGGER · END</div><h1>${block.status==='interrupted'?'블록이 중단됐어요.':'1분이 끝났어요.'}<br>장비 앱의 종료 트리거를 눌러 주세요.</h1><p>MeasureWiz 앱에서 <b>trigger point</b>를 누른 뒤<br>아래 버튼을 눌러 확인합니다.</p>${block.status==='interrupted'?`<p class="form-error">중단 사유: ${esc(block.flags.join(', '))}<br>이 시도는 분석용 완전 블록에 포함되지 않습니다.</p>`:''}<div class="button-row"><button class="button primary" id="end-confirm">눌렀어요 · 다음 →</button></div></div>`;
  $('#end-confirm').onclick=()=>{
    if(session.stage!=='end_sync')return;
    block.trigger_end_ack_at=iso();event('END_TRIGGER_ACK',{block_index:block.index,attempt:block.attempt});
    if(block.status==='interrupted'){
      block.planned_trials=undefined;session.blocks.push(block);session.active_block=null;session.stage='retry';persist();releaseLock();renderRetry();
    } else {session.stage='rating';persist();renderRating();}
  };
}
function renderRetry(){
  $('#runner-content').innerHTML=`<div class="runner-center"><div class="phase-icon">↺</div><h1>중단된 기록을 보관했어요.</h1><p>같은 조건을 새 문항으로 다시 수행할 수 있습니다.<br>이전의 부분 기록과 중단 사유도 함께 저장됩니다.</p><div class="button-row"><button id="retry-block" class="button primary">같은 조건 다시 준비 →</button><button id="skip-block" class="button secondary">이 블록 제외하고 진행</button><button id="retry-save" class="button secondary">기록 저장 ↓</button></div></div>`;
  $('#retry-block').onclick=()=>{session.stage='between';persist();renderBetween();};
  $('#skip-block').onclick=()=>{event('BLOCK_SKIPPED',{block_index:session.schedule[session.next_plan_index].index,details:'중단 후 연구자가 제외'});session.next_plan_index++;session.stage='between';persist();openRunner();};
  $('#retry-save').onclick=()=>downloadJSON();
}
function renderRating(){
  runnerShell();const block=session.active_block;let selected=Number.isFinite(block.rating)?block.rating:null;
  const paint=()=>{
    $('#runner-content').innerHTML=`<div class="runner-center"><div class="phase-icon">◡</div><div class="phase-label">HOW DID IT FEEL?</div><h1>방금 과제에<br>얼마나 정신적 노력이 들었나요?</h1><p>방금 1분을 떠올리며 0부터 10까지 선택해 주세요.</p><div class="rating-grid">${Array.from({length:11},(_,i)=>`<button type="button" class="${selected===i?'selected':''}" data-rating="${i}" aria-pressed="${selected===i}">${i}</button>`).join('')}</div><div class="rating-ends"><span>전혀 노력하지 않음</span><span>매우 많은 노력</span></div><div class="button-row"><button id="submit-rating" class="button primary" ${selected===null?'disabled':''}>기록하고 계속 →</button></div></div>`;
    $$('[data-rating]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.rating);paint();});
    $('#submit-rating').onclick=()=>{
      if(selected===null||session.stage!=='rating')return;
      block.rating=selected;block.status='complete';block.summary=summarizeTrials(block.trials);delete block.planned_trials;
      session.blocks.push(block);event('BLOCK_RATING',{block_index:block.index,attempt:block.attempt,details:{rating:selected}});
      session.active_block=null;session.next_plan_index++;session.stage='between';persist();releaseLock();openRunner();
    };
  };paint();
}
function renderFinish(){
  session.stage='finished';if(!session.finished_at){session.finished_at=iso();event('SESSION_FINISHED');persist();}releaseLock();
  const valid=session.blocks.filter(b=>b.status==='complete'&&!b.flags?.length).length,interruptions=session.blocks.filter(b=>b.status==='interrupted').length;
  $('#runner-content').innerHTML=`<div class="runner-center"><div class="phase-icon">✓</div><div class="phase-label">SESSION COMPLETE</div><h1>세션 기록을 저장해 주세요.</h1><p>완료 블록 ${valid}개 · 중단 시도 ${interruptions}개<br>${session.mode==='QA'?'<b>QA 테스트 자료는 연구에 사용할 수 없습니다.</b><br>':''}아래 JSON과 CSV 기록을 저장하고,<br>MeasureWiz 앱의 원본 CSV도 별도로 보관해 주세요.</p><div class="button-row"><button id="finish-json" class="button primary">세션 JSON 저장 ↓</button><button id="finish-csv" class="button secondary">기록 CSV 저장 ↓</button><button id="finish-analysis" class="button secondary">분석으로 이동 →</button></div></div>`;
  $('#finish-json').onclick=()=>downloadJSON();$('#finish-csv').onclick=()=>downloadTables();$('#finish-analysis').onclick=()=>{switchAnalysisSession(session);setView('analysis');};
}
$('#exit-runner').addEventListener('click',()=>{
  if(session?.stage==='running'){
    if(confirm('진행 중인 블록을 중단하고 부분 기록을 보관할까요?'))interrupt('연구자 중단');
  } else if(session?.stage==='start_sync'){releaseLock();session.stage='between';persist();setView('home');}
  else {persist();setView('home');}
});
document.addEventListener('keydown',e=>{
  if(session?.stage!=='running'||e.repeat)return;
  if(e.code==='KeyF'){e.preventDefault();answer(true,'keyboard');}
  else if(e.code==='KeyJ'){e.preventDefault();answer(false,'keyboard');}
  else if(e.code==='Space'){e.preventDefault();reveal('keyboard');}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.stage==='running')interrupt('탭 비활성화');});
window.addEventListener('beforeunload',e=>{if(session?.stage==='running'){persist();e.preventDefault();e.returnValue='';}releaseLock();});

function renderAnalysisSession(){
  const el=$('#session-info');
  if(!analysisSession){el.textContent='아직 불러온 세션이 없습니다.';return;}
  const complete=analysisSession.blocks.filter(b=>b.status==='complete').length;
  el.textContent=`${analysisSession.participant_id} · ${analysisSession.session_id} · ${analysisSession.mode} · 완료 ${complete}블록${analysisSession.mode==='QA'?' (검사용 자료)':''}`;
  if(analysisSession.analysis_features&&typeof analysisSession.analysis_features==='object')features=analysisSession.analysis_features;
  updateMapping();
}
function clearAnalysisResults(){
  mappingLog=[];cvResult=null;recommendation=null;
  $('#continuity-check').checked=false;$('#timing-check').checked=false;
  $('#eeg-analysis-message').textContent='';
  $('#feature-results').innerHTML='';$('#model-results').innerHTML='';$('#recommend-results').innerHTML='';
  $('#download-features').classList.add('hidden');$('#download-model').classList.add('hidden');
  $('#recommend-section').classList.add('hidden');
}
function switchAnalysisSession(data){
  clearAnalysisResults();analysisSession=data;features=data.analysis_features||{};
  eegFiles=[];merged=null;$('#eeg-files').value='';$('#file-order').innerHTML='';
  $('#eeg-info').textContent='아직 불러온 EEG 파일이 없습니다.';
  renderAnalysisSession();
}
$('#session-file').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  try{const data=JSON.parse(await f.text());if(!sessionValid(data))throw new Error('이 사이트의 세션 JSON이 아닙니다.');switchAnalysisSession(data);}
  catch(error){$('#session-info').textContent=`불러오기 실패: ${error.message}`;}e.target.value='';
});
$('#use-current').onclick=()=>{const s=loadSaved();if(!s){toast('이 브라우저에 저장된 세션이 없습니다.');return;}switchAnalysisSession(s);};
$('#eeg-files').addEventListener('change',async e=>{
  const files=[...e.target.files];if(!files.length)return;
  clearAnalysisResults();features={};$('#continuity-check').checked=false;$('#timing-check').checked=false;
  try{eegFiles=[];for(const f of files)eegFiles.push(parseMeasureWizCSV(await f.text(),f.name));rebuildEEG();}
  catch(error){eegFiles=[];merged=null;$('#eeg-info').textContent=`불러오기 실패: ${error.message}`;updateMapping();}e.target.value='';
});
function rebuildEEG(){
  try{merged=mergeEEG(eegFiles);const duration=merged.samples.length/merged.frequency;
    $('#eeg-info').textContent=`${merged.parts.length}개 파일 · ${merged.frequency}Hz · 표본 ${merged.samples.length.toLocaleString()}개 · 트리거 ${merged.markers.length}개 · 연속 저장 가정 ${duration.toFixed(1)}초`;
    $('#file-order').innerHTML=merged.parts.map((p,i)=>`<div class="file-row"><span>${i+1}. ${esc(p.filename)} · ${p.count.toLocaleString()}개${p.malformed?` · 읽기 오류 ${p.malformed}`:''}</span><button class="icon-button" data-move="up" data-file="${i}" aria-label="파일 위로">↑</button><button class="icon-button" data-move="down" data-file="${i}" aria-label="파일 아래로">↓</button></div>`).join('');
    $$('#file-order [data-move]').forEach(btn=>btn.onclick=()=>{const i=Number(btn.dataset.file),j=i+(btn.dataset.move==='up'?-1:1);if(j<0||j>=eegFiles.length)return;[eegFiles[i],eegFiles[j]]=[eegFiles[j],eegFiles[i]];clearAnalysisResults();features={};$('#continuity-check').checked=false;rebuildEEG();});
    updateMapping();
  }catch(error){merged=null;$('#eeg-info').textContent=error.message;updateMapping();}
}
function updateMapping(){
  const show=!!(analysisSession&&merged);$('#mapping-section').classList.toggle('hidden',!show);
  $('#model-section').classList.toggle('hidden',!analysisSession||!Object.keys(features).length);
  $('#download-features').classList.toggle('hidden',!Object.keys(features).length);
  if(!show)return;
  $('#marker-list').innerHTML=merged.markers.length?merged.markers.map((m,i)=>`<span class="marker-chip">#${i+1} · ${(m.sample/merged.frequency).toFixed(2)}초 · ${esc(m.file)}</span>`).join(''):'<span class="inline-info">trigger point가 없습니다. 이 파일만으로 블록을 연결할 수 없습니다.</span>';
  const blocks=analysisSession.blocks.filter(b=>b.status==='complete');
  $('#mapping-body').innerHTML=blocks.map(b=>`<tr><td>${b.index}${b.flags?.length?' ⚠':''}</td><td>${esc(formatCondition(b))}</td><td><input type="number" min="1" max="${merged.markers.length}" data-start="${b.index}" aria-label="${b.index} 블록 시작 트리거"></td><td><input type="number" min="1" max="${merged.markers.length}" data-end="${b.index}" aria-label="${b.index} 블록 종료 트리거"></td></tr>`).join('')||'<tr><td colspan="4">완료된 블록이 없습니다.</td></tr>';
  if(Object.keys(features).length){renderFeatureResults();$('#model-section').classList.remove('hidden');}
}
$('#run-eeg').onclick=()=>{
  if(!analysisSession||!merged)return;
  if(!$('#continuity-check').checked||!$('#timing-check').checked){$('#eeg-analysis-message').textContent='파일 연속성과 트리거 시간차를 확인한 뒤 체크해 주세요.';return;}
  const threshold=Number($('#qc-threshold').value);if(!Number.isFinite(threshold)||threshold<=0){$('#eeg-analysis-message').textContent='양수의 잡음 제외 기준을 입력해 주세요.';return;}
  const used=new Set(),next={},logs=[];let lastEnd=0;
  for(const block of analysisSession.blocks.filter(b=>b.status==='complete')){
    const a=$(`[data-start="${block.index}"]`)?.value,b=$(`[data-end="${block.index}"]`)?.value;
    if(!a&&!b){logs.push({index:block.index,status:'미지정'});continue;}
    const start=Number(a),end=Number(b);
    if(block.flags?.length){logs.push({index:block.index,status:`제외: ${block.flags.join(', ')}`});continue;}
    if(!a||!b||used.has(start)||used.has(end)||start<=lastEnd){logs.push({index:block.index,status:'제외: 트리거 누락·중복 또는 블록 순서 충돌'});continue;}
    try{const f=extractBandFeature(merged,start,end,{thresholdUv:threshold});used.add(start);used.add(end);lastEnd=end;next[String(block.index)]=f;logs.push({index:block.index,status:'계산됨',feature:f});}
    catch(error){logs.push({index:block.index,status:`제외: ${error.message}`});}
  }
  features=next;mappingLog=logs;cvResult=null;recommendation=null;analysisSession.analysis_features=features;
  analysisSession.analysis_audit={created_at:iso(),file_order:merged.parts.map(p=>p.filename),threshold_uv:threshold,
    operator_attested_continuity:true,operator_attested_trigger_timing:true,mapping:logs,warning:'기기 시간 정렬과 표본 연속성은 별도 파일럿에서 검증 필요'};
  if(session&&session.participant_id===analysisSession.participant_id&&session.session_id===analysisSession.session_id&&session.created_at===analysisSession.created_at&&session.seed===analysisSession.seed){session.analysis_features=features;session.analysis_audit=analysisSession.analysis_audit;persist();}
  $('#eeg-analysis-message').textContent=`유효 특징 ${Object.keys(features).length}개. 제외·미지정 항목도 아래에 남겼습니다.`;renderFeatureResults();
  $('#download-features').classList.toggle('hidden',!Object.keys(features).length);$('#model-section').classList.toggle('hidden',!Object.keys(features).length);$('#recommend-section').classList.add('hidden');
};
function renderFeatureResults(){
  const logs=mappingLog.length?mappingLog:Object.entries(features).map(([index,feature])=>({index,status:'계산됨',feature}));
  $('#feature-results').innerHTML=logs.length?`<div class="table-wrap"><table><thead><tr><th>블록</th><th>상태</th><th>유효 구간</th><th>log(theta / alpha)</th></tr></thead><tbody>${logs.map(row=>`<tr><td>${esc(row.index)}</td><td>${esc(row.status)}</td><td>${row.feature?`${row.feature.valid_seconds.toFixed(1)}초`: '—'}</td><td>${row.feature?row.feature.log_theta_alpha.toFixed(4):'—'}</td></tr>`).join('')}</tbody></table></div><div class="button-row"><button type="button" class="button secondary" id="backup-analysis">분석 포함 JSON 저장 ↓</button></div><p class="footnote">Quality=0과 선택한 진폭 기준 초과 구간을 제외합니다. Quality 값의 의미와 눈 움직임의 영향은 별도 확인이 필요합니다.</p>`:'';
  if($('#backup-analysis'))$('#backup-analysis').onclick=()=>downloadJSON(analysisSession);
}
$('#download-features').onclick=()=>{const rows=Object.entries(features).map(([index,f])=>({participant_id:analysisSession.participant_id,session_id:analysisSession.session_id,block_index:index,...f}));const cols=['participant_id','session_id','block_index','marker_start','marker_end','marker_duration_s','core_duration_s','valid_seconds','valid_windows','rejected_windows','unknown_quality_windows','theta_power','alpha_power','log_theta_alpha','threshold_uv','trim_seconds','note'];download(`${prefix(analysisSession)}_eeg_features.csv`,toCSV(cols,rows),'text/csv;charset=utf-8');};
$('#run-model').onclick=()=>{
  if(!analysisSession)return;
  cvResult=groupedCrossValidation(analysisSession.blocks,features);const el=$('#model-results');
  if(!cvResult.mae){el.innerHTML=`<p class="result-message">분석 가능한 학습 블록이 부족합니다. 각 평가 라운드마다 나머지 유효 블록 16개 이상과 네 조건별 3개 이상이 필요해요. 현재 EEG 특징 ${cvResult.eligible_blocks}개입니다.</p>`;$('#download-model').classList.add('hidden');$('#recommend-section').classList.add('hidden');return;}
  const m=cvResult.mae,delta=cvResult.delta_a_minus_b;
  el.innerHTML=`<div class="result-grid"><div class="result-cell"><span>평균 점수 기준 MAE</span><b>${m.baseline.toFixed(2)}</b></div><div class="result-cell"><span>모델 A · 행동 기반</span><b>${m.model_a.toFixed(2)}</b></div><div class="result-cell"><span>모델 B · EEG 추가</span><b>${m.model_b.toFixed(2)}</b></div></div><p class="result-message">같은 평가 블록 ${cvResult.predictions.length}개 · A - B = <b>${delta.toFixed(2)}</b>점<br>양수면 해당 자료에서 EEG 추가 모델의 평균 오차가 더 작았다는 뜻이에요. 적은 블록의 결과는 불안정할 수 있습니다.</p><p class="footnote">유효 EEG 블록 ${cvResult.eligible_blocks}개 · 건너뛴 라운드 ${cvResult.skipped.length}개 · 규제 선형회귀 λ=1</p>`;
  $('#download-model').classList.remove('hidden');$('#recommend-section').classList.remove('hidden');
  const possible=analysisSession.blocks.filter(b=>b.status==='complete'&&features[String(b.index)]&&!b.flags?.length);
  $('#recommend-block').innerHTML=possible.map(b=>`<option value="${b.index}">${b.index}번 · ${esc(formatCondition(b))}</option>`).join('');
  if(possible.length)$('#recommend-block').value=String(possible.at(-1).index);
};
$('#download-model').onclick=()=>{if(!cvResult)return;const cols=['index','round','condition','actual','baseline','model_a','model_b'];download(`${prefix(analysisSession)}_heldout_predictions.csv`,toCSV(cols,cvResult.predictions),'text/csv;charset=utf-8');};
$('#run-recommend').onclick=()=>{
  try{const blockIndex=Number($('#recommend-block').value),policy=$('#recommend-policy').value,threshold=Number($('#recommend-threshold').value);
    recommendation=recommendFromPast(analysisSession.blocks,features,blockIndex,policy,threshold);
    const chosen=recommendation.layout==='compact'?'간결 화면':'상세 화면';
    $('#recommend-results').innerHTML=`<div class="result-grid"><div class="result-cell"><span>직전 블록의 추정 점수</span><b>${recommendation.estimated_effort.toFixed(2)}</b></div><div class="result-cell"><span>선택된 화면</span><b>${chosen}</b></div><div class="result-cell"><span>이전 학습 블록</span><b>${recommendation.training_count}개</b></div></div><p class="result-message">이전 블록의 상태를 바탕으로 다음 화면을 고르는 시연이에요. 이전에 보지 않은 화면의 수행 결과는 계산하지 않습니다.</p><button class="button primary" id="launch-adaptive-demo" type="button">선택된 화면으로 한 블록 시연 →</button>`;
    $('#launch-adaptive-demo').onclick=startAdaptiveDemo;
  }catch(error){recommendation=null;$('#recommend-results').innerHTML=`<p class="form-error">${esc(error.message)}</p>`;}
};
function startAdaptiveDemo(){
  if(!recommendation||!analysisSession)return;
  const existing=loadSaved();if(existing&&existing.stage!=='finished'){toast('진행 중인 세션을 먼저 끝내거나 저장해 주세요.');return;}
  if(existing&&!confirm('시연을 시작하면 이 브라우저의 이전 세션이 교체됩니다. 이전 세션과 분석 JSON을 저장했나요?'))return;
  const source=analysisSession.blocks.find(b=>b.index===recommendation.source_index&&b.status==='complete');if(!source){toast('기준 블록을 찾지 못했습니다.');return;}
  const condition=CONDITION_ORDER.find(c=>c.difficulty===source.difficulty&&c.layout===recommendation.layout);
  const seed=seedFor(`${analysisSession.participant_id}:adaptive:${Date.now()}`);
  const plan={index:1,round:1,condition:condition.id,difficulty:condition.difficulty,layout:condition.layout,label:condition.label,trials:createTrials(condition,seed)};
  session={schema:SCHEMA,protocol_version:PROTOCOL_VERSION,participant_id:analysisSession.participant_id,session_id:`${analysisSession.session_id.slice(0,18)}-DEMO`,mode:'ADAPTIVE_DEMO',seed,created_at:iso(),updated_at:iso(),stage:'between',next_plan_index:0,schedule:[plan],blocks:[],events:[],active_block:null,
    adaptive_source:{session_id:analysisSession.session_id,source_index:source.index,source_finished_at:source.finished_at,recommendation,selected_at:iso(),interpretation:'이전 블록 기반 지연 시연; 효과 검증 아님'}};
  event('ADAPTIVE_DEMO_CREATED',{details:{source_index:source.index,policy:recommendation.policy,threshold:recommendation.threshold}});persist();openRunner();
}

session=loadSaved();renderSaved();
if(qaRequested){const p=document.createElement('div');p.className='notice-card';p.style.marginTop='14px';p.innerHTML='<span>!</span><p><b>QA 테스트 모드</b><br>과제 시간이 단축되며 생성된 자료는 연구에 사용할 수 없습니다.</p>';$('.content-grid').before(p);}
