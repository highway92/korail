// Page navigation and booking identity are different conditions.
export function pageReadiness(expected,state){
  const arrived=state.page===expected||(expected==='reservation'&&['reservation_list','payment'].includes(state.page));
  if(!arrived)return 'other';
  if(expected==='search'||state.page==='payment')return 'ready';
  return state.match===false?'waiting':'ready';
}
