import {boundedCall} from './browser-call.js';

export function readPageFocus(){
  return {focused:document.hasFocus(),visibility:document.visibilityState};
}

export async function focusSourceTab({tabId,api=chrome,readFocus,sleep,signal,now=Date.now}){
  const check=()=>{if(signal?.aborted)throw new Error('stopped');};
  check();const tab=await boundedCall(()=>api.tabs.get(tabId),2000);check();
  if(!Number.isInteger(tab?.windowId))throw new Error('source_window_missing');
  if(api.windows.get){const window=await boundedCall(()=>api.windows.get(tab.windowId),2000);check();
    if(window.state==='minimized'){await boundedCall(()=>api.windows.update(tab.windowId,{state:'normal'}),2000);check();}}
  await boundedCall(()=>api.tabs.update(tabId,{active:true}),2000);check();
  await boundedCall(()=>api.windows.update(tab.windowId,{focused:true}),2000);check();
  const deadline=now()+5000;let retryAt=now()+1000,lastState=null;
  while(now()<deadline){
    check();const state=await boundedCall(readFocus,2000);check();
    lastState=state;
    if(state?.focused&&state.visibility==='visible')return state;
    if(now()>=retryAt){await boundedCall(()=>api.tabs.update(tabId,{active:true}),2000);check();await boundedCall(()=>api.windows.update(tab.windowId,{focused:true}),2000);check();retryAt=now()+1000;}
    await sleep(Math.min(100,Math.max(0,deadline-now())),signal);
  }
  const error=new Error('source_focus_timeout');
  error.trace=[{action:'focus_timeout',at:now(),focused:lastState?.focused===true,visibility:lastState?.visibility}];
  if(api.windows.get)try{const window=await boundedCall(()=>api.windows.get(tab.windowId),1000);error.trace.push({action:'window_focus',focused:window.focused===true,windowState:window.state});}catch{}
  throw error;
}
