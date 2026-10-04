import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {monitor,chooseCandidate,validateSettings} from '../extension/monitor.js';
import {parseSnapshot} from '../extension/parser.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/korail-public-rows.json',import.meta.url)));
const all=parseSnapshot(fixture).trains;
const sold=all.find(t=>t.key.number==='411');
const defaults={interval:10,timeout:30,errorDelay:20,errorMultiplier:2,errorMax:40,maxErrors:3,maxQueries:3,maxRuntime:120,
  targets:[sold.id],classes:['일반실','특실'],preference:[]};
function harness(overrides={}) {
  let time=0,reloads=0;
  const events=[],waits=[],controller=new AbortController();
  const args={baseline:fixture,settings:{...defaults},signal:controller.signal,
    read:async()=>structuredClone(fixture),refresh:async()=>{reloads++;return {ok:true,snapshot:structuredClone(fixture)};},
    sleep:async ms=>{waits.push(ms);time+=ms;},now:()=>time,onEvent:e=>events.push(e),...overrides};
  return {args,events,waits,controller,reloads:()=>reloads,run:()=>monitor(args)};
}
test('bounded sequential reloads use configured completion interval',async()=>{
  const h=harness();await h.run();assert.equal(h.reloads(),3);
  assert.deepEqual(h.waits,[10000,10000,10000]);assert.equal(h.events.at(-1).state,'query_limit');
});
test('manual condition change stops before reload',async()=>{
  const changed=structuredClone(fixture);changed.conditions.arrival='부산';
  const h=harness({read:async()=>changed});await h.run();
  assert.equal(h.reloads(),0);assert.equal(h.events.at(-1).reason,'conditions_changed');
});
test('missing target is not sold out and stops',async()=>{
  const h=harness({settings:{...defaults,targets:['missing']}});await h.run();
  assert.equal(h.reloads(),0);assert.equal(h.events.at(-1).reason,'missing_targets');
});
test('stop during wait prevents reload; runtime limit clips wait',async()=>{
  const h=harness();h.args.sleep=async()=>h.controller.abort();await h.run();
  assert.equal(h.reloads(),0);assert.equal(h.events.at(-1).state,'stopped');
  const limited=harness({settings:{...defaults,maxRuntime:5}});await limited.run();
  assert.deepEqual(limited.waits,[5000]);assert.equal(limited.reloads(),0);assert.equal(limited.events.at(-1).state,'time_limit');
});
test('errors back off and terminate without being labeled sold out',async()=>{
  const h=harness({refresh:async()=>({ok:false,code:'timeout'})});await h.run();
  assert.deepEqual(h.waits,[10000,20000,10000,40000,10000]);
  assert.equal(h.events.at(-1).state,'error_limit');assert.equal(h.events.at(-1).errors,3);
});
test('candidate selection weights trains equally, honors order and excludes standing',()=>{
  const eligible=all.filter(t=>t.availableClasses.length);
  assert.equal(eligible.length,2);
  const s={...defaults,targets:all.map(t=>t.id)};
  assert.equal(chooseCandidate(all,s,()=>0.49).train.id,eligible[0].id);
  assert.equal(chooseCandidate(all,s,()=>0.5).train.id,eligible[1].id);
  assert.equal(chooseCandidate(all,{...s,preference:[eligible[1].id,eligible[0].id]},()=>0).train.id,eligible[1].id);
  assert.equal(chooseCandidate(all,{...s,classes:['특실']},()=>0).train.id,eligible[1].id);
});
test('available target stops immediately using fresh data',async()=>{
  const target=all.find(t=>t.availableClasses.length);
  const h=harness({settings:{...defaults,targets:[target.id]}});await h.run();
  assert.equal(h.events.at(-1).state,'found');assert.equal(h.reloads(),0);
});
test('an empty result after a failed refresh can be reloaded on retry',async()=>{
  let reads=0,calls=0;
  const empty={...fixture,status:'empty'};
  const h=harness({read:async()=>++reads===3?empty:fixture,refresh:async()=>++calls===1?
    {ok:false,code:'timeout'}:{ok:true,snapshot:fixture}});
  await h.run();assert.equal(calls,3);assert.equal(h.events.at(-1).state,'query_limit');
});
test('interval updates are applied on next wait and invalid numbers are rejected',async()=>{
  const h=harness();h.args.onEvent=e=>{h.events.push(e);if(e.state==='querying')h.args.settings.interval=20;};
  await h.run();assert.deepEqual(h.waits,[10000,20000,20000]);
  for(const n of [NaN,Infinity,0,-1])assert.throws(()=>validateSettings({...defaults,interval:n}));
  assert.throws(()=>validateSettings({...defaults,preference:['wrong']}));
});
