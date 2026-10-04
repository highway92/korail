import {readPublicSearch} from './reader.js';
import {parseSnapshot} from './parser.js';
import {probeRefresh} from './refresh.js';
import {monitor,validateSettings} from './monitor.js';
import {transactionStore} from './booking.js';
import {searchAction,inspectBookingPage} from './booking-dom.js';
import {fillPersonalCard} from './card-dom.js';
import {checkout} from './checkout.js';
import {checkoutPage} from './checkout-dom.js';
import {loadLocalCard,cardSummary} from './card-store.js';
import {readyAction} from './action-ready.js';
import {limitedReload} from './rate-limit.js';
const $=id=>document.getElementById(id);
const tabId=Number(new URL(location.href).searchParams.get('tab'));
let baseline=null,trains=[],controller=null,activeSettings=null;
const journal=transactionStore(localStorage);
let found=null;
async function execute(func,args=[]) {
  const result=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func,args});
  return result[0]?.result;
}
async function act(mode,candidate) {
  return readyAction({run:()=>execute(searchAction,[{mode,key:candidate.train.key,seatClass:candidate.seatClass}]),signal:controller.signal,sleep});
}
const bookingMessages={reservation_continuation_submitting:'안내 확인 후 선택한 열차의 예매를 진행합니다.',reservation_submitting:'예매 요청 중 — 다시 제출하지 않습니다.',login_required:'수동 로그인이 필요합니다. 로그인 후 예약 여부를 확인해 주세요.',
  reserved:'대상 예약 확인 완료. 카드결제로 진행합니다.',payment_submitting:'결제/발권 요청 중 — 다시 제출하지 않습니다.',complete:'대상 승차권의 발권을 확인했습니다. 실행을 완료했습니다.',
  uncertain:'예매 결과 확인이 필요합니다. 기록을 유지하고 자동 재요청하지 않습니다.',booking_rejected:'선택 상태 또는 버튼을 확인하지 못해 예매를 중단했습니다.',stopped:'중지했습니다.'};
const keys=['interval','timeout','errorDelay','errorMultiplier','errorMax','maxErrors','maxQueries','maxRuntime'];
const sleep=(ms,signal)=>new Promise(resolve=>{
  const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};
  const timer=setTimeout(finish,ms);
  if(signal?.aborted) finish();else signal?.addEventListener('abort',finish,{once:true});
});
async function read() {
  if (!Number.isInteger(tabId)||tabId<=0) throw new Error('invalid_tab');
  let timer;
  try {
    const result=await Promise.race([
      chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:readPublicSearch}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('read_timeout')),10000);})]);
    if(result[0]?.result?.code==='wrong_page') throw new Error('page_changed');
    return result[0]?.result;
  } finally {clearTimeout(timer);}
}
function controls(running) {
  $('read').disabled=running;$('start').disabled=running||!baseline;$('stop').disabled=!running;
  $('selection').disabled=running;
  $('booking-options').disabled=running;
  $('inspect-flow').disabled=running;
  for(const key of keys) $(key).disabled=running&&key!=='interval';
}
const messages={waiting:'다음 조회 대기',querying:'목록 갱신 중',retry_wait:'조회 오류 후 대기',
  query_limit:'설정한 조회 횟수에 도달했습니다.',time_limit:'설정한 실행 시간에 도달했습니다.',
  stopped:'중지했습니다.',error_limit:'연속 오류 제한에 도달했습니다.',needs_attention:'목록을 확인한 뒤 다시 시작해 주세요.'};
