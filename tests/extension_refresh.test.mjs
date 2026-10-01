import test from 'node:test';
import assert from 'node:assert/strict';
import {probeRefresh} from '../extension/refresh.js';
const snapshot=(epoch,status='readable')=>({ok:true,documentEpoch:epoch,status,
  conditions:{date:'2026-10-09(금) 08:00',departure:'용산',arrival:'정읍',passengers:'총 1명'}});
function harness(sequence){
  let time=0,reloads=0,index=0;
  return {run:()=>probeRefresh({baseline:snapshot(1),timeoutMs:5000,pollMs:1000,
    reload:async()=>{reloads++;},read:async()=>sequence[Math.min(index++,sequence.length-1)],
    now:()=>time,sleep:async ms=>{time+=ms;}}),count:()=>reloads};
}
test('one reload, wait for new document instead of accepting the old DOM',async()=>{
  const h=harness([snapshot(1),snapshot(2,'empty'),snapshot(2)]);
  const result=await h.run();assert.equal(result.ok,true);assert.equal(h.count(),1);
  assert.equal(result.snapshot.documentEpoch,2);
});
test('empty results time out without repeated reload',async()=>{
  const h=harness([snapshot(2,'empty')]);
  assert.equal((await h.run()).code,'timeout');assert.equal(h.count(),1);
});
test('changed conditions stop the probe',async()=>{
  const changed=snapshot(2);changed.conditions.arrival='부산';
  const h=harness([changed]);assert.equal((await h.run()).code,'conditions_changed');
});
