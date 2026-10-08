import {boundedCall} from './browser-call.js';
import {focusSourceTab,readPageFocus} from './focus-tab.js';

export const nativeHost='com.korail.personal_input';

export async function nativePing(api=chrome,send=message=>api.runtime.sendNativeMessage(nativeHost,message)){
  let response;
  try{response=await boundedCall(()=>send({action:'ping'}),3000);}
  catch{throw new Error('native_host_unavailable');}
  if(!response?.ok||response.version!==2)throw new Error('native_host_version');
}

// Executed in the same isolated world as the validated DOM adapter. No card data.
export function prepareNativePoint(token){
  if(location.origin!=='https://www.korail.com'||!/^korail-input-[a-f0-9]{32}$/.test(token))return {ok:false,code:'native_target_invalid'};
  const item=window.__korailNativeTarget,el=item?.element;
  if(!el?.isConnected||item.path!==location.pathname||!document.hasFocus()||document.visibilityState!=='visible')return {ok:false,code:'native_target_changed'};
  const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
  const top=document.elementFromPoint(x,y);
  if(!top||!(top===el||el.contains(top))||el.matches(':disabled')||el.getAttribute('aria-disabled')==='true'||x<0||y<0||x>=innerWidth||y>=innerHeight)return {ok:false,code:'native_target_changed'};
  if(window.__korailNativeTitle?.token!==token)window.__korailNativeTitle={token,title:document.title,path:location.pathname};
  document.title=token;
  return {ok:true,message:{action:'click',token,x,y,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,sentAt:Date.now()}};
}

export function restoreNativeTitle(token){
  const item=window.__korailNativeTitle;
  if(item?.token===token&&item.path===location.pathname&&document.title===token)document.title=item.title;
  delete window.__korailNativeTitle;delete window.__korailNativeTarget;
}

export async function nativeAction({run,execute,tabId,sleep,signal,fast=false,api=chrome,send=message=>api.runtime.sendNativeMessage(nativeHost,message)}){
  const started=performance.now();
  const check=()=>{if(signal?.aborted)throw new Error('stopped');};
  check();
  let result=await run();check();
  if(!result?.ok||!result.native)return result;
  if(fast){
    const focus=await execute(readPageFocus,[],2000);check();
    if(!focus?.focused||focus.visibility!=='visible'){
      await focusSourceTab({tabId,api,readFocus:()=>execute(readPageFocus,[],2000),sleep,signal});
      check();result=await run();check();
    }
  }else{
    await focusSourceTab({tabId,api,readFocus:()=>execute(readPageFocus,[],2000),sleep,signal});
    // Focus can take time; revalidate train/seat/page semantics before coordinates.
    check();result=await run();check();
  }
  if(!result?.ok||!result.native)return result;
  const token='korail-input-'+crypto.randomUUID().replaceAll('-','');
  try{
    let prepared=await execute(prepareNativePoint,[token],2000);
    if(!prepared?.ok)throw new Error(prepared?.code||'native_target_changed');
    // Let Chrome update its window title before the native host checks identity.
    if(!fast)await sleep(120,signal);check();
    let reply;
    try{reply=await boundedCall(()=>send(prepared.message),3000);}
    catch{throw new Error('native_input_unknown');} // Never replay a possibly delivered click.
    if(reply?.code==='native_window_mismatch'&&reply.inputDispatched===false){
      // Host explicitly confirms zero input. Refocus/revalidate once, never loop.
      check();await focusSourceTab({tabId,api,readFocus:()=>execute(readPageFocus,[],2000),sleep,signal});
      check();result=await run();check();if(!result?.ok||!result.native)return result;
      prepared=await execute(prepareNativePoint,[token],2000);
      if(!prepared?.ok)throw new Error(prepared?.code||'native_target_changed');
      if(!fast)await sleep(120,signal);check();
      try{reply=await boundedCall(()=>send(prepared.message),3000);}
      catch{throw new Error('native_input_unknown');}
    }
    if(!reply?.ok)throw new Error(reply?.code||'native_input_failed');
    return {...result,native:undefined,input:'windows_mouse',clickDispatched:true,inputMs:Math.round(performance.now()-started)};
  }finally{try{await execute(restoreNativeTitle,[token],1500);}catch{} }
}
