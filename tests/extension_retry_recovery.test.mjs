import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverAttempt} from '../extension/retry-recovery.js';
function fixture(states){let page,time=0;const visits=[];return {visits,args:{candidate:{},failure:{stage:'opening_payment'},signal:new AbortController().signal,now:()=>time,sleep:async ms=>time+=ms,navigate:async url=>{page=url.includes('myticket')?'tickets':'reservation_list';visits.push(page);},inspect:async()=>({page,...states[page]})}};}
test('uncertain submission checks tickets then resumes existing reservation',async()=>{const f=fixture({tickets:{match:false},reservation_list:{match:true,reservation:{deadline:9999}}});assert.ok((await recoverAttempt(f.args)).resume);assert.deepEqual(f.visits,['tickets','reservation_list']);});
test('issued ticket completes without revisiting reservation or submitting',async()=>{const f=fixture({tickets:{match:true}});assert.equal((await recoverAttempt(f.args)).complete,true);assert.deepEqual(f.visits,['tickets']);});
test('no matching ticket or reservation returns to monitoring',async()=>{const f=fixture({tickets:{match:false},reservation_list:{match:false}});assert.equal((await recoverAttempt(f.args)).retry,true);});
test('pre-submit selection failure can resume monitoring without account navigation',async()=>{const f=fixture({});f.args.failure.stage='after_selection';assert.equal((await recoverAttempt(f.args)).retry,true);assert.deepEqual(f.visits,[]);});
test('login interruption never counts as no reservation',async()=>{const f=fixture({});f.args.inspect=async()=>({page:'login'});await assert.rejects(recoverAttempt(f.args),/login_required/);});
