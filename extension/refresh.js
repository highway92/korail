// Exactly one browser reload. Poll only the DOM after it; no reservation actions.
export async function probeRefresh({baseline,timeoutMs,pollMs=1000,reload,read,sleep,now=Date.now,signal}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs<1000 || timeoutMs>120000 ||
      !Number.isFinite(pollMs) || pollMs<100 || !Number.isFinite(baseline?.documentEpoch)) throw new Error('invalid_probe');
  const deadline=now()+timeoutMs;
  if (signal?.aborted) return {ok:false,code:'stopped'};
  await reload();
  let last=null;
  while(now()<deadline) {
    if (signal?.aborted) return {ok:false,code:'stopped'};
    await sleep(Math.min(pollMs,Math.max(0,deadline-now())));
    if (signal?.aborted) return {ok:false,code:'stopped'};
    try {last=await read();} catch {continue;}
    if (!last?.ok) {
      if (last?.code==='wrong_page') return {ok:false,code:'page_changed'};
      continue;
    }
    if (!Number.isFinite(last.documentEpoch) || last.documentEpoch===baseline.documentEpoch) continue;
    if (['date','departure','arrival','passengers'].some(k=>last.conditions[k]!==baseline.conditions[k])) {
      return {ok:false,code:'conditions_changed',snapshot:last};
    }
    if (last.status==='readable' && !last.truncated) return {ok:true,snapshot:last};
  }
  return {ok:false,code:'timeout',snapshot:last?.ok?last:null};
}
