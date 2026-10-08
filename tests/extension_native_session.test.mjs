import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSession} from '../extension/native-session.js';

function fixture(){
  const messages=[],listeners={};let connections=0;
  const port={onMessage:{addListener:fn=>listeners.message=fn},onDisconnect:{addListener:fn=>listeners.disconnect=fn},
    postMessage:message=>messages.push(message),disconnect:()=>listeners.disconnect()};
  const api={runtime:{connectNative:()=>{connections++;return port;}}};
  return {api,port,messages,listeners,count:()=>connections};
}
test('one native process connection handles sequential requests without replay',async()=>{
  const f=fixture(),session=createNativeSession(f.api);
  const first=session.send({action:'ping'});f.listeners.message({ok:true,version:2});await first;
  const second=session.send({action:'click'});f.listeners.message({ok:true});await second;
  assert.equal(f.count(),1);assert.deepEqual(f.messages,[{action:'ping'},{action:'click'}]);session.close();
});
test('disconnect and timeout fail without reconnecting or replaying',async()=>{
  const f=fixture(),session=createNativeSession(f.api);
  const first=session.send({action:'click'});f.listeners.disconnect();
  await assert.rejects(first,/native_transport_lost/);await assert.rejects(session.send({action:'click'}),/native_transport_lost/);
  assert.equal(f.messages.length,1);assert.equal(f.count(),1);
  const timed=fixture(),short=createNativeSession(timed.api,5);
  await assert.rejects(short.send({action:'click'}),/native_transport_lost/);assert.equal(timed.messages.length,1);
});
test('concurrent requests cannot overlap mouse operations',async()=>{
  const f=fixture(),session=createNativeSession(f.api);
  const first=session.send({action:'click'});
  await assert.rejects(session.send({action:'click'}),/native_transport_busy/);
  f.listeners.message({ok:true});await first;assert.equal(f.messages.length,1);session.close();
});
