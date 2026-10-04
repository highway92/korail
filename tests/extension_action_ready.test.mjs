import test from 'node:test';
import assert from 'node:assert/strict';
import {readyAction} from '../extension/action-ready.js';
import {transactionStore} from '../extension/booking.js';

test('waits for transient cover, submits once, then returns immediately',async()=>{
  let time=0,attempts=0,clicks=0;
  await readyAction({run:async()=>{attempts++;if(time<200)return {ok:false,code:'covered_action'};clicks++;return {ok:true};},
    now:()=>time,sleep:async ms=>{time+=ms;}});
  assert.equal(attempts,3);assert.equal(clicks,1);
});
test('permanent cover has a bounded wait and structural diagnostics',async()=>{
  let time=0;const blocker={tag:'div',classes:['backdrop']};
  await assert.rejects(readyAction({run:async()=>({ok:false,code:'covered_action',blocker}),
    now:()=>time,sleep:async ms=>{time+=ms;}}),e=>e.message==='covered_action'&&e.blocker===blocker);
  assert.equal(time,3000);
});
test('transport and other errors are never replayed',async()=>{
  for(const transport of [true,false]){
    let calls=0;
    await assert.rejects(readyAction({run:async()=>{calls++;if(transport)throw Error('disconnected');return {ok:false,code:'selection_mismatch'};},sleep:async()=>{}}));
    assert.equal(calls,1);
  }
});
test('stop during coverage wait prevents any further action',async()=>{
  const control=new AbortController();let calls=0;
  await assert.rejects(readyAction({signal:control.signal,run:async()=>{calls++;return {ok:false,code:'covered_action'};},sleep:async()=>control.abort()}),/stopped/);
  assert.equal(calls,1);
});
test('start resets even malformed previous journal, preserving card and rate history',()=>{
  const map=new Map([['korail-transaction-v1','{broken'],['korail-local-card-v1','card'],['korail-query-times-v1','[1]']]);
  const store=transactionStore({getItem:k=>map.get(k)??null,removeItem:k=>map.delete(k)});
  store.resetForStart();assert.equal(store.load(),null);assert.equal(map.size,2);
});
