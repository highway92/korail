import test from 'node:test';
import assert from 'node:assert/strict';
import {checkout} from '../extension/checkout.js';
const candidate={train:{key:{date:'2099-10-09',departure:'용산',arrival:'정읍',time:'07:47',number:'409'}},seatClass:'일반실'};
function harness({notices=true}={}){
  let record=null,time=0,page='search',notice=null;
  const calls=[],events=[],controller=new AbortController();
  const seat={coach:'14',seat:'2A',deadline:999999};
  const site={select:async()=>calls.push('select'),verifySelected:async()=>calls.push('verify'),
    reserve:async()=>{calls.push('reserve');page=notices?'search':'reservation';notice=notices?'train':null;},
    inspect:async()=>({page,notice,match:page!=='search',reservation:seat}),
    dismiss:async n=>{calls.push('dismiss:'+n);if(n==='train'){page='reservation';notice='refund';}else if(n==='refund')notice=null;else{page='tickets';notice=null;}},
    openPayment:async()=>{calls.push('openPayment');page='payment';},chooseCard:async()=>calls.push('chooseCard'),
    fillCard:async()=>calls.push('fillCard'),submitPayment:async()=>{calls.push('submitPayment');notice='paid';}};
  const args={candidate,card:{number:'SYNTHETIC_SECRET'},site,store:{load:()=>record,save:r=>{if(record?.state!==r.state)calls.push('save:'+r.state);record=structuredClone(r);}},
    signal:controller.signal,sleep:async ms=>{time+=ms;},now:()=>time,onEvent:e=>events.push(e)};
  return {args,calls,events,controller,record:()=>record,run:()=>checkout(args)};
}
test('one start traverses optional notices, reservation, card submission and ticket',async()=>{
  const h=harness();await h.run();assert.equal(h.record().state,'complete');
  assert.deepEqual(h.calls,['select','verify','save:reservation_submitting','reserve','dismiss:train','dismiss:refund',
    'save:reserved','openPayment','chooseCard','fillCard','save:payment_submitting','submitPayment','dismiss:paid','save:complete']);
  assert.ok(!JSON.stringify(h.record()).includes('SYNTHETIC_SECRET'));
  await h.run();assert.equal(h.calls.filter(x=>x==='submitPayment').length,1);
});
test('without pre-reservation notices the same normal flow completes',async()=>{
  const h=harness({notices:false});await h.run();assert.equal(h.record().state,'complete');
});
test('real search snapshot with match false enters selection immediately, not after 30 seconds',async()=>{
  const h=harness({notices:false});await h.run();
  const start=h.events.find(e=>e.action==='inspect_start');
  const select=h.events.find(e=>e.action==='select_start');
  assert.equal(select.trace.at(-1).at,start.trace.at(-1).at);
  assert.equal(h.record().state,'complete');
});
test('competition uses zero action delay and 50ms polling, then restores slow checkout timing',async()=>{
  const h=harness({notices:false});let phase='search',notice=null,polls=0;const at={};
  Object.assign(h.args,{competitionDelay:0,competitionPollInterval:.05,actionDelay:.8,noticeDelay:.8});
  Object.assign(h.args.site,{
    select:async()=>{notice='route';},
    reserve:async()=>{at.reserve=h.args.now();notice='train';polls=2;},
    inspect:async()=>({page:phase,notice:polls-->0?null:notice,match:phase!=='search',reservation:{coach:'14',seat:'2A',deadline:999999}}),
    dismiss:async n=>{at[n]=h.args.now();notice=null;if(n==='train'){phase='reservation';notice='refund';}else if(n==='paid')phase='tickets';},
    openPayment:async()=>{phase='payment';},
    submitPayment:async()=>{notice='paid';}
  });
  await h.run();assert.equal(h.record().state,'complete');
  assert.equal(at.reserve,0);assert.equal(at.route,0);assert.equal(at.train,100);
  assert.ok(at.refund>=900); // Slower timing begins only after reservation page arrival.
});
test('payment ignores incomplete booking-card metadata without replaying actions',async()=>{
  const h=harness({notices:false}),inspect=h.args.site.inspect;let reads=0;
  h.args.site.inspect=async()=>{
    const state=await inspect();
    if(state.page==='payment'&&++reads<=3)return {...state,match:false,matchReason:'booking_block_mismatch',checks:{train:false}};
    return state;
  };
  await h.run();assert.equal(h.record().state,'complete');
  assert.equal(h.calls.filter(c=>c==='reserve').length,1);
  assert.equal(h.calls.filter(c=>c==='openPayment').length,1);
  assert.equal(h.calls.filter(c=>c==='submitPayment').length,1);
});
test('payment identity mismatch does not block card entry or one submission',async()=>{
  const h=harness({notices:false}),inspect=h.args.site.inspect;h.args.transitionTimeout=.5;
  h.args.site.inspect=async()=>{const state=await inspect();return state.page==='payment'?{...state,match:false,matchReason:'seat_mismatch'}:state;};
  await h.run();assert.equal(h.record().state,'complete');
  assert.ok(h.calls.includes('fillCard'));
  assert.equal(h.calls.filter(c=>c==='submitPayment').length,1);
});
test('reservation created despite search staying visible is recovered from list without resubmitting',async()=>{
  const h=harness({notices:false});let phase='search',notice=null,reserves=0,lookups=0;
  const original=h.args.site.inspect;
  h.args.transitionTimeout=1;
  h.args.site.reserve=async()=>{reserves++;notice='train';};
  h.args.site.dismiss=async()=>{notice=null;};
  h.args.site.openReservationList=async()=>{lookups++;phase='reservation_list';};
  h.args.site.inspect=async()=>phase==='search'?{page:'search',notice}:phase==='reservation_list'?{page:phase,match:true,reservation:{source:'reservation_list',deadline:999999}}:phase==='payment'?{page:phase,match:true,reservation:{coach:'14',seat:'2A',deadline:999999}}:{page:'tickets',match:true};
  h.args.site.openPayment=async()=>{phase='payment';};
  h.args.site.submitPayment=async()=>{phase='tickets';};
  await h.run();assert.equal(h.record().state,'complete');assert.equal(reserves,1);assert.equal(lookups,1);
  assert.deepEqual(h.record().reservation,{source:'payment',deadline:null});
});

