// Serialized into the granted Korail payment tab. Never submits or returns field values.
export async function fillPersonalCard(card,verifyOnly=false) {
  card={...card,agree:true,appTicket:true};
  const fail=code=>({ok:false,code});
  if(location.origin!=='https://www.korail.com'||location.pathname!=='/ticket/payment/payment')return fail('wrong_page');
  const text=el=>(el.textContent||'').replace(/\s+/g,' ').trim();
  const visible=el=>{
    if(!el.getClientRects().length)return false;
    for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}
    return true;
  };
  // All fifteen visible controls must match the supplied real-page diagnostic.
  const shape=[['select-one','sale_sel'],['radio','option01'],['radio','option02'],
    ['text',''],['password',''],['password',''],['text',''],['text','mon03'],
    ['select-one',''],['password','certi_num'],['select-one',''],['password',''],
    ['checkbox','check'],['checkbox','shuttle01'],['checkbox','savePaymentMethod']];
  function fields(){
    const items=[...document.querySelectorAll('input,select')].filter(el=>visible(el)&&el.type!=='hidden');
    if(items.length!==shape.length||items.some((el,i)=>el.type!==shape[i][0]||el.id!==shape[i][1]))return null;
    const labeled=(index,label)=>[...(items[index].labels||[])].some(el=>text(el)===label);
    if(!labeled(1,'개인카드')||!labeled(2,'법인카드')||!labeled(9,'인증번호')||!labeled(12,'동의함')||!labeled(13,'코레일 앱(스마트티켓)으로 발권'))return null;
    return items;
  }
  const f=fields();
  if(!f)return fail('card_layout_mismatch');
  if(!f[1].checked||f[2].checked)return fail('personal_card_required');
  if(f.some(el=>el.disabled||el.readOnly))return fail('locked_field');
  if(!card||!/^\d{16}$/.test(card.number)||!/^\d{6}$/.test(card.birth)||!/^\d{2}$/.test(card.pin)||
     !/^(?:0?[1-9]|1[0-2])$/.test(card.month)||!/^\d{4}$/.test(card.year)||
     typeof card.agree!=='boolean'||typeof card.appTicket!=='boolean')return fail('invalid_card_input');
  const current=new Date();
  if(Number(card.year)*12+Number(card.month)<current.getFullYear()*12+current.getMonth()+1)return fail('expired_card');
  const yearOptions=[...f[8].options].filter(o=>!o.disabled&&text(o).replace(/\s|년/g,'')===card.year);
  const installments=[...f[10].options].filter(o=>!o.disabled&&text(o)==='일시불');
  if(yearOptions.length!==1||installments.length!==1)return fail('unknown_options');
  const values=new Map([[3,card.number.slice(0,4)],[4,card.number.slice(4,8)],[5,card.number.slice(8,12)],[6,card.number.slice(12)],
    [7,String(Number(card.month))],[8,yearOptions[0].value],[9,card.birth],[10,installments[0].value],[11,card.pin]]);
  if([...values].some(([i,v])=>f[i].tagName==='INPUT'&&f[i].maxLength>=0&&v.length>f[i].maxLength))return fail('field_length_mismatch');
  const buttons=[...document.querySelectorAll('button.btn_bn-depblue')].filter(el=>visible(el)&&text(el)==='결제/발권');
  if(buttons.length!==1)return fail('payment_button_mismatch');
  if(verifyOnly){
    if([...values].some(([i,v])=>f[i].value!==v)||f[12].checked!==card.agree||f[13].checked!==card.appTicket)return fail('input_changed');
    return {ok:true,stage:'card_verified'};
  }
  let touched=false;
  const set=(el,value)=>{
    const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  };
  try {
    for(const [index,value] of values){
      const live=fields();if(!live)throw new Error('layout_changed');
      touched=true;set(live[index],value);
    }
    for(const [index,checked] of [[12,card.agree],[13,card.appTicket]]){
      const live=fields();if(!live)throw new Error('layout_changed');
      if(live[index].checked!==checked)live[index].click();
    }
    // Let controlled inputs process events, then check what the page retained.
    await new Promise(resolve=>setTimeout(resolve,100));
    const live=fields();
    if(!live||[...values].some(([i,v])=>live[i].value!==v)||live[12].checked!==card.agree||live[13].checked!==card.appTicket)
      throw new Error('input_not_retained');
    return {ok:true,stage:'card_filled_not_submitted'};
  } catch {
    // Best effort removal from both original and replacement nodes, never echo values.
    if(touched){const live=fields();for(const index of [3,4,5,6,7,9,11])for(const el of new Set([f[index],live?.[index]])){
      if(el)try{set(el,'');}catch{/* No logging of browser exceptions or input data. */}
    }}
    return fail('input_not_retained');
  } finally {card=null;values.clear();}
}
