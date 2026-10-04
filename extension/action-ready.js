// Retry only an explicit pre-click occlusion result. A transport error or a
// successful click may have submitted a transaction and must never be replayed.
export async function readyAction({run,signal,sleep,now=Date.now,timeoutMs=3000}) {
  const deadline=now()+timeoutMs;
  for(;;) {
    if(signal?.aborted)throw new Error('stopped');
    const result=await run();
    if(result?.ok)return result;
    if(result?.code!=='covered_action'||now()>=deadline){const error=new Error(result?.code||'action_failed');if(result?.code==='covered_action')error.blocker=result.blocker;throw error;}
    await sleep(Math.min(100,Math.max(0,deadline-now())),signal);
  }
}
