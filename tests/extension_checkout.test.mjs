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
    inspect:async()=>({page,notice,match:true,reservation:seat}),
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
test('confirmed train notice continues reserve and confirms the same notice again',async()=>{
  const h=harness({notices:false});let notice=null,count=0,confirmations=0,normal=false;
  const inspect=h.args.site.inspect,submit=h.args.site.reserve,dismiss=h.args.site.dismiss;
  h.args.site.reserve=async()=>{count++;notice='train';};
  h.args.site.dismiss=async n=>{if(n==='train'){notice=null;confirmations++;if(count===2){normal=true;await submit();}}else await dismiss(n);};
  h.args.site.inspect=async()=>normal?inspect():{page:'search',notice};
  await h.run();assert.equal(h.record().state,'complete');assert.equal(count,2);assert.equal(confirmations,2);
  assert.equal(h.calls.filter(c=>c==='submitPayment').length,1);
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
  await h.run();assert.equal(count,2);assert.equal(confirms,2);
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

test('duplicate journey cannot bypass target verification',async()=>{
  const h=harness({notices:false});let pending=false,chosen=false;
  h.args.site.reserve=async()=>{pending=true;};
  h.args.site.dismiss=async()=>{pending=false;chosen=true;};
  h.args.site.inspect=async()=>pending?{page:'search',notice:'duplicate_journey'}:chosen?{page:'payment',match:false}:{page:'search'};
  await h.run();assert.equal(h.events.at(-1).reason,'reservation_mismatch');assert.ok(!h.calls.includes('submitPayment'));
});
