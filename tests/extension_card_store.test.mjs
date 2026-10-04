import test from 'node:test';
import assert from 'node:assert/strict';
import {saveLocalCard,loadLocalCard,deleteLocalCard,cardSummary,CARD_KEY} from '../extension/card-store.js';
test('local card CRUD always applies consent and app ticket without storing extra fields',()=>{
  const map=new Map(),s={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  assert.equal(loadLocalCard(s),null);
  const card={number:'0000000000001234',month:'06',year:'2099',birth:'000101',pin:'00',agree:false,appTicket:false,extra:'ignored'};
  saveLocalCard(s,card);const loaded=loadLocalCard(s);
  assert.equal(loaded.agree,true);assert.equal(loaded.appTicket,true);assert.equal(loaded.extra,undefined);
  assert.equal(cardSummary(s),'개인카드 · 끝 4자리 1234');
  assert.ok(!s.getItem(CARD_KEY).includes('extra'));
  assert.throws(()=>saveLocalCard(s,{...card,number:'123'}));assert.equal(loadLocalCard(s).number,card.number);
  deleteLocalCard(s);assert.equal(loadLocalCard(s),null);
});
