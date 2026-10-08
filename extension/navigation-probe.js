// Run in MAIN solely to observe page window.open calls. Preserves arguments,
// return value, exceptions and default event behavior; never opens a window itself.
export function navigationProbe({mode='read'}={}){
  if(location.origin!=='https://www.korail.com')return {ok:false,code:'wrong_origin'};
  const key='korail-navigation-probe-v1',slot='__korailNavigationProbe';
  const paths=new Set(['/ticket/search/list','/ticket/reservation/detail','/ticket/reservation/list','/ticket/payment/payment','/ticket/myticket/list','/ticket/login']);
  const path=()=>paths.has(location.pathname)?location.pathname:'other';
  const environment=()=>({path:path(),focused:document.hasFocus(),visibility:document.visibilityState,userActivation:!!navigator.userActivation?.isActive});
  if(mode==='read'||mode==='stop'){
    if(mode==='stop')window[slot]?.stop();
    try{const data=JSON.parse(sessionStorage.getItem(key)||'null');
      if(!data||Date.now()>data.expires){sessionStorage.removeItem(key);return {ok:true,...environment(),events:[]};}
      return {ok:true,...environment(),events:data.events};
    }catch{return {ok:false,code:'probe_unavailable'};}
  }
  if(mode!=='start'||path()!=='/ticket/search/list')return {ok:false,code:'wrong_page'};
  window[slot]?.stop();
  const data={expires:Date.now()+120000,events:[]};
  const record=details=>{
    data.events.push({...details,...environment(),at:Date.now()});if(data.events.length>30)data.events.shift();
    try{sessionStorage.setItem(key,JSON.stringify(data));}catch{}
  };
  const original=window.open;
  function observedOpen(...args){
    if(path()!=='/ticket/search/list')return Reflect.apply(original,this,args);
    let result;
    try{result=Reflect.apply(original,this,args);}catch(error){record({event:'window_open',outcome:'threw'});throw error;}
    // null can also result from noopener, so this alone does not prove blocking.
    record({event:'window_open',outcome:result===null?'null_return':'window_return'});
    return result;
  }
  const leaving=()=>record({event:'pagehide'});
  const submit=e=>{if(path()==='/ticket/search/list')setTimeout(()=>record({event:'form_submit',prevented:e.defaultPrevented,trusted:e.isTrusted}),0);};
  const timer=setTimeout(()=>window[slot]?.stop(),120000);
  const stop=()=>{
    clearTimeout(timer);if(window.open===observedOpen)window.open=original;
    window.removeEventListener('pagehide',leaving);document.removeEventListener('submit',submit,true);
    delete window[slot];
  };
  window[slot]={stop};window.open=observedOpen;
  window.addEventListener('pagehide',leaving);document.addEventListener('submit',submit,{capture:true,passive:true});
  record({event:'start'});return {ok:true};
}
