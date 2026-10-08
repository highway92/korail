// Pure monitoring loop. No reservation or payment actions.
import {parseSnapshot} from './parser.js';

export function validateSettings(s) {
  for (const k of ['interval','timeout','errorDelay','errorMultiplier','errorMax']) {
    if (typeof s[k]!=='number' || !Number.isFinite(s[k]) || s[k]<=0) throw new Error('invalid_settings');
  }
  if (s.interval<0.5 || s.timeout<1 || s.timeout>120 || s.errorMultiplier<1 || s.errorMax<s.errorDelay) throw new Error('invalid_settings');
  if (!Array.isArray(s.targets) || !s.targets.length || new Set(s.targets).size!==s.targets.length ||
      !Array.isArray(s.classes) || !s.classes.length || s.classes.some(c=>!['일반실','특실'].includes(c))) throw new Error('invalid_targets');
  if (!Array.isArray(s.preference) || (s.preference.length && (s.preference.length!==s.targets.length ||
      new Set(s.preference).size!==s.targets.length || s.preference.some(id=>!s.targets.includes(id))))) throw new Error('invalid_preference');
  return s;
}

export function chooseCandidate(trains,s,random=Math.random) {
  const eligible=trains.filter(t=>s.targets.includes(t.id) && t.availableClasses.some(c=>s.classes.includes(c)));
  if (!eligible.length) return null;
  // Pick the train before the class: two available classes do not double its weight.
  const train=s.preference.length ? eligible.sort((a,b)=>s.preference.indexOf(a.id)-s.preference.indexOf(b.id))[0]
    :eligible[Math.floor(random()*eligible.length)];
  const classes=train.availableClasses.filter(c=>s.classes.includes(c));
  return {train,seatClass:classes[Math.floor(random()*classes.length)]};
}

export async function monitor({baseline,settings,refresh,read,sleep,signal,onEvent=()=>{},random=Math.random}) {
  validateSettings(settings);
  let snapshot=baseline,queries=0,errors=0;
  const emit=(state,extra={})=>onEvent({state,queries,errors,...extra});
  const stopped=()=>signal.aborted;
  const checkConditions=data=>{
    if (!data?.ok || ['date','departure','arrival','passengers'].some(k=>data.conditions?.[k]!==baseline.conditions?.[k])) throw new Error('conditions_changed');
  };
  const check=data=>{
    checkConditions(data);
    if (data.status!=='readable' || data.truncated) throw new Error('unreadable');
    const trains=parseSnapshot(data).trains;
    if (settings.targets.some(id=>!trains.some(t=>t.id===id))) throw new Error('missing_targets');
    return trains;
  };
  const wait=async seconds=>{
    await sleep(seconds*1000,signal);
  };
  try {
    if(stopped()) {emit('stopped');return;}
    snapshot=await read();
    let trains=check(snapshot);
    for (;;) {
      if (stopped()) break;
      const candidate=chooseCandidate(trains,settings,random);
      if (candidate) {emit('found',{candidate});return;}
      emit('waiting',{delay:settings.interval,trains});
      await wait(settings.interval);
      if (stopped()) break;
      try {
        // Re-read before reloading, so manual navigation or changed conditions stop the loop.
        snapshot=await read();
        if (stopped()) break;
        checkConditions(snapshot);
        // A prior refresh can leave an empty result. Retry without labeling it sold out.
        trains=snapshot.status==='readable'?check(snapshot):[];
        const current=chooseCandidate(trains,settings,random);
        if (current) {emit('found',{candidate:current});return;}
        queries++;emit('querying');
        const result=await refresh(snapshot,settings.timeout*1000,signal);
        if (stopped()) break;
        if (!result.ok) throw new Error(result.code);
        snapshot=result.snapshot;trains=check(snapshot);errors=0;
      } catch (error) {
        if (stopped()) break;
        if (['conditions_changed','page_changed','missing_targets','wrong_page'].includes(error.message)) throw error;
        errors++;
        const delay=Math.min(settings.errorMax,settings.errorDelay*settings.errorMultiplier**(errors-1));
        emit('retry_wait',{delay,reason:error.message});
        await wait(delay);
      }
    }
    emit('stopped');
  } catch(error) {
    emit(signal.aborted?'stopped':'needs_attention',{reason:error.message});
  }
}
