// A timed-out browser call is ambiguous: never retry it automatically.
// This bounds the caller's wait; it cannot cancel work already sent to Chrome.
export async function boundedCall(run,timeoutMs=10000){
  let timer;
  try{return await Promise.race([
    Promise.resolve().then(run),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('browser_operation_timeout')),timeoutMs);})
  ]);}finally{clearTimeout(timer);}
}
