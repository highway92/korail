import {readPublicSearch} from './reader.js';
import {parseSnapshot, summarizeTargets} from './parser.js';
import {probeRefresh} from './refresh.js';
import {limitedReload} from './rate-limit.js';

const $=id=>document.getElementById(id);
let report=null, tabId=null;
const errors={wrong_page:'코레일의 열차 조회 결과 탭에서 실행해 주세요.',
  missing_list:'조회 목록 영역을 찾지 못했습니다. 목록이 표시된 뒤 다시 눌러 주세요.',
  missing_conditions:'날짜·출발역·도착역을 읽지 못했습니다. 조회 화면인지 확인해 주세요.'};
const statuses={sold_out:'매진',unavailable:'미운영',waitlist:'예약대기',standing_combo:'입석 포함',unknown:'확인 필요',available:'좌석 표시'};
function busy(value) {for(const id of ['read','refresh','save','target-times','timeout','monitor']) $(id).disabled=value;}
$('monitor').addEventListener('click',async()=>{
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id) throw new Error('no_tab');
    await chrome.windows.create({url:chrome.runtime.getURL(`monitor.html?tab=${tab.id}`),type:'popup',width:650,height:850});
  } catch {$('status').textContent='설정창을 열지 못했습니다. 코레일 목록 탭에서 다시 실행해 주세요.';}
});
async function readTab(id) {
  const result=await chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func:readPublicSearch});
  return result[0]?.result;
}
function targets() {
  const times=$('target-times').value.split(',').map(v=>v.trim()).filter(Boolean);
  if(times.some(v=>!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))) {
    $('targets').textContent='시각은 07:47, 08:20 형식으로 입력하세요.';return;
  }
  if(!report?.parsed) {$('targets').textContent='열차 행 구조 확인이 필요합니다.';return;}
  $('targets').textContent=summarizeTargets(report.parsed.trains,[...new Set(times)]).map(t=>
    t.matches.length ? t.matches.map(train=>`${t.time} · ${train.key.number}편 · ${train.seats.map(s=>`${s.seatClass} ${statuses[s.status]}`).join(' / ')}`).join('\n'):
      `${t.time} · 현재 로드된 목록에 없음`).join('\n') || '관심 시각을 입력하면 해당 열차를 표시합니다.';
}
function render(data) {
  let parsed=null;
  try {parsed=parseSnapshot(data);} catch { /* Raw public diagnostics remain available. */ }
  report={...data,parsed,parseStatus:parsed?'recognized':'needs_inspection'};
  $('route').textContent=`${data.conditions.departure} → ${data.conditions.arrival}`;
  $('date').textContent=`${data.conditions.date} · ${data.conditions.passengers}`;
  $('rows').replaceChildren();
  const lines=parsed?parsed.trains.map(t=>`${t.key.time} → ${t.arrivalTime} · ${t.type} ${t.key.number}\n`+
    t.seats.map(s=>`${s.seatClass} ${statuses[s.status]}${s.selected?' [선택됨]':''}${s.price?' '+s.price.toLocaleString('ko-KR')+'원':''}`).join(' / ')):data.rows;
  for(const line of lines) {const li=document.createElement('li');li.textContent=line;$('rows').append(li);}
  const descriptions={readable:parsed?`열차 ${parsed.trains.length}편을 구분했습니다.`:`목록 항목 ${data.rows.length}개를 읽었습니다. 행 구조 확인이 필요합니다.`,
    empty:'사이트가 빈 목록을 표시합니다. 매진 여부는 판단할 수 없습니다.',
    unrecognized:'목록 영역의 구조 확인이 필요합니다. 진단 파일을 저장해 주세요.'};
  $('status').textContent=descriptions[data.status]+(data.truncated?'\n내용이 길어 일부만 읽었습니다.':'');
  $('preview').textContent=JSON.stringify(report,null,2);
  $('result').hidden=false;targets();
}
$('target-times').addEventListener('input',targets);
$('read').addEventListener('click',async()=>{
  report=null;tabId=null;$('result').hidden=true;busy(true);
  $('status').textContent='현재 탭의 공개 목록을 읽고 있습니다…';
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id) throw new Error('no_tab');
    const data=await readTab(tab.id);
    if(!data?.ok) {$('status').textContent=errors[data?.code]||'목록을 읽지 못했습니다.';return;}
    tabId=tab.id;render(data);
  } catch {$('status').textContent='현재 탭을 읽을 수 없습니다. 코레일 조회 결과 탭에서 다시 실행해 주세요. 시크릿 창은 확장프로그램의 시크릿 모드 허용이 필요합니다.';}
  finally {busy(false);}
});
$('refresh').addEventListener('click',async()=>{
  const seconds=Number($('timeout').value);
  if(!Number.isFinite(seconds)||seconds<1||seconds>120) {$('status').textContent='대기 시간은 1~120초로 입력하세요.';return;}
  if(!report||tabId===null) return;
  busy(true);
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(tab?.id!==tabId) throw new Error('tab_changed');
    const baseline=await readTab(tabId);
    if(!baseline?.ok) throw new Error('page_changed');
    $('status').textContent='탭을 한 번 새로고침한 뒤 목록을 기다립니다…';
    const result=await navigator.locks.request('korail-booking-global',{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('macro_running');
      return probeRefresh({baseline,timeoutMs:seconds*1000,
      reload:()=>limitedReload({reload:()=>chrome.tabs.reload(tabId),deadline:Date.now()+seconds*1000}),read:()=>readTab(tabId),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
    });
    if(result.snapshot) render(result.snapshot);
    const code=result.ok?'success':result.code;
    report={...report,refreshProbe:{status:code,timeoutSeconds:seconds,at:new Date().toISOString()}};
    $('preview').textContent=JSON.stringify(report,null,2);
    const messages={success:'새로 열린 문서에서 같은 조건의 열차 목록을 확인했습니다. 진단 파일을 저장해 주세요.',
      conditions_changed:'새로고침 뒤 날짜·구간 등의 조건이 바뀌었습니다. 결과를 저장해 주세요.',
      page_changed:'새로고침 뒤 조회 결과가 아닌 화면으로 이동했습니다.',
      timeout:'대기 시간 안에 새 문서의 열차 목록을 확인하지 못했습니다. 결과를 저장해 주세요.'};
    $('status').textContent=messages[code]||'갱신 결과를 확인하지 못했습니다.';
  } catch {$('status').textContent='갱신 시험을 완료하지 못했습니다. 현재 페이지에서 목록을 다시 읽어 주세요.';}
  finally {busy(false);}
});
$('save').addEventListener('click',()=>{
  if(!report) return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;
  link.download=`korail-public-snapshot-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
});
