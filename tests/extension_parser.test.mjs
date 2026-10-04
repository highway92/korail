import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSnapshot, summarizeTargets} from '../extension/parser.js';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/korail-public-rows.json',import.meta.url),'utf8'));
const discountFixture=()=>JSON.parse(readFileSync(new URL('./fixtures/korail-selected-discount.json',import.meta.url),'utf8'));
test('selected discount fare uses amount, not percentage, and preserves selected class',()=>{
  const train=parseSnapshot(discountFixture()).trains[0];
  assert.equal(train.key.number,'403');
  assert.deepEqual(train.availableClasses,['일반실','특실']);
  assert.equal(train.seats[0].price,29700);assert.equal(train.seats[1].price,45500);
  assert.equal(train.seats[0].selected,true);assert.equal(train.seats[1].selected,false);
});
test('discount without unambiguous fare remains unknown',()=>{
  const data=discountFixture();
  function visit(n){if(n.classes.includes('txt_gr'))n.text='5%적립';n.children.forEach(visit);}
  visit(data.structure);
  assert.deepEqual(parseSnapshot(data).trains[0].availableClasses,[]);
});

test('real rows identify trains, full-seat availability and mixed standing seats',()=>{
  const {trains}=parseSnapshot(fixture());
  assert.equal(trains.length,4);
  const byNumber=Object.fromEntries(trains.map(t=>[t.key.number,t]));
  assert.equal(byNumber['411'].key.time,'08:20');
  assert.deepEqual(byNumber['411'].availableClasses,[]);
  assert.equal(byNumber['411'].seats[0].status,'sold_out');
  assert.deepEqual(byNumber['1423'].availableClasses,['일반실']);
  assert.equal(byNumber['1423'].seats[0].price,27900);
  assert.equal(byNumber['1423'].seats[1].status,'unavailable');
  assert.deepEqual(byNumber['423'].availableClasses,[]);
  assert.equal(byNumber['423'].seats[0].status,'standing_combo');
  assert.deepEqual(byNumber['457'].availableClasses,['일반실','특실']);
  assert.equal(byNumber['457'].seats[1].status,'available');
  assert.equal(byNumber['457'].seats[1].price,49700);
});
test('missing target is not reported as sold out',()=>{
  const {trains}=parseSnapshot(fixture());
  const targets=summarizeTargets(trains,['07:47','08:20']);
  assert.equal(targets[0].matches.length,0);
  assert.equal(targets[1].matches[0].key.number,'411');
});
test('incomplete, wrong-page and inconsistent routes fail closed',()=>{
  const a=fixture();a.truncated=true; assert.throws(()=>parseSnapshot(a));
  const b=fixture();b.source='https://www.korail.com/ticket/reservation/detail';assert.throws(()=>parseSnapshot(b));
  const c=fixture();c.conditions.arrival='부산';assert.throws(()=>parseSnapshot(c));
});
test('duplicate identity is rejected',()=>{
  const a=fixture();a.structure.children[0].children.push(a.structure.children[0].children[0]);
  assert.throws(()=>parseSnapshot(a));
});
