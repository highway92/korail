import {saveLocalCard,loadLocalCard,deleteLocalCard,cardSummary} from './card-store.js';
import {unlockCard} from './vault.js';
const $=id=>document.getElementById(id),keys=['number','month','year','birth','pin'];
const clear=()=>{for(const key of keys)$(key).value='';$('legacy-password').value='';};
function refresh(){
  try{$('summary').textContent=cardSummary(localStorage);}catch{$('summary').textContent='저장 카드 오류 — 다시 저장하거나 삭제해 주세요.';}
  $('legacy').hidden=!localStorage.getItem('korail-card-vault-v1');
}
$('card-form').onsubmit=e=>{
  e.preventDefault();
  try{saveLocalCard(localStorage,Object.fromEntries(keys.map(k=>[k,$(k).value.trim()])));clear();refresh();$('status').textContent='저장했습니다. 다음 실행부터 자동으로 사용합니다.';}
  catch{$('status').textContent='입력 자리수와 유효기간 형식을 확인해 주세요.';}
};
$('edit').onclick=()=>{try{const card=loadLocalCard(localStorage);if(!card)return;for(const k of keys)$(k).value=card[k];$('status').textContent='수정 후 저장을 눌러 주세요.';}catch{$('status').textContent='카드를 읽을 수 없습니다.';}};
$('delete').onclick=()=>{try{deleteLocalCard(localStorage);clear();refresh();$('status').textContent='저장된 카드정보를 삭제했습니다. 이미 실행 중인 작업에는 다음 실행부터 반영됩니다.';}catch{$('status').textContent='삭제하지 못했습니다.';}};
$('import').onclick=async()=>{
  $('import').disabled=true;
  try{const card=await unlockCard(localStorage,$('legacy-password').value);saveLocalCard(localStorage,card);localStorage.removeItem('korail-card-vault-v1');refresh();$('status').textContent='가져왔습니다. 이후에는 비밀번호 없이 자동 사용합니다.';}
  catch{$('status').textContent='가져오지 못했습니다. 기존 비밀번호와 저장 상태를 확인해 주세요.';}
  finally{clear();$('import').disabled=false;}
};
window.addEventListener('pagehide',clear);refresh();