test('missing reservation in recovery never creates a new booking or pays',async()=>{
  const h=harness({notices:false});let phase='search',reserves=0;
  h.args.transitionTimeout=1;h.args.site.reserve=async()=>{reserves++;};
  h.args.site.openReservationList=async()=>{phase='reservation_list';};
  h.args.site.inspect=async()=>({page:phase,match:false});
  await h.run();assert.equal(reserves,1);assert.equal(h.events.at(-1).reason,'reservation_mismatch');
  assert.ok(!h.calls.includes('submitPayment'));
});

test('reservation reached by confirm skips additional reserve',async()=>{
  const h=harness();await h.run();assert.equal(h.record().state,'complete');
  assert.equal(h.calls.filter(c=>c==='reserve').length,1);
});

test('search remaining without a new notice does not replay reserve',async()=>{
  const h=harness({notices:false});h.args.transitionTimeout=1;let count=0;
  h.args.site.reserve=async()=>{count++;};
  await h.run();assert.equal(count,1);assert.equal(h.events.at(-1).reason,'timeout_reservation_from_search');
});

test('endless notice and reserve cycle is bounded',async()=>{
  const h=harness({notices:false});let notice=null,count=0,confirms=0;
  h.args.site.reserve=async()=>{count++;notice='train';};
  h.args.site.inspect=async()=>({page:'search',notice});
  h.args.site.dismiss=async()=>{notice=null;confirms++;};
  await h.run();assert.equal(count,1);assert.equal(confirms,1);
  assert.equal(h.events.at(-1).reason,'timeout_reservation_from_search');assert.ok(!h.calls.includes('submitPayment'));
});

test('stop after informational confirm prevents continuation',async()=>{
  const h=harness({notices:false});let notice=null,count=0;
  h.args.site.reserve=async()=>{count++;notice='train';};
  h.args.site.inspect=async()=>({page:'search',notice});
  h.args.site.dismiss=async()=>{notice=null;h.controller.abort();};
  await h.run();assert.equal(count,1);assert.equal(h.events.at(-1).reason,'stopped');
});