function event(e) {
  if(e.state==='found')found=e.candidate;
  const text=e.state==='found'?`좌석 발견: ${e.candidate.train.key.time} ${e.candidate.train.key.number}편 ${e.candidate.seatClass}. 조회를 멈췄습니다.`:
    `${messages[e.state]||e.state}${e.delay?' · '+e.delay+'초':''}`;
  const reasons={missing_targets:'선택한 열차가 현재 목록에 없습니다.',conditions_changed:'조회 조건이 바뀌었습니다.',
    page_changed:'연결된 탭이 조회 화면을 벗어났습니다.',timeout:'새 문서의 목록 대기 시간이 지났습니다.',unreadable:'목록을 읽지 못했습니다.'};
  $('status').textContent=`${text}\n갱신 ${e.queries}회 · 연속 오류 ${e.errors}회${e.reason?'\n'+(reasons[e.reason]||'조회 화면 또는 연결을 확인해 주세요.'):''}`;
  const line=document.createElement('div');line.textContent=`${new Date().toLocaleTimeString()} ${$('status').textContent}`;
  $('log').prepend(line);while($('log').children.length>60) $('log').lastChild.remove();
}
$('read').onclick=async()=>{
  baseline=null;controls(true);
  try {
    const data=await read();
    if(data?.status!=='readable') throw new Error('unreadable');
    trains=parseSnapshot(data).trains;baseline=data;
    $('route').textContent=`${data.conditions.date} · ${data.conditions.departure} → ${data.conditions.arrival} · ${data.conditions.passengers}`;
    $('trains').replaceChildren();
    for(const train of trains) {
      const label=document.createElement('label'),checkbox=document.createElement('input');
      checkbox.type='checkbox';checkbox.value=train.id;checkbox.checked=['07:47','08:20'].includes(train.key.time);
      label.append(checkbox,document.createTextNode(` ${train.key.time} · ${train.type} ${train.key.number} · ${train.availableClasses.join('/')||'지정석 표시 없음'}`));
      $('trains').append(label);
    }
    $('status').textContent=`${trains.length}편을 읽었습니다. 감시할 열차와 설정을 확인하고 시작하세요. 현재 로드된 열차만 선택할 수 있습니다.`;
  } catch {$('status').textContent='목록을 읽지 못했습니다. 코레일 목록 탭에서 확장프로그램을 다시 열어 주세요.';}
  finally {controls(false);}
};
$('interval').onchange=()=>{
  const n=Number($('interval').value);
  if(activeSettings&&Number.isFinite(n)&&n>=0.65) activeSettings.interval=n;
};
$('stop').onclick=()=>controller?.abort();
$('start').onclick=async()=>{
  if(controller) return;
  let settings;
  try {
    const targets=[...$('trains').querySelectorAll('input:checked')].map(el=>el.value);
    const numbers=$('preference').value.split(',').map(v=>v.trim()).filter(Boolean);
    const preference=numbers.map(n=>{
      const matches=trains.filter(t=>targets.includes(t.id)&&t.key.number===n);
      if(matches.length!==1) throw new Error('preference');return matches[0].id;
    });
    settings=validateSettings({...Object.fromEntries(keys.map(k=>[k,Number($(k).value)])),targets,preference,
      classes:[$('general').checked?'일반실':null,$('special').checked?'특실':null].filter(Boolean)});
  } catch {$('status').textContent='열차·좌석을 선택하고 양수 설정값을 확인하세요. 선호 순서는 선택한 열차번호를 한 번씩 모두 포함해야 합니다.';return;}
  let runCard=null;
  {
    try {runCard=loadLocalCard(localStorage);} catch {runCard=null;}
    if(!runCard){$('status').textContent='카드 관리에서 결제 카드를 먼저 저장해 주세요.';return;}
    const current=new Date();
    if(Number(runCard.year)*12+Number(runCard.month)<current.getFullYear()*12+current.getMonth()+1){$('status').textContent='카드 유효기간을 확인해 주세요.';return;}
  }
  const ticketTimeout=Number($('ticket-timeout').value);
  const actionDelay=Number($('action-delay').value),transitionTimeout=Number($('transition-timeout').value),pollInterval=Number($('state-interval').value);
  if(!Number.isFinite(actionDelay)||actionDelay<0||!Number.isFinite(transitionTimeout)||transitionTimeout<=0||!Number.isFinite(pollInterval)||pollInterval<=0||!Number.isFinite(ticketTimeout)||ticketTimeout<=0){
    $('status').textContent='예약 단계의 시간 설정을 확인하세요.';return;
  }
  found=null;controller=new AbortController();activeSettings=settings;controls(true);
  try {
    // An extension-origin lock covers monitoring and checkout, including resetting the previous local run.
    await navigator.locks.request('korail-booking-global',{ifAvailable:true},async lock=>{
      if(!lock) {$('status').textContent='다른 설정창에서 매크로가 실행 중입니다.';return;}
      journal.resetForStart();$('log').replaceChildren();$('flow-data').textContent='';
      await monitor({baseline,settings,signal:controller.signal,read,sleep,onEvent:event,
        refresh:(snapshot,timeoutMs,signal)=>probeRefresh({baseline:snapshot,timeoutMs,pollMs:200,signal,
          reload:()=>limitedReload({reload:()=>chrome.tabs.reload(tabId),signal,deadline:Date.now()+timeoutMs,sleep}),read,sleep:ms=>sleep(ms,signal)})});
      if(found&&!controller.signal.aborted) {
        const flow=async(mode,candidate,reservation,notice)=>{
          return readyAction({run:()=>execute(checkoutPage,[{mode,candidate,reservation,notice}]),signal:controller.signal,sleep});
        };
        await checkout({candidate:found,card:runCard,store:journal,signal:controller.signal,sleep,actionDelay,transitionTimeout,pollInterval,ticketTimeout,
          site:{select:c=>act('select',c),verifySelected:c=>act('verify',c),reserve:c=>act('reserve',c),
            inspect:(c,r)=>flow('inspect',c,r),dismiss:n=>flow('dismiss',undefined,undefined,n),
            openPayment:(c,r)=>flow('openPayment',c,r),chooseCard:(c,r)=>flow('chooseCard',c,r),
            fillCard:async card=>{const r=await execute(fillPersonalCard,[card]);if(!r?.ok)throw new Error(r?.code||'card_input_failed');},
            submitPayment:async(c,r)=>{const verified=await execute(fillPersonalCard,[runCard,true]);if(!verified?.ok)throw new Error('card_input_changed');
              if(controller.signal.aborted)throw new Error('stopped');return flow('submitPayment',c,r);}},
          onEvent:e=>{$('status').textContent=bookingMessages[e.state]||'자동 결제 상태 확인 필요';
            if(e.reason)$('status').textContent+='\n확인 코드: '+e.reason+'\n단계: '+e.stage;
            if(e.trace)$('flow-data').textContent=JSON.stringify({stage:e.stage,reason:e.reason,blocker:e.blocker,trace:e.trace},null,2);}});

      }
    });
  } catch {$('status').textContent='실행을 중지했습니다. 연결된 코레일 탭을 확인해 주세요.';}
  finally {runCard=null;controller=null;activeSettings=null;controls(false);}
};
window.addEventListener('pagehide',()=>controller?.abort());
$('inspect-flow').onclick=async()=>{
  try {
    const data=await execute(inspectBookingPage);
    const previous=journal.load();
    $('flow-data').textContent=JSON.stringify({...data,execution:previous?{state:previous.state,stage:previous.stage,trace:previous.trace}:null},null,2);
    $('flow-details').open=true;
  } catch {$('flow-data').textContent='연결된 탭을 읽지 못했습니다. 해당 코레일 탭에서 설정창을 다시 열어 주세요.';}
};
function refreshCardSummary(){
  try {$('saved-card').textContent=cardSummary(localStorage);}catch{$('saved-card').textContent='카드 관리에서 저장 상태를 확인해 주세요.';}
}
window.addEventListener('storage',refreshCardSummary);
window.addEventListener('focus',refreshCardSummary);
refreshCardSummary();
