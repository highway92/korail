// Passive, short-lived diagnostic for public search controls only. Never clicks,
// reads form values, or records payment/login-page interactions.
export function clickProbe({mode='read'}={}) {
  const key='korail-public-click-probe-v1',slot='__korailPublicClickProbe';
  const allowedPaths=['/ticket/search/list','/ticket/reservation/detail','/ticket/reservation/list','/ticket/payment/payment','/ticket/login','/ticket/myticket/list'];
  if(location.origin!=='https://www.korail.com'||!allowedPaths.includes(location.pathname))return {ok:false,code:'wrong_page'};
  const stop=()=>{window[slot]?.stop();delete window[slot];};
  if(mode==='stop'){stop();sessionStorage.removeItem(key);return {ok:true};}
  if(mode==='read'){
    const raw=sessionStorage.getItem(key);
    if(!raw)return {ok:true,path:location.pathname,events:[]};
    try {const data=JSON.parse(raw);if(Date.now()>data.expires){stop();sessionStorage.removeItem(key);return {ok:true,path:location.pathname,events:[],expired:true};}
      return {ok:true,path:location.pathname,events:data.events};
    }catch{return {ok:false,code:'invalid_probe'};}
  }
  if(mode!=='start'||location.pathname!=='/ticket/search/list')return {ok:false,code:'wrong_page'};
  stop();
  const data={expires:Date.now()+120000,events:[]};
  const persist=()=>sessionStorage.setItem(key,JSON.stringify(data));
  persist();
  const labels=new Set(['예매','확인','다른여정예약','예약내역확인']);
  const safe=s=>/^[a-zA-Z_][a-zA-Z0-9_-]{0,60}$/.test(s)?s:'';
  const shape=el=>({tag:el.tagName.toLowerCase(),id:safe(el.id),classes:[...el.classList].map(safe).filter(Boolean).slice(0,8)});
  const handler=e=>{
    if(Date.now()>data.expires||location.pathname!=='/ticket/search/list'){stop();return;}
    const el=e.target instanceof Element?e.target.closest('button,a,[role="button"]'):null;
    const label=(el?.textContent||'').replace(/\s+/g,' ').trim();
    if(!el||!labels.has(label))return;
    const parents=[];for(let p=el.parentElement;p&&parents.length<3;p=p.parentElement)parents.push(shape(p));
    data.events.push({event:e.type,trusted:e.isTrusted,target:{...shape(el),text:label},parents,at:Date.now()});
    if(data.events.length>40)data.events.shift();
    try{persist();}catch{stop();}
  };
  const types=['pointerdown','pointerup','click'];
  const timer=setTimeout(stop,120000);
  window[slot]={stop:()=>{clearTimeout(timer);for(const type of types)document.removeEventListener(type,handler,true);}};
  for(const type of types)document.addEventListener(type,handler,{capture:true,passive:true});
  return {ok:true};
}
