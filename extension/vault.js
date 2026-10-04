// Local encrypted vault. The unlock password and derived key are never persisted.
const storageKey='korail-card-vault-v1';
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function valid(card){
  return card&&/^\d{16}$/.test(card.number)&&/^(?:0?[1-9]|1[0-2])$/.test(card.month)&&/^\d{4}$/.test(card.year)&&/^\d{6}$/.test(card.birth)&&/^\d{2}$/.test(card.pin);
}
async function key(password,salt){
  if(typeof password!=='string'||password.length<10||password.length>1024)throw new Error('vault_password');
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function saveCard(storage,card,password){
  if(!valid(card))throw new Error('invalid_card');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(password,salt),new TextEncoder().encode(JSON.stringify(
    Object.fromEntries(['number','month','year','birth','pin'].map(k=>[k,card[k]])))));
  storage.setItem(storageKey,JSON.stringify({version:1,salt:encode(salt),iv:encode(iv),cipher:encode(cipher)}));
}
export async function unlockCard(storage,password){
  try{
    const raw=storage.getItem(storageKey);if(!raw||raw.length>4096)throw new Error();
    const data=JSON.parse(raw);if(data.version!==1)throw new Error();
    const salt=decode(data.salt),iv=decode(data.iv);if(salt.length!==16||iv.length!==12)throw new Error();
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},await key(password,salt),decode(data.cipher));
    const card=JSON.parse(new TextDecoder().decode(plain));if(!valid(card))throw new Error();return card;
  }catch{throw new Error('vault_unlock_failed');}
}
export function deleteCard(storage){storage.removeItem(storageKey);}
