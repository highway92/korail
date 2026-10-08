// Semantic adapter for the observed Korail pages. Ambiguous layouts fail closed.
// No input values or ticket identifiers are returned.
export function checkoutPage({mode='inspect',candidate,reservation,notice,native=false}={}) {
  const fail=code=>({ok:false,code});
  const covered=el=>({ok:false,code:'covered_action',blocker:el?{tag:el.tagName.toLowerCase(),classes:[...el.classList].filter(s=>/^[a-zA-Z_][a-zA-Z0-9_-]{0,60}$/.test(s)).slice(0,8)}:null});
  if(location.origin!=='https://www.korail.com')return fail('wrong_origin');
  const pages={'/ticket/search/list':'search','/ticket/login':'login','/ticket/reservation/detail':'reservation','/ticket/reservation/list':'reservation_list',
    '/ticket/payment/payment':'payment','/ticket/myticket/list':'tickets'};
  const page=pages[location.pathname]||'unknown';
  const norm=s=>s.replace(/\s+/g,' ').trim();
  const visible=el=>{
    if(!el?.getClientRects().length)return false;
    for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}
    return true;
  };
  // Reuse text reads within this synchronous DOM snapshot only.
  const textCache=new WeakMap();
  const text=el=>{if(!textCache.has(el))textCache.set(el,norm(el.innerText||''));return textCache.get(el);};
  const buttons=(root,label)=>[...root.querySelectorAll('button,a,[role="button"]')].filter(el=>visible(el)&&text(el)===label&&!el.matches(':disabled')&&el.getAttribute('aria-disabled')!=='true');
  // Public DOM input sequence. Synthetic events remain untrusted; no trust spoofing.
  const press=el=>{
    const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    const base={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0,view:window};
    const pointer={...base,pointerId:1,pointerType:'mouse',isPrimary:true};
    const down=el.dispatchEvent(new PointerEvent('pointerdown',{...pointer,buttons:1}));
    if(!el.isConnected)return {ok:true,input:'pointer_sequence',clickDispatched:false};
    if(down){el.dispatchEvent(new MouseEvent('mousedown',{...base,buttons:1}));el.focus({preventScroll:true});}
    if(!el.isConnected)return {ok:true,input:'pointer_sequence',clickDispatched:false};
    el.dispatchEvent(new PointerEvent('pointerup',{...pointer,buttons:0}));
    if(down)el.dispatchEvent(new MouseEvent('mouseup',{...base,buttons:0}));
    if(!el.isConnected)return {ok:true,input:'pointer_sequence',clickDispatched:false};
    const top=document.elementFromPoint(x,y);
    if(!top||!(top===el||el.contains(top))||el.matches(':disabled'))return {ok:false,code:'input_target_changed'};
    el.click();return {ok:true,input:'pointer_sequence',clickDispatched:true};
  };
  const click=el=>{
    el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();
    const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    if(!top||!(top===el||el.contains(top)))return covered(top);
    const target={tag:el.tagName.toLowerCase(),classes:[...el.classList].filter(s=>/^[a-zA-Z_][a-zA-Z0-9_-]{0,60}$/.test(s)).slice(0,8),text:text(el)};
    if(native){window.__korailNativeTarget={element:el,path:location.pathname};return {ok:true,native:true,target};}
    if(page==='search')return {...press(el),target};
    el.click();return {ok:true,target};
  };
  // Find the smallest scope containing an observed notice and its own confirm button.
  const notices=[['train','이용안내','KTX-산천 2개 편성을 연결하여 운행하는 열차'],
    ['route','이용안내','서대전정차하는 열차입니다.'],
    ['duplicate_journey','안내 메시지','동일한 예약 내역이 있으니, 기존 예약 건을 취소하거나 발권 후 구매하시기 바랍니다.','다른여정예약'],
    ['refund','환불(반환) 위약금 안내','환불'],['paid','결제가 완료되었습니다.','결제가 완료되었습니다.']];
  const found=[];
  const titleCache=new Map();
  const titlesFor=title=>{
    if(!titleCache.has(title))titleCache.set(title,[...document.querySelectorAll('h1,h2,h3,h4,p,div,span')].filter(el=>visible(el)&&text(el)===title&&!Array.from(el.children).some(c=>text(c)===title)));
    return titleCache.get(title);
  };
  for(const [kind,title,body,label='확인'] of notices){
    if((['train','route'].includes(kind)&&page!=='search')||(kind==='refund'&&page!=='reservation')||(kind==='paid'&&page!=='payment'))continue;
    if(kind==='duplicate_journey'&&!['search','reservation','reservation_list','payment'].includes(page))continue;
    const titles=titlesFor(title);
    for(const titleEl of titles){
      for(let scope=titleEl.parentElement;scope&&scope!==document.body;scope=scope.parentElement){
        if(['MAIN','HTML'].includes(scope.tagName)||text(scope).length>3500)break;
        let confirm=buttons(scope,label);
        if(kind==='duplicate_journey'){
          if(!text(scope).includes(body))continue;
          // Prefer the explicit continuation; some variants expose only 확인.
          if(!confirm.length)confirm=buttons(scope,'확인');
          const alternatives=[...scope.querySelectorAll('button,a,[role="button"]')].filter(visible);
          if(alternatives.some(el=>!['다른여정예약','예약내역확인','확인'].includes(text(el))))continue;
        }
        if(confirm.length===1&&text(scope).includes(body)){found.push({kind,button:confirm[0]});break;}
      }
    }
  }
  // Other informational train notices: only a single-confirm scope with no input or
  // alternative action. Never turn a transaction failure into a successful booking.
  if(page==='search'&&!found.length){
    const titles=titlesFor('이용안내');
    for(const title of titles){
      for(let scope=title.parentElement;scope&&scope!==document.body;scope=scope.parentElement){
        const body=text(scope);
        if(['MAIN','HTML'].includes(scope.tagName)||body.length>1200)break;
        const actions=[...scope.querySelectorAll('button,a,[role="button"]')].filter(visible);
        if(actions.length!==1||buttons(scope,'확인').length!==1)continue;
        if([...scope.querySelectorAll('input,select,textarea')].some(visible))break;
        if(/취소|환불|결제|매진|실패|오류|불가|없습니다|로그인|인증|동의/.test(body))break;
        // Store a bounded identifier only, not the full notice text.
        let hash=2166136261;for(const char of body)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
        found.push({kind:'info_'+hash.toString(16),button:actions[0]});break;
      }
    }
  }
  const unique=[...new Map(found.map(n=>[n.button,n])).values()];
  if(mode==='dismiss'){
    if(unique.length!==1||unique[0].kind!==notice)return fail('notice_mismatch');
    return click(unique[0].button);
  }
  if(unique.length>1)return fail('ambiguous_notice');
  if(unique.length)return mode==='inspect'?{ok:true,page,notice:unique[0].kind}:fail('notice_present');
  if(page==='login'||page==='search'||page==='unknown')return mode==='inspect'?{ok:true,page,match:false}:fail('wrong_page');
  // User-authorized policy: pay the current Korail payment screen. Do not gate
  // card entry/submission on train, class, seat, fare-card parsing, or total text.
  if(page==='payment'){
    if(mode==='inspect')return {ok:true,page,match:true,reservation:{source:'payment',deadline:null}};
    let label;
    if(mode==='chooseCard')label='카드결제';
    if(mode==='submitPayment'){
      if(!document.getElementById('option01')?.checked||!document.getElementById('check')?.checked||!document.getElementById('shuttle01')?.checked)return fail('card_not_ready');
      label='결제/발권';
    }
    if(!label)return fail('invalid_action');
    const choices=buttons(document,label);
    if(choices.length!==1)return fail('ambiguous_action');
    return click(choices[0]);
  }
  if(!candidate?.train?.key||!['일반실','특실'].includes(candidate.seatClass))return fail('invalid_target');
  const key=candidate.train.key,esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const [y,m,d]=key.date.split('-').map(Number);
  const datePattern=new RegExp(`${y}\\s*년\\s*0?${m}\\s*월\\s*0?${d}\\s*일`);
  const numberPattern=new RegExp(`(?:KTX(?:\\s*-?\\s*산천)?|ITX(?:\\s*-?\\s*(?:새마을|마음|청춘))?|무궁화(?:호)?)\\s*${esc(key.number)}(?!\\d)`);
  const routePattern=new RegExp(`${esc(key.departure)}\\s*(?:→|➜|->)\\s*${esc(key.arrival)}\\s*\\(\\s*${esc(key.time)}\\s*~`);
  // CSS margins can separate inline train/date/seat nodes visually while innerText
  // concatenates them. Preserve DOM text-node boundaries without reading form values.
  const bookingText=el=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),parts=[];
    let node;while((node=walker.nextNode())){
      if(node.parentElement&&!node.parentElement.closest('script,style,input,select,textarea')&&visible(node.parentElement))parts.push(node.textContent);
      if(parts.length>300)return '';
    }
    return norm(parts.join(' '));
  };
  const checks={date:false,train:false,route:false,grade:false,coach:false,seat:false};
  const blocks=[...document.querySelectorAll('div,section,article,li')].filter(visible).filter(el=>{
    const t=bookingText(el);
    if(t.length<=1800){
      checks.date ||= datePattern.test(t);checks.train ||= numberPattern.test(t);
      checks.route ||= routePattern.test(t);checks.grade ||= t.includes(candidate.seatClass);
      checks.coach ||= /\d{1,2}\s*호차/.test(t);checks.seat ||= /(?<![\dA-Z])\d{1,2}[A-F](?![\dA-Z])/.test(t);
    }
    if(t.length>1800||!datePattern.test(t)||!numberPattern.test(t)||(page!=='reservation_list'&&!t.includes(candidate.seatClass)))return false;
    if(page!=='tickets'&&!routePattern.test(t))return false;
    if(page==='tickets'&&(!t.includes(key.departure)||!t.includes(key.arrival)||!t.includes(key.time)||t.indexOf(key.departure)>=t.indexOf(key.arrival)))return false;
    if(page!=='reservation_list'&&(!/\d{1,2}\s*호차/.test(t)||!/(?<![\dA-Z])\d{1,2}[A-F](?![\dA-Z])/.test(t)))return false;
    if(['reservation','reservation_list'].includes(page)&&!t.includes('결제기한'))return false;
    const dates=[...t.matchAll(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/g)];
    return dates.length===1;
  });
  const minimal=blocks.filter(el=>!blocks.some(other=>other!==el&&el.contains(other)));
  if(minimal.length!==1)return mode==='inspect'?{ok:true,page,match:false,matchReason:'booking_block_mismatch',checks,matchingBlocks:minimal.length}:fail('target_mismatch');
  const target=minimal[0],t=bookingText(target);
  const coaches=[...t.matchAll(/(?<!\d)(\d{1,2})\s*호차/g)].map(a=>a[1]);
  const seats=[...t.matchAll(/(?<![\dA-Z])(\d{1,2}[A-F])(?![\dA-Z])/g)].map(a=>a[1]);
  if(page!=='reservation_list'&&(coaches.length!==1||seats.length!==1))return mode==='inspect'?{ok:true,page,match:false,matchReason:'ambiguous_seat'}:fail('ambiguous_seat');
  const seat={coach:coaches[0],seat:seats[0]};
  if(reservation&&reservation.source!=='reservation_list'&&reservation.source!=='payment'&&(seat.coach!==reservation.coach||seat.seat!==reservation.seat))return mode==='inspect'?{ok:true,page,match:false,matchReason:'seat_mismatch'}:fail('seat_mismatch');
  let result={ok:true,page,match:true};
  if(page==='reservation'||page==='reservation_list'){
    const deadline=t.match(/결제기한\s*:\s*(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*(\d{2}):(\d{2})/);
    if(!deadline)return fail('missing_deadline');
    const parts=deadline.slice(1).map(v=>v.padStart(2,'0'));
    const expires=Date.parse(`${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}:00+09:00`);
    if(!Number.isFinite(expires)||expires<=Date.now())return fail('reservation_expired');
    if(page==='reservation_list'&&!/(?:^|\s)1매(?:\s|$)/.test(t))return fail('unknown_passenger_count');
    result.reservation=page==='reservation_list'?{source:'reservation_list',deadline:expires}:{...seat,deadline:expires};
  }
  if(mode==='inspect')return result;
  if(!reservation||!Number.isFinite(reservation.deadline)||reservation.deadline<=Date.now())return fail('missing_or_expired_reservation');
  let label;
  if(mode==='openPayment'&&page==='reservation')label='결제하기';
  if(mode==='openPayment'&&page==='reservation_list')label='결제/발권';
  if(!label)return fail('invalid_action');
  const choices=buttons(page==='reservation_list'?target:document,label);
  if(choices.length!==1)return fail('ambiguous_action');
  return click(choices[0]);
}
