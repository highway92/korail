import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedCall} from '../extension/browser-call.js';
test('unresponsive browser operation times out without replay',async()=>{
  let calls=0;
  await assert.rejects(boundedCall(()=>{calls++;return new Promise(()=>{});},10),/browser_operation_timeout/);
  assert.equal(calls,1);
});
test('browser result and failure are preserved',async()=>{
  assert.equal(await boundedCall(()=>42),42);
  await assert.rejects(boundedCall(()=>{throw Error('disconnected');}),/disconnected/);
});
