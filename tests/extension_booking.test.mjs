import test from 'node:test';
import assert from 'node:assert/strict';
import {bookCandidate,transactionStore} from '../extension/booking.js';
const candidate={train:{key:{date:'2026-10-09',departure:'용산',arrival:'정읍',time:'07:47',number:'409'}},seatClass:'일반실'};
function harness(page='reservation'){
  let data=null,time=0;const calls=[],events=[],controller=new AbortController();
  const args={candidate,signal:controller.signal,store:{load:()=>data,save:r=>{data=structuredClone(r);calls.push('save');}},
    site:{select:async()=>calls.push('select'),verifySelected:async()=>calls.push('verify'),reserve:async()=>calls.push('reserve'),inspect:async()=>({page})},
    sleep:async ms=>{time+=ms;},now:()=>time,onEvent:e=>events.push(e)};
  return {args,calls,events,controller,data:()=>data,run:()=>bookCandidate(args)};
}
test('intent is persisted before one submission; reservation arrival is not ticket completion',async()=>{
  const h=harness();await h.run();
  assert.deepEqual(h.calls.slice(0,4),['select','verify','save','reserve']);
  assert.equal(h.data().state,'reservation_needs_verification');
  await h.run();assert.equal(h.calls.filter(c=>c==='reserve').length,1);
  assert.equal(h.events.at(-1).state,'existing_transaction');
});
test('failed persistence prevents submission',async()=>{
  const h=harness();h.args.store.save=()=>{throw new Error('disk');};await h.run();
  assert.ok(!h.calls.includes('reserve'));
});
test('ambiguous submission is not retried, even when invoked again',async()=>{
  const h=harness();h.args.site.reserve=async()=>{h.calls.push('reserve');throw new Error('disconnected');};
  await h.run();await h.run();assert.equal(h.calls.filter(c=>c==='reserve').length,1);
  assert.equal(h.data().state,'reservation_submitting');
});
test('login, known notice and timeout stop without resubmitting',async()=>{
  const login=harness('login');await login.run();assert.equal(login.data().state,'login_required');
  const notice=harness();notice.args.site.inspect=async()=>({page:'search',notices:['이용안내']});
  await notice.run();assert.equal(notice.data().state,'notice_requires_review');
  const timeout=harness('search');timeout.args.transitionTimeout=3;await timeout.run();
  assert.equal(timeout.data().state,'uncertain');assert.equal(timeout.calls.filter(c=>c==='reserve').length,1);
});
test('stop during selection delay prevents request',async()=>{
  const h=harness();h.args.sleep=async()=>h.controller.abort();await h.run();
  assert.ok(!h.calls.includes('reserve'));assert.equal(h.data(),null);
});
test('corrupt journal is not treated as an empty transaction',()=>{
  const storage={getItem:()=>'{bad',setItem:()=>{}};
  assert.throws(()=>transactionStore(storage).load());
  storage.getItem=()=>'{}';assert.throws(()=>transactionStore(storage).load());
});
test('reviewed recovery preserves evidence before removing the active record',()=>{
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const store=transactionStore(storage);store.save({candidate,state:'reservation_submitting'});
  store.archiveReviewed();assert.equal(store.load(),null);
  assert.equal(JSON.parse(map.get('korail-transaction-reviewed-v1')).state,'reservation_submitting');
  store.save({candidate,state:'reservation_submitting'});storage.setItem=()=>{throw new Error('storage_failed');};
  assert.throws(()=>store.archiveReviewed());assert.ok(store.load());
});
