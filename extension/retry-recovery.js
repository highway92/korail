// Reconcile an ambiguous attempt before returning to seat monitoring.
export async function recoverAttempt({failure,candidate,inspect,navigate,sleep,signal,now=Date.now,timeoutMs=10000}){
 const check=()=>{if(signal.aborted)throw Error('stopped');};
 const readPage=async(page)=>{
  await navigate('https://www.korail.com/ticket/'+(page==='tickets'?'myticket/list':'reservation/list'));
  const deadline=now()+timeoutMs;
  while(now()<deadline){check();const s=await inspect(candidate);check();if(s.page==='login')throw Error('login_required');if(s.page===page&&!s.notice)return s;await sleep(200,signal);}
  throw Error('recovery_read_timeout');
 };
 const submitted=!['before_selection','selecting','after_selection','focusing_source'].includes(failure.stage);
 if(submitted){
  const ticket=await readPage('tickets');if(ticket.match)return {complete:true};
  const reservation=await readPage('reservation_list');if(reservation.match&&reservation.reservation)return {resume:reservation};
 }
 return {retry:true};
}