test('selection-time route notice is dismissed before verifying and submitting',async()=>{
  const h=harness({notices:false});let pending=false;
  const select=h.args.site.select,inspect=h.args.site.inspect,dismiss=h.args.site.dismiss;
  h.args.site.select=async()=>{await select();pending=true;};
  h.args.site.inspect=async()=>pending?{page:'search',notice:'route'}:inspect();
  h.args.site.dismiss=async n=>{if(n==='route'){h.calls.push('dismiss:route');pending=false;}else await dismiss(n);};
  await h.run();assert.equal(h.record().state,'complete');
  assert.ok(h.calls.indexOf('dismiss:route')<h.calls.indexOf('verify'));
  assert.ok(h.calls.indexOf('dismiss:route')<h.calls.indexOf('save:reservation_submitting'));
});
test('payment transport failure retains intent and never resubmits',async()=>{
  const h=harness();h.args.site.submitPayment=async()=>{h.calls.push('submitPayment');throw new Error('disconnected');};
  await h.run();assert.equal(h.record().state,'payment_submitting');await h.run();
  assert.equal(h.calls.filter(x=>x==='submitPayment').length,1);
});
test('wrong reservation prevents payment and wrong ticket prevents completion',async()=>{
  const h=harness({notices:false});const inspect=h.args.site.inspect;
  h.args.site.inspect=async()=>({...await inspect(),match:false});await h.run();
  assert.ok(!h.calls.includes('submitPayment'));assert.equal(h.events.at(-1).reason,'reservation_mismatch');
  const t=harness();const read=t.args.site.inspect;
  t.args.site.inspect=async()=>{const s=await read();return s.page==='tickets'?{...s,match:false}:s;};
  await t.run();assert.equal(t.events.at(-1).reason,'ticket_mismatch');assert.notEqual(t.record().state,'complete');
});
test('stop after card fill prevents submitting payment',async()=>{
  const h=harness();h.args.site.fillCard=async()=>h.controller.abort();await h.run();
  assert.ok(!h.calls.includes('submitPayment'));assert.equal(h.events.at(-1).reason,'stopped');
});
test('login and repeated notice are exceptions, not replay triggers',async()=>{
  const h=harness();h.args.site.inspect=async()=>({page:'login'});await h.run();
  assert.equal(h.events.at(-1).reason,'login_required');
  const n=harness();n.args.site.dismiss=async()=>{};await n.run();assert.equal(n.events.at(-1).reason,'timeout_reservation_from_search');
});
test('journal failure before payment prevents submission',async()=>{
  const h=harness(),save=h.args.store.save;
  h.args.store.save=r=>{if(r.state==='payment_submitting')throw new Error('storage_failed');save(r);};
  await h.run();assert.ok(!h.calls.includes('submitPayment'));
});

for(const destination of ['reservation','payment'])test('duplicate journey choice continues to '+destination,async()=>{
  const h=harness({notices:false});let pending=false,chosen=false;
  const inspect=h.args.site.inspect,reserve=h.args.site.reserve,dismiss=h.args.site.dismiss;
  h.args.site.reserve=async()=>{pending=true;};
  h.args.site.inspect=async()=>{
    if(pending)return {page:'search',notice:'duplicate_journey'};
    const s=await inspect();
    if(chosen&&destination==='payment'&&s.page==='reservation')return {...s,page:'payment',reservation:{coach:'14',seat:'2A',source:'payment',deadline:null}};
    return s;
  };
  h.args.site.dismiss=async n=>{if(n==='duplicate_journey'){h.calls.push('otherJourney');pending=false;chosen=true;await reserve();}else await dismiss(n);};
  await h.run();assert.equal(h.record().state,'complete');
  assert.equal(h.calls.filter(c=>c==='otherJourney').length,1);
  assert.equal(h.calls.filter(c=>c==='openPayment').length,destination==='payment'?0:1);
  assert.equal(h.calls.filter(c=>c==='submitPayment').length,1);
});

test('duplicate journey reaching payment proceeds without identity comparison',async()=>{
  const h=harness({notices:false});let pending=false,chosen=false,completed=false;
  h.args.site.reserve=async()=>{pending=true;};
  h.args.site.dismiss=async()=>{pending=false;chosen=true;};
  h.args.site.inspect=async()=>completed?{page:'tickets',match:true}:pending?{page:'search',notice:'duplicate_journey'}:chosen?{page:'payment',match:false}:{page:'search'};
  h.args.site.submitPayment=async()=>{h.calls.push('submitPayment');completed=true;};
  await h.run();assert.equal(h.record().state,'complete');assert.equal(h.calls.filter(c=>c==='submitPayment').length,1);
});


