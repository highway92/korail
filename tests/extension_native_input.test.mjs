import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {nativeAction,nativePing} from '../extension/native-input.js';
globalThis.crypto ??= webcrypto;

function fixture(reply={ok:true}){
  const calls=[];
  const api={tabs:{get:async()=>({windowId:7}),update:async()=>{}},windows:{update:async()=>{}},
    runtime:{sendNativeMessage:async(host,message)=>{calls.push(message);return reply;}}};
  const execute=async(func)=>{
    if(func.name==='readPageFocus')return {focused:true,visibility:'visible'};
    if(func.name==='prepareNativePoint')return {ok:true,message:{action:'click'}};
    if(func.name==='restoreNativeTitle')calls.push('restored');
  };
  return {calls,api,execute,run:async()=>({ok:true,native:true,target:{text:'예매'}}),tabId:1,sleep:async()=>{},signal:new AbortController().signal};
}

test('native action sends exactly one input and cleans up marker',async()=>{
  const f=fixture(),r=await nativeAction(f);
  assert.equal(r.input,'windows_mouse');assert.equal(r.clickDispatched,true);
  assert.deepEqual(f.calls,[{action:'click'},'restored']);
});
test('transport failure never retries a potentially delivered click',async()=>{
  const f=fixture();f.api.runtime.sendNativeMessage=async()=>{f.calls.push('sent');throw Error('disconnect');};
  await assert.rejects(nativeAction(f),/native_input_unknown/);
  assert.deepEqual(f.calls,['sent','restored']);
});
test('changed target or stop cannot dispatch input',async()=>{
  const f=fixture();f.execute=async(func)=>func.name==='readPageFocus'?{focused:true,visibility:'visible'}:{ok:false,code:'native_target_changed'};
  await assert.rejects(nativeAction(f),/native_target_changed/);assert.equal(f.calls.length,0);
  const stopped=fixture();stopped.signal=AbortSignal.abort();
  await assert.rejects(nativeAction(stopped),/stopped/);assert.equal(stopped.calls.length,0);
});
test('inspect and already selected paths need no native click',async()=>{
  const f=fixture();f.run=async()=>({ok:true,page:'search'});
  assert.deepEqual(await nativeAction(f),{ok:true,page:'search'});assert.equal(f.calls.length,0);
});
test('semantic revalidation after focusing rejects a changed selection without clicking',async()=>{
  const f=fixture();let count=0;
  f.run=async()=>++count===1?{ok:true,native:true}:{ok:false,code:'selection_mismatch'};
  assert.deepEqual(await nativeAction(f),{ok:false,code:'selection_mismatch'});
  assert.equal(count,2);assert.equal(f.calls.length,0);
});
test('native preflight requires expected host version',async()=>{
  const f=fixture({ok:true,version:2});await nativePing(f.api);assert.deepEqual(f.calls,[{action:'ping'}]);
  await assert.rejects(nativePing(fixture({ok:true,version:0}).api),/native_host_version/);
});
test('window mismatch retries only when host explicitly confirms no input, once',async()=>{
  const f=fixture();let sends=0;
  f.api.runtime.sendNativeMessage=async()=>{f.calls.push('sent');return ++sends===1?{ok:false,code:'native_window_mismatch',inputDispatched:false}:{ok:true};};
  assert.equal((await nativeAction(f)).input,'windows_mouse');
  assert.deepEqual(f.calls,['sent','sent','restored']);
  const repeated=fixture({ok:false,code:'native_window_mismatch',inputDispatched:false});
  await assert.rejects(nativeAction(repeated),/native_window_mismatch/);
  assert.equal(repeated.calls.filter(c=>typeof c==='object').length,2);
});
test('unqualified native window error is never retried',async()=>{
  const f=fixture({ok:false,code:'native_window_mismatch'});
  await assert.rejects(nativeAction(f),/native_window_mismatch/);
  assert.equal(f.calls.filter(c=>typeof c==='object').length,1);
});
test('fast input skips repeated focus, semantic scan and fixed title delay when focused',async()=>{
  const f=fixture();let scans=0;
  f.fast=true;f.run=async()=>{scans++;return {ok:true,native:true};};
  f.api.tabs.get=async()=>{throw Error('unnecessary_focus');};
  f.sleep=async()=>{throw Error('unnecessary_delay');};
  assert.equal((await nativeAction(f)).input,'windows_mouse');assert.equal(scans,1);
});
