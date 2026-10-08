import {nativeHost} from './native-input.js';

// One process/port per macro run; one outstanding request, never automatic replay.
export function createNativeSession(api=chrome,timeoutMs=3000){
  const port=api.runtime.connectNative(nativeHost);
  let pending=null,closed=false;
  const rejectPending=()=>{
    if(pending){clearTimeout(pending.timer);pending.reject(new Error('native_transport_lost'));pending=null;}
  };
  port.onMessage.addListener(reply=>{
    if(!pending)return;
    const item=pending;pending=null;clearTimeout(item.timer);item.resolve(reply);
  });
  port.onDisconnect.addListener(()=>{void api.runtime.lastError;closed=true;rejectPending();});
  const close=()=>{if(!closed){closed=true;rejectPending();port.disconnect();}};
  const send=message=>new Promise((resolve,reject)=>{
    if(closed){reject(new Error('native_transport_lost'));return;}
    if(pending){reject(new Error('native_transport_busy'));return;}
    const timer=setTimeout(()=>{close();},timeoutMs);
    pending={resolve,reject,timer};
    try{port.postMessage(message);}catch{close();}
  });
  return {send,close};
}
