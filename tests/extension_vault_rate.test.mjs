import test from 'node:test';
import assert from 'node:assert/strict';
import {saveCard,unlockCard,deleteCard} from '../extension/vault.js';
import {limitedReload} from '../extension/rate-limit.js';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};};
test('vault encrypts, rejects wrong password/tampering, round trips and deletes',async()=>{
  const s=storage(),card={number:'0000000000000000',month:'06',year:'2099',birth:'000101',pin:'00'};
  await saveCard(s,card,'synthetic-password');
  const raw=s.getItem('korail-card-vault-v1');
  assert.ok(!raw.includes(card.number));assert.ok(!raw.includes('synthetic-password'));
  assert.deepEqual(await unlockCard(s,'synthetic-password'),card);
  await assert.rejects(unlockCard(s,'incorrect-password'));
  const changed=JSON.parse(raw);changed.iv=changed.salt;
  s.setItem('korail-card-vault-v1',JSON.stringify(changed));await assert.rejects(unlockCard(s,'synthetic-password'));
  deleteCard(s);assert.equal(s.getItem('korail-card-vault-v1'),null);
});
test('vault save failure does not overwrite previous encrypted data',async()=>{
  const s=storage();s.setItem('korail-card-vault-v1','original');
  await assert.rejects(saveCard(s,{},'short'));assert.equal(s.getItem('korail-card-vault-v1'),'original');
});
test('101st refresh waits past the rolling minute, including across instances',async()=>{
  const s=storage(),calls=[];let time=0;
  const options={storage:s,locks:{request:async(_,fn)=>fn()},now:()=>time,sleep:async ms=>{time+=ms;},reload:async()=>calls.push(time)};
  for(let i=0;i<101;i++)await limitedReload({...options});
  assert.equal(calls[99],0);assert.equal(calls[100],60001);
  for(const t of calls)assert.ok(calls.filter(x=>x>=t-60000&&x<=t).length<=100);
});
test('stop, deadline and malformed history cannot bypass rate cap',async()=>{
  const s=storage();let count=0;
  const options={storage:s,locks:{request:async(_,fn)=>fn()},now:()=>0,reload:async()=>count++};
  await assert.rejects(limitedReload({...options,signal:{aborted:true}}));
  await assert.rejects(limitedReload({...options,deadline:0}));
  s.setItem('korail-query-times-v1','{}');await assert.rejects(limitedReload(options));assert.equal(count,0);
});
