// One foreground transaction; all write intents survive page/window failure.
export async function checkout({candidate,card,site,store,signal,sleep,now=Date.now,
  actionDelay=0.1,transitionTimeout=30,pollInterval=0.2,ticketTimeout=60,onEvent=()=>{}}) {
  if(store.load()){onEvent({state:'existing_transaction'});return;}
  for(const n of [transitionTimeout,pollInterval,ticketTimeout])if(!Number.isFinite(n)||n<=0)throw new Error('invalid_timing');
  if(!Number.isFinite(actionDelay)||actionDelay<0)throw new Error('invalid_timing');
  let record=null,reservation=null,paid=false;
  const trace=[];
  let stage='before_selection';
  const note=(action,data={})=>{
    trace.push({action,...data,at:now()});if(trace.length>40)trace.shift();
    if(record){const next={...record,trace:[...trace],stage,updatedAt:now()};store.save(next);record=next;}
  };
  const check=()=>{if(signal.aborted)throw new Error('stopped');};
  const save=state=>{
    const next={version:1,candidate:{train:{key:candidate.train.key},seatClass:candidate.seatClass},
      state,reservation,updatedAt:now(),trace:[...trace],stage};
    store.save(next);record=next;onEvent({state});
  };
  const pause=async()=>{await sleep(actionDelay*1000,signal);check();};
  async function waitFor(page,seconds){
    const deadline=now()+seconds*1000;
    const seen=new Set();
    let previous='',lastPage='unknown',lastNotice=null;
    let pendingReserve=false,noticeCount=0,continued=false;
    while(now()<deadline){
      check();const s=await site.inspect(candidate,reservation);check();
      lastPage=s.page;
      const signature=s.page+':'+(s.notice||'');
      if(signature!==previous){note('observe',{page:s.page,notice:s.notice||null});previous=signature;}
      if(s.page==='login')throw new Error('login_required');
      if(s.notice){
        if(noticeCount>=8&&lastNotice!==s.notice)throw new Error('too_many_notices');
        if(seen.has(s.notice)){
          if(lastNotice!==s.notice)throw new Error('repeated_notice');
          await sleep(Math.min(pollInterval*1000,Math.max(0,deadline-now())),signal);continue;
        }
        if(s.notice==='paid'&&!paid)throw new Error('unexpected_payment_notice');
        seen.add(s.notice);noticeCount++;
        await site.dismiss(s.notice);
        if(page==='reservation'&&s.page==='search'&&s.notice==='train'&&!continued){
          stage='waiting_after_train_notice';pendingReserve=true;
        }
        note('dismiss',{notice:s.notice});lastNotice=s.notice;await pause();continue;
      }
      lastNotice=null;
      if(s.page===page||(page==='reservation'&&s.page==='payment'&&seen.has('duplicate_journey')))return s;
      // User-confirmed flow: this informational notice only closes itself.
      // Continue via the selected train's reserve button once per confirmed notice.
      if(page==='reservation'&&s.page==='search'&&pendingReserve){
        check();await site.verifySelected(candidate);check();
        const fresh=await site.inspect(candidate,reservation);check();
        if(fresh.page==='search'&&!fresh.notice){
          if(noticeCount>=8)throw new Error('too_many_notices');
          pendingReserve=false;continued=true;stage='continuing_after_train_notice';
          save('reservation_continuation_submitting');check();
          const result=await site.reserve(candidate);note('reserve_continuation_returned',{target:result?.target||null});
          // A new explicit reserve action may legitimately open the same notice.
          // Do not mistake it for the old dialog still fading out.
          seen.clear();lastNotice=null;
        }
      }
      if(!['search','reservation','payment','tickets'].includes(s.page))throw new Error('unknown_page');
      await sleep(Math.min(pollInterval*1000,Math.max(0,deadline-now())),signal);
    }
    throw new Error('timeout_'+page+'_from_'+lastPage);
  }
  try{
    await waitFor('search',transitionTimeout);
    stage='selecting';
    check();await site.select(candidate);await pause();
    stage='after_selection';
    // Selection itself can open route notices before the reserve button is clickable.
    await waitFor('search',transitionTimeout);
    await site.verifySelected(candidate);check();
    stage='submitting_reservation';save('reservation_submitting');check();const result=await site.reserve(candidate);
    stage='after_reserve_click';note('reserve_click_returned',{target:result?.target||null});
    const reserved=await waitFor('reservation',transitionTimeout);
    const directPayment=reserved.page==='payment'&&reserved.reservation?.source==='payment'&&reserved.reservation.deadline===null;
    if(!reserved.match||!reserved.reservation||(!directPayment&&(!Number.isFinite(reserved.reservation.deadline)||reserved.reservation.deadline<=now())))throw new Error('reservation_mismatch');
    reservation=reserved.reservation;save('reserved');check();
    if(!directPayment){await site.openPayment(candidate,reservation);await pause();}
    const payment=await waitFor('payment',transitionTimeout);
    if(!payment.match)throw new Error('payment_mismatch');
    check();await site.chooseCard(candidate,reservation);await pause();
    await site.fillCard(card);check();
    if(reservation.deadline!==null&&reservation.deadline<=now())throw new Error('reservation_expired');
    // Read the target again after form changes, before recording and submitting payment.
    const ready=await site.inspect(candidate,reservation);
    if(ready.page!=='payment'||!ready.match||ready.notice)throw new Error('payment_mismatch');
    check();save('payment_submitting');check();paid=true;
    await site.submitPayment(candidate,reservation);card=null;
    const ticket=await waitFor('tickets',ticketTimeout);
    if(!ticket.match)throw new Error('ticket_mismatch');
    save('complete');
  }catch(error){
    const state=record?'uncertain':signal.aborted?'stopped':'booking_rejected';
    // Do not overwrite a durable submission intent if later persistence/transport fails.
    onEvent({state,stage,trace:[...trace],blocker:error.blocker,reason:/^[a-z_]{1,60}$/.test(error.message)?error.message:'browser_operation_failed'});
  }finally{card=null;}
}
