// Keep diagnostic codes and timings only. Never serialize card/form values or DOM text.
const code=value=>typeof value==='string'&&/^[a-z_]{1,80}$/.test(value)?value:undefined;
export function failureReport(event,version,now=new Date()) {
  const trace=(event.trace||[]).slice(-200).map(item=>Object.fromEntries([
    ['focused',typeof item.focused==='boolean'?item.focused:undefined],['visibility',code(item.visibility)],['windowState',code(item.windowState)],['action',code(item.action)],['page',code(item.page)],['notice',code(item.notice)],
    ['input',code(item.input)],['at',Number.isFinite(item.at)?item.at:undefined],
    ['inputMs',Number.isFinite(item.inputMs)?item.inputMs:undefined],
    ['clickDispatched',typeof item.clickDispatched==='boolean'?item.clickDispatched:undefined],
    ['match',typeof item.match==='boolean'?item.match:undefined]
  ].filter(([,v])=>v!==undefined)));
  return {version,createdAt:now.toISOString(),state:code(event.state),stage:code(event.stage),reason:code(event.reason),trace};
}
export async function saveFailureLog(event,{storage=localStorage,downloads=chrome.downloads,version='0.12.8',now=new Date()}={}) {
  const report=failureReport(event,version,now);
  // Backup survives a failed download and subsequent macro starts.
  storage.setItem('korail-last-failure-v1',JSON.stringify(report));
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  try {
    await downloads.download({url,filename:'korail-logs/failure-'+now.toISOString().replace(/[:.]/g,'-')+'.json',saveAs:false,conflictAction:'uniquify'});
  } finally {const timer=setTimeout(()=>URL.revokeObjectURL(url),60000);timer.unref?.();}
  return report;
}
