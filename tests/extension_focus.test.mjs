import test from 'node:test';
import assert from 'node:assert/strict';
import {focusSourceTab} from '../extension/focus-tab.js';
function harness(){
  let time=0;const calls=[],controller=new AbortController();
  const api={tabs:{get:async id=>{calls.push(['get',id]);return {windowId:7};},update:async(...a)=>calls.push(['tab',...a])},
    windows:{update:async(...a)=>calls.push(['window',...a])}};
  return {calls,controller,args:{tabId:3,api,signal:controller.signal,now:()=>time,sleep:async ms=>{time+=ms;},readFocus:async()=>({focused:time>=200,visibility:'visible'})}};
}
test('activates the source tab/window without reload or URL changes and waits for focus',async()=>{
  const h=harness();assert.equal((await focusSourceTab(h.args)).focused,true);
  assert.deepEqual(h.calls,[['get',3],['tab',3,{active:true}],['window',7,{focused:true}]]);
});
test('missing focus or stop prevents starting the next booking step',async()=>{
  const h=harness();h.args.readFocus=async()=>({focused:false,visibility:'visible'});
  await assert.rejects(focusSourceTab(h.args),/source_focus_timeout/);
  const stopped=harness();stopped.controller.abort();
  await assert.rejects(focusSourceTab(stopped.args),/stopped/);assert.deepEqual(stopped.calls,[]);
});

test('restores minimized source and retries activation without any clicks or navigation',async()=>{
 const h=harness();h.args.api.windows.get=async()=>({state:'minimized'});h.args.readFocus=async()=>({focused:h.calls.filter(c=>c[0]==='window'&&c[2].focused).length>=2,visibility:'visible'});
 await focusSourceTab(h.args);assert.ok(h.calls.some(c=>c[0]==='window'&&c[2].state==='normal'));assert.equal(h.calls.filter(c=>c[0]==='window'&&c[2].focused).length,2);assert.ok(h.calls.filter(c=>c[0]==='tab').every(c=>!c[2].url));
});
