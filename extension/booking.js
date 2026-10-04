// Persist intent before every irreversible action. No automatic replay after restart.
export function transactionStore(storage) {
  const key='korail-transaction-v1';
  return {
    load() {
      const raw=storage.getItem(key);
      if(raw===null)return null;
      const data=JSON.parse(raw);
      if(data?.version!==1 || !data.state || !data.candidate?.train?.key)throw new Error('invalid_journal');
      return data;
    },
    save(data) {storage.setItem(key,JSON.stringify({...data,version:1}));},
    resetForStart() {storage.removeItem(key);},
    archiveReviewed() {
      const data=this.load();if(!data)return;
      // Preserve evidence before releasing the block; no cancellation or payment action.
      storage.setItem('korail-transaction-reviewed-v1',JSON.stringify(data));
      storage.removeItem(key);
    },
  };
}

export async function bookCandidate({candidate,site,store,signal,sleep,now=Date.now,
  actionDelay=2,transitionTimeout=30,pollInterval=1,onEvent=()=>{}}) {
  if(!Number.isFinite(actionDelay)||actionDelay<0 || !Number.isFinite(transitionTimeout)||transitionTimeout<=0 ||
     !Number.isFinite(pollInterval)||pollInterval<=0)throw new Error('invalid_booking_timing');
  if(store.load()) {onEvent({state:'existing_transaction'});return;}
  let record=null;
  const check=()=>{if(signal.aborted)throw new Error('stopped');};
  const save=state=>{
    record={candidate:{train:{key:candidate.train.key},seatClass:candidate.seatClass},
      state,updatedAt:now()};
    store.save(record);onEvent({state});
  };
  try {
    check();await site.select(candidate);check();
    await sleep(actionDelay*1000,signal);check();
    await site.verifySelected(candidate);check();
    save('reservation_submitting');check();
    await site.reserve(candidate);
    const deadline=now()+transitionTimeout*1000;
    while(now()<deadline) {
      check();const state=await site.inspect();check();
      if(state.page==='login') {save('login_required');return;}
      if(state.page==='reservation') {save('reservation_needs_verification');return;}
      if(state.page==='payment'||state.page==='tickets') {save('reconciliation_required');return;}
      if(state.notices?.length) {save('notice_requires_review');return;}
      await sleep(Math.min(pollInterval*1000,Math.max(0,deadline-now())),signal);
    }
    save('uncertain');
  } catch(error) {
    // Keep the saved intent even if a save fails; never attempt the request again here.
    onEvent({state:record?'uncertain':signal.aborted?'stopped':'booking_rejected',reason:error.message});
  }
}
