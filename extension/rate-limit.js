// Shared by extension windows in the same profile; counts attempted list reloads.
export async function limitedReload({reload,storage=localStorage,locks=navigator.locks,
  signal,deadline=Infinity,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  const key='korail-query-times-v1';
  for(;;){
    if(signal?.aborted)throw new Error('stopped');
    if(now()>=deadline)throw new Error('rate_limit_timeout');
    const result=await locks.request('korail-query-rate',async()=>{
      if(signal?.aborted)throw new Error('stopped');
      const time=now();
      if(time>=deadline)throw new Error('rate_limit_timeout');
      const history=JSON.parse(storage.getItem(key)||'[]');
      if(!Array.isArray(history)||history.some(t=>!Number.isFinite(t)))throw new Error('invalid_rate_history');
      const recent=history.filter(t=>t>=time-60000).sort((a,b)=>a-b);
      if(recent.length>=100)return {wait:Math.max(1,recent[recent.length-100]+60001-time)};
      storage.setItem(key,JSON.stringify([...recent,time]));
      await reload();return {done:true};
    });
    if(result.done)return;
    await sleep(Math.min(result.wait,Math.max(0,deadline-now())),signal);
  }
}
