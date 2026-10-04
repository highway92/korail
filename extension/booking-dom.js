// Serialized into the granted Korail tab. Validate identity and availability again at click time.
export function searchAction({mode,key,seatClass}) {
  const fail=code=>({ok:false,code});
  const covered=el=>({ok:false,code:'covered_action',blocker:el?{tag:el.tagName.toLowerCase(),classes:[...el.classList].filter(s=>/^[a-zA-Z_][a-zA-Z0-9_-]{0,60}$/.test(s)).slice(0,8)}:null});
  const text=el=>(el?.textContent||'').replace(/\s+/g,' ').trim();
  const visible=el=>{
    if(!el || !el.getClientRects().length)return false;
    for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}
    return true;
  };
  if(location.origin!=='https://www.korail.com'||location.pathname!=='/ticket/search/list')return fail('wrong_page');
  if(!['select','verify','reserve'].includes(mode)||!['일반실','특실'].includes(seatClass))return fail('invalid_action');
  const value=id=>document.getElementById(id)?.value;
  if(value('startDate')?.slice(0,10)!==key.date || value('labelstart')!==key.departure ||
    value('labelend')!==key.arrival || value('labelple')?.replace(/\s/g,'')!=='총1명')return fail('conditions_changed');
  const rows=[...document.querySelectorAll('.tckWrap li.tckList')].filter(row=>{
    const route=row.querySelector('.info_inner h3.txt_bk');
    const spans=route?[...route.children].filter(el=>el.tagName==='SPAN'):[];
    const times=text(spans[2]).match(/^\(\s*(\d{2}:\d{2})\s*~\s*\d{2}:\d{2}\s*\)$/);
    return visible(row)&&text(row.querySelector('.info_inner .num'))===key.number&&spans.length===3&&
      text(spans[0])===key.departure&&text(spans[1])===key.arrival&&times?.[1]===key.time;
  });
  if(rows.length!==1)return fail('ambiguous_train');
  const cells=rows[0].querySelectorAll('.price_box');
  if(cells.length!==2)return fail('unknown_seats');
  const cell=cells[seatClass==='일반실'?0:1];
  if(!visible(cell)||cell.classList.contains('sold_out')||cell.classList.contains('yms')||
    !cell.classList.contains(seatClass==='일반실'?'gen':'spe')||/입석|자유석|예약대기/.test(text(cell)))return fail('seat_unavailable');
  const labels=cell.querySelectorAll('.txt_ch'),prices=cell.querySelectorAll('.txt_price');
  if(labels.length!==1||prices.length!==1||!new RegExp('^'+seatClass+'(?:\\([^)]*\\))?$').test(text(labels[0])))return fail('unknown_fare');
  let amount=text(prices[0]);
  if(/^(?:운임)?\d{1,2}% 할인$/.test(amount)) {
    const fares=[...cell.querySelectorAll('.txt_gr')].filter(el=>/^(?:\d{1,3}(?:,\d{3})*|\d+)원$/.test(text(el)));
    amount=fares.length===1?text(fares[0]):'';
  }
  if(!/^(?:\d{1,3}(?:,\d{3})*|\d+)원$/.test(amount)||Number(amount.replace(/[,원]/g,''))<=0)return fail('unknown_fare');
  if(mode==='select'&&!cell.classList.contains('active')) {
    const anchors=[...cell.querySelectorAll('a')].filter(visible);
    if(anchors.length!==1||anchors[0].getAttribute('aria-disabled')==='true')return fail('ambiguous_seat_action');
    anchors[0].scrollIntoView({block:'center',behavior:'instant'});
    const rect=anchors[0].getBoundingClientRect(),top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    if(!top||!(top===anchors[0]||anchors[0].contains(top)))return covered(top);
    anchors[0].click();return {ok:true};
  }
  const selected=[...document.querySelectorAll('.tckWrap .price_box.active')];
  if(selected.length!==1||selected[0]!==cell)return fail('selection_mismatch');
  if(mode==='reserve') {
    const buttons=[...document.querySelectorAll('button.btn_bn-blue02.reservbtn:not(.path_button)')].filter(el=>visible(el)&&text(el)==='예매'&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    if(buttons.length!==1)return fail('ambiguous_reserve_action');
    // Reject a button covered by a modal instead of clicking through it.
    buttons[0].scrollIntoView({block:'center',behavior:'instant'});
    const rect=buttons[0].getBoundingClientRect(),top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    if(!top||!(top===buttons[0]||buttons[0].contains(top)))return covered(top);
    const target={tag:'button',classes:['btn_bn-blue02','reservbtn'],text:'예매'};
    buttons[0].click();return {ok:true,target};
  }
  return {ok:true};
}

// Compact structural diagnostics: no input values, full body text, ticket numbers or QR data.
export function inspectBookingPage() {
  const paths={'/ticket/search/list':'search','/ticket/login':'login','/ticket/reservation/detail':'reservation',
    '/ticket/payment/payment':'payment','/ticket/myticket/list':'tickets'};
  if(location.origin!=='https://www.korail.com'||!paths[location.pathname])return {page:'unknown'};
  const page=paths[location.pathname];
  if(page==='login')return {page};
  const compact=t=>t.replace(/\s+/g,' ').trim();
  const visible=el=>{
    if(!el.getClientRects().length)return false;
    for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}
    return true;
  };
  const allowed=new Set(['예매','확인','다른여정예약','예약내역확인','결제하기','카드결제','개인카드','결제/발권','동의함','코레일 앱(스마트티켓)으로 발권']);
  const safe=s=>/^[a-zA-Z_][a-zA-Z0-9_-]{0,60}$/.test(s)?s:'';
  const shape=el=>({tag:el.tagName.toLowerCase(),id:safe(el.id),classes:[...el.classList].map(safe).filter(Boolean).slice(0,12)});
  const actions=[...document.querySelectorAll('button,a,label,[role="button"]')].filter(el=>visible(el)&&allowed.has(compact(el.textContent||''))).slice(0,30)
    .map(el=>({...shape(el),text:compact(el.textContent),disabled:el.matches(':disabled')||el.getAttribute('aria-disabled')==='true'}));
  const known=['안내 메시지','이용안내','환불(반환) 위약금 안내','결제가 완료되었습니다.'];
  const notices=known.filter(s=>[...document.querySelectorAll('h1,h2,h3,h4,p,div,span')].some(el=>
    el.children.length===0&&visible(el)&&compact(el.textContent||'')===s));
  const fields=page==='payment'?[...document.querySelectorAll('input,select')].filter(el=>visible(el)&&el.type!=='hidden').slice(0,40)
    .map(el=>({...shape(el),type:el.type,labels:[...(el.labels||[])].map(l=>compact(l.textContent||'')).filter(t=>
      /^(?:신용카드 번호|유효기간 월\/년|인증번호|할부개월|신용카드 비밀번호|동의함|개인카드|법인카드|코레일 앱\(스마트티켓\)으로 발권)$/.test(t))})):[];
  return {page,path:location.pathname,actions,notices,fields};
}
