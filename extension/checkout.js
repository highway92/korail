import {pageReadiness} from './page-readiness.js';
// One foreground transaction; all write intents survive page/window failure.
export async function checkout({candidate,card,site,store,signal,sleep,now=Date.now,
  actionDelay=0.1,noticeDelay=0,transitionTimeout=30,pollInterval=0.2,ticketTimeout=60,
  resume=null,competitionDelay=actionDelay,competitionPollInterval=pollInterval,onEvent=()=>{}}) {
  if(store.load()){onEvent({state:'existing_transaction'});return;}
  for(const n of [transitionTimeout,pollInterval,ticketTimeout])if(!Number.isFinite(n)||n<=0)throw new Error('invalid_timing');
  if(!Number.isFinite(actionDelay)||actionDelay<0||!Number.isFinite(noticeDelay)||noticeDelay<0||!Number.isFinite(competitionDelay)||competitionDelay<0||!Number.isFinite(competitionPollInterval)||competitionPollInterval<=0)throw new Error('invalid_timing');
  let record=null,reservation=null,paid=false,competing=true;
  const trace=[];
  let stage='before_selection';
  const note=(action,data={})=>{
    trace.push({action,...data,at:now()});if(trace.length>40)trace.shift();
    onEvent({state:'progress',stage,action,trace:[...trace]});
    if(record){const next={...record,trace:[...trace],stage,updatedAt:now()};store.save(next);record=next;}
  };
  const check=()=>{if(signal.aborted)throw new Error('stopped');};
  const save=state=>{
    const next={version:1,candidate:{train:{key:candidate.train.key},seatClass:candidate.seatClass},
      state,reservation,updatedAt:now(),trace:[...trace],stage};
    store.save(next);record=next;onEvent({state});
  };
  const pause=async()=>{const delay=competing?competitionDelay:actionDelay;if(delay)await sleep(delay*1000,signal);check();};
  async function waitFor(page,seconds){
    const deadline=now()+seconds*1000;
    const seen=new Set();
    let previous='',lastPage='unknown',lastNotice=null,lastExpected=null;
    let noticeCount=0;
    while(now()<deadline){
      check();const s=await site.inspect(candidate,reservation);check();
      if(['reservation','reservation_list','payment','tickets'].includes(s.page))competing=false;
      const pollMs=(competing?competitionPollInterval:pollInterval)*1000;
      lastPage=s.page;
      const signature=s.page+':'+(s.notice||'')+':'+s.match+':'+(s.matchReason||'');
      if(signature!==previous){note('observe',{page:s.page,notice:s.notice||null,match:s.match,matchReason:s.matchReason,checks:s.checks,matchingBlocks:s.matchingBlocks});previous=signature;}
      if(s.page==='login')throw new Error('login_required');
      if(s.notice){
        if(noticeCount>=8&&lastNotice!==s.notice)throw new Error('too_many_notices');
        if(seen.has(s.notice)){
          if(lastNotice!==s.notice)throw new Error('repeated_notice');
          await sleep(Math.min(pollMs,Math.max(0,deadline-now())),signal);continue;
        }
        if(s.notice==='paid'&&!paid)throw new Error('unexpected_payment_notice');
        seen.add(s.notice);noticeCount++;
        const delay=competing?competitionDelay:noticeDelay;
        if(delay){await sleep(Math.min(delay*1000,Math.max(0,deadline-now())),signal);check();if(now()>=deadline)break;}
        const dismissed=await site.dismiss(s.notice);
        note('dismiss',{notice:s.notice,target:dismissed?.target||null,input:dismissed?.input||'click',clickDispatched:dismissed?.clickDispatched,inputMs:dismissed?.inputMs});lastNotice=s.notice;await pause();continue;
      }
      lastNotice=null;
      const readiness=pageReadiness(page,s);
      if(readiness!=='other'){
        if(readiness==='ready')return s;
        lastExpected=s; // URL can change before its booking card has rendered.
      }else lastExpected=null;
      if(!['search','reservation','reservation_list','payment','tickets'].includes(s.page))throw new Error('unknown_page');
      await sleep(Math.min(pollMs,Math.max(0,deadline-now())),signal);
    }
    if(lastExpected)return lastExpected; // Preserve mismatch outcome, never submit it.
    throw new Error('timeout_'+page+'_from_'+lastPage);
  }
  try{
    let reserved=resume;
    if(!resume){
    note('inspect_start');
    await waitFor('search',transitionTimeout);
    stage='selecting';note('select_start');
    check();const selected=await site.select(candidate);note('select_returned',{input:selected?.input,inputMs:selected?.inputMs});await pause();
    stage='after_selection';
    // Selection itself can open route notices before the reserve button is clickable.
    await waitFor('search',transitionTimeout);
    note('verify_selection');
    const selectionDeadline=now()+1000;
    for(;;){
      check();
      try{await site.verifySelected(candidate);check();break;}
      catch(error){
        if(error.message!=='selection_mismatch'||now()>=selectionDeadline)throw error;
        // Read-only recheck: never toggle the seat or submit again.
        await sleep(Math.min(50,Math.max(0,selectionDeadline-now())),signal);
      }
    }
    stage='submitting_reservation';save('reservation_submitting');check();const result=await site.reserve(candidate);
    stage='after_reserve_click';note('reserve_click_returned',{target:result?.target||null,input:result?.input||'click',clickDispatched:result?.clickDispatched,inputMs:result?.inputMs});
    try{reserved=await waitFor('reservation',transitionTimeout);}
    catch(error){
      if(error.message!=='timeout_reservation_from_search'||!site.openReservationList)throw error;
      check();stage='checking_reservation_list';save('checking_reservation_list');
      await site.openReservationList();check();
      reserved=await waitFor('reservation_list',transitionTimeout);
    }
    }
    const directPayment=reserved.page==='payment';
    if(!directPayment&&(!reserved.match||!reserved.reservation||!Number.isFinite(reserved.reservation.deadline)||reserved.reservation.deadline<=now()))throw new Error('reservation_mismatch');
    reservation=directPayment?{source:'payment',deadline:null}:reserved.reservation;save('reserved');check();
    stage='opening_payment';
    if(!directPayment){
      // Only a confirmed pre-click obstruction can enter notice handling and retry.
      let opened=false;
      for(let attempt=0;attempt<2&&!opened;attempt++){
        check();
        const current=await waitFor('reservation',transitionTimeout);
        if(current.page==='payment'){opened=true;break;}
        try{await site.openPayment(candidate,reservation);opened=true;}
        catch(error){
          if(!['covered_action','notice_present'].includes(error.message)||attempt===1)throw error;
          note('payment_entry_obstructed',{notice:error.message});
          // Next pass observes and dismisses a known notice before touching the button.
        }
      }
      await pause();
    }
    stage='checking_payment';
    await waitFor('payment',transitionTimeout);
    // Once this execution reaches payment, pay that page without identity comparisons.
    reservation={source:'payment',deadline:null};save('reserved');
    stage='filling_card';check();await site.chooseCard(candidate,reservation);await pause();
    await site.fillCard(card);check();
    // Check page continuity only; card input is verified separately by the adapter.
    const ready=await site.inspect(candidate,reservation);
    if(ready.page!=='payment'||ready.notice)throw new Error('payment_page_changed');
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
