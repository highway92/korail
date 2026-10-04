// Pure parser of the sanitized public structure; never clicks or trusts script text.
function* nodes(root) {
  const stack=[{node:root,depth:0}]; let count=0;
  while(stack.length) {
    const {node,depth}=stack.pop();
    if (!node || typeof node.text!=='string' || !Array.isArray(node.classes) ||
        !Array.isArray(node.children) || depth>16 || ++count>6000) throw new Error('invalid_structure');
    yield node;
    for (const child of [...node.children].reverse()) stack.push({node:child,depth:depth+1});
  }
}
const has=(node,cls)=>node.classes.includes(cls);
const text=node=>[...nodes(node)].map(n=>n.text).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
function one(root,predicate) {
  const matches=[...nodes(root)].filter(predicate);
  if (matches.length!==1) throw new Error('unexpected_layout');
  return matches[0];
}
function seat(cell,index) {
  const seatClass=['일반실','특실'][index], label=text(cell);
  let status='unknown',price=null;
  if (has(cell,'sold_out') || label==='매진') status='sold_out';
  else if (label==='-') status='unavailable';
  else if (label==='예약대기') status='waitlist';
  else if (has(cell,'yms') || /입석|자유석/.test(label)) status='standing_combo';
  else if (has(cell,index===0?'gen':'spe')) {
    const labels=[...nodes(cell)].filter(n=>has(n,'txt_ch'));
    const prices=[...nodes(cell)].filter(n=>has(n,'txt_price'));
    if (labels.length===1 && prices.length===1 &&
        new RegExp('^'+seatClass+'(?:\\([^)]*\\))?$').test(text(labels[0]))) {
      let amount=text(prices[0]);
      // Discount cards put the percentage in txt_price and the fare in txt_gr.
      if (/^(?:운임)?\d{1,2}% 할인$/.test(amount)) {
        const fares=[...nodes(cell)].filter(n=>has(n,'txt_gr') && /^(?:\d{1,3}(?:,\d{3})*|\d+)원$/.test(text(n)));
        amount=fares.length===1?text(fares[0]):'';
      }
      if (/^(?:\d{1,3}(?:,\d{3})*|\d+)원$/.test(amount)) {
        price=Number(amount.replace(/[,원]/g,''));
        if (price>0) status='available';
      }
    }
  }
  return {seatClass,status,price,label,selected:has(cell,'active')};
}
export function parseSnapshot(snapshot) {
  if (!snapshot?.ok || snapshot.schemaVersion!==1 || snapshot.truncated ||
      snapshot.source!=='https://www.korail.com/ticket/search/list') throw new Error('invalid_snapshot');
  const c=snapshot.conditions;
  const date=c?.date?.match(/^(\d{4}-\d{2}-\d{2})\(/)?.[1];
  if (!date || !c.departure || !c.arrival || c.departure===c.arrival ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new Error('invalid_conditions');
  const rowNodes=[...nodes(snapshot.structure)].filter(n=>n.tag==='li' && has(n,'tckList'));
  if (rowNodes.length>100 || (!rowNodes.length && snapshot.status!=='empty')) throw new Error('missing_rows');
  const trains=rowNodes.map(row=>{
    const header=one(row,n=>has(n,'info_inner'));
    const number=text(one(header,n=>has(n,'num')));
    const type=text(one(header,n=>has(n,'blind')));
    const route=one(header,n=>n.tag==='h3' && has(n,'txt_bk'));
    const spans=route.children.filter(n=>n.tag==='span');
    if (spans.length!==3 || text(spans[0])!==c.departure || text(spans[1])!==c.arrival ||
        !/^\d{1,5}$/.test(number)) throw new Error('route_mismatch');
    const times=text(spans[2]).match(/^\(\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*~\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*\)$/);
    if (!times) throw new Error('invalid_times');
    const cells=[...nodes(row)].filter(n=>has(n,'price_box'));
    if (cells.length!==2) throw new Error('invalid_seat_columns');
    const seats=cells.map(seat);
    const key={date,departure:c.departure,arrival:c.arrival,time:times[1],number};
    return {key,id:JSON.stringify(Object.values(key)),type,arrivalTime:times[2],seats,
      availableClasses:seats.filter(s=>s.status==='available').map(s=>s.seatClass)};
  });
  if (new Set(trains.map(t=>t.id)).size!==trains.length) throw new Error('duplicate_train');
  return {trains};
}
export function summarizeTargets(trains,times) {
  return times.map(time=>({time,matches:trains.filter(t=>t.key.time===time)}));
}
