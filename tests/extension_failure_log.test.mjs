import test from 'node:test';
import assert from 'node:assert/strict';
import {failureReport,saveFailureLog} from '../extension/failure-log.js';
test('failure logs allow diagnostic fields only and omit all private values',()=>{
 const report=failureReport({state:'uncertain',stage:'filling_card',reason:'card_input_failed',card:{number:'SECRET'},blocker:{text:'SECRET'},trace:[{action:'observe',page:'payment',at:123,target:{text:'SECRET'},value:'SECRET'}]},'0.12.2');
 assert.equal(report.stage,'filling_card');assert.equal(report.trace[0].page,'payment');assert.ok(!JSON.stringify(report).includes('SECRET'));
});
test('download failure preserves local backup and surfaces error',async()=>{
 let backup;await assert.rejects(saveFailureLog({reason:'timeout'},{storage:{setItem:(k,v)=>backup=v},downloads:{download:async()=>{throw Error('download_failed');}}}));
 assert.equal(JSON.parse(backup).reason,'timeout');
});

test('failure automatically downloads a timestamped JSON without a save dialog',async()=>{let request,backup;const now=new Date('2026-10-07T01:02:03Z');await saveFailureLog({state:'uncertain',stage:'filling_card',reason:'input_not_retained'},{now,storage:{setItem:(k,v)=>backup=v},downloads:{download:async r=>{request=r;return 1;}}});assert.equal(request.saveAs,false);assert.equal(request.filename,'korail-logs/failure-2026-10-07T01-02-03-000Z.json');assert.equal(JSON.parse(backup).reason,'input_not_retained');});