test('normal train notice may lead directly to payment without reservation detail',async()=>{
  const h=harness({notices:false});let phase='search',notice=null;
  h.args.noticeDelay=0.8;
  h.args.competitionDelay=0.8;
  h.args.site.reserve=async()=>{h.calls.push('reserve');notice='train';};
  h.args.site.dismiss=async()=>{assert.ok(h.args.now()>=900);notice=null;phase='payment';};
  h.args.site.inspect=async()=>({page:phase,notice,match:true,reservation:{coach:'14',seat:'2A',source:'payment',deadline:null}});
  h.args.site.submitPayment=async()=>{h.calls.push('submitPayment');phase='tickets';};
  await h.run();assert.equal(h.record().state,'complete');
  assert.equal(h.calls.filter(c=>c==='reserve').length,1);assert.ok(!h.calls.includes('openPayment'));
});

for(const destination of ['reservation','payment'])test('late duplicate notice before payment continues to '+destination+' without replaying reservation',async()=>{
 const h=harness({notices:false});let late=false,chosen=false,attempts=0;
 const inspect=h.args.site.inspect,dismiss=h.args.site.dismiss,open=h.args.site.openPayment,submit=h.args.site.submitPayment;
 h.args.site.submitPayment=async()=>{chosen=false;await submit();};
 h.args.site.inspect=async()=>late?{page:'reservation',notice:'duplicate_journey'}:chosen&&destination==='payment'?{page:'payment',match:true}:inspect();
 h.args.site.openPayment=async()=>{attempts++;if(attempts===1){late=true;throw Error('covered_action');}await open();};
 h.args.site.dismiss=async n=>{if(n==='duplicate_journey'){late=false;chosen=true;h.calls.push('otherJourney');}else{chosen=false;await dismiss(n);}};
 await h.run();assert.equal(h.record().state,'complete');assert.equal(h.calls.filter(c=>c==='reserve').length,1);assert.equal(h.calls.filter(c=>c==='submitPayment').length,1);assert.equal(attempts,destination==='payment'?1:2);
});
test('unknown payment-entry transport error never retries openPayment',async()=>{
 const h=harness({notices:false});let attempts=0;h.args.site.openPayment=async()=>{attempts++;throw Error('native_input_unknown');};await h.run();assert.equal(attempts,1);assert.equal(h.events.at(-1).reason,'native_input_unknown');
});

test('selection rendering may lag native click; rechecks without clicking twice',async()=>{
 const h=harness({notices:false});let checks=0;h.args.site.verifySelected=async()=>{if(++checks<4)throw Error('selection_mismatch');};await h.run();assert.equal(h.record().state,'complete');assert.equal(checks,4);assert.equal(h.calls.filter(c=>c==='select').length,1);assert.equal(h.calls.filter(c=>c==='reserve').length,1);
});
test('persistent selection mismatch stops before reservation after bounded rechecks',async()=>{
 const h=harness({notices:false});h.args.site.verifySelected=async()=>{throw Error('selection_mismatch');};await h.run();assert.equal(h.events.at(-1).reason,'selection_mismatch');assert.equal(h.calls.filter(c=>c==='reserve').length,0);assert.ok(h.args.now()<=1100);
});

test('recovered reservation resumes payment without selecting or reserving again',async()=>{const h=harness({notices:false});let opened=false;const inspect=h.args.site.inspect,open=h.args.site.openPayment;h.args.site.inspect=async()=>opened?inspect():{page:'reservation_list',match:true,reservation:{source:'reservation_list',deadline:999999}};h.args.site.openPayment=async()=>{opened=true;await open();};h.args.resume={page:'reservation_list',match:true,reservation:{source:'reservation_list',deadline:999999}};await h.run();assert.equal(h.record().state,'complete');assert.equal(h.calls.filter(c=>c==='reserve'||c==='select').length,0);assert.equal(h.calls.filter(c=>c==='submitPayment').length,1);});
