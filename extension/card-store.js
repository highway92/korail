// User-requested local-only plain storage. Never add card data to transaction logs.
export const CARD_KEY='korail-local-card-v1';
const fields=['number','month','year','birth','pin'];
export function validateCard(card){
  if(!card||!/^\d{16}$/.test(card.number)||!/^(?:0?[1-9]|1[0-2])$/.test(card.month)||
    !/^\d{4}$/.test(card.year)||!/^\d{6}$/.test(card.birth)||!/^\d{2}$/.test(card.pin))throw new Error('invalid_card');
  return Object.fromEntries(fields.map(k=>[k,card[k]]));
}
export function saveLocalCard(storage,card){storage.setItem(CARD_KEY,JSON.stringify({version:1,card:validateCard(card)}));}
export function loadLocalCard(storage){
  const raw=storage.getItem(CARD_KEY);if(raw===null)return null;
  const value=JSON.parse(raw);if(value.version!==1)throw new Error('invalid_card');
  return {...validateCard(value.card),agree:true,appTicket:true};
}
export function deleteLocalCard(storage){storage.removeItem(CARD_KEY);storage.removeItem('korail-card-vault-v1');}
export function cardSummary(storage){const card=loadLocalCard(storage);return card?'개인카드 · 끝 4자리 '+card.number.slice(-4):'저장된 카드 없음';}
