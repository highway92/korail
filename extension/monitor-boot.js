// Independent classic script: can report a failed module import before UI handlers exist.
(() => {
  const status=document.getElementById('status');
  const health=document.getElementById('ui-health');
  const fail=code=>{
    health.textContent='설정창 초기화 실패 · '+code;
    status.textContent='이 창을 닫고 확장프로그램을 새로고침한 뒤 다시 열어 주세요. 확인 코드: '+code;
    document.getElementById('single-start').disabled=true;
    document.getElementById('start').disabled=true;
  };
  window.addEventListener('error',()=>fail('ui_script_error'));
  window.addEventListener('unhandledrejection',()=>fail('ui_unhandled_error'));
  const module=document.getElementById('monitor-module');
  module.addEventListener('error',()=>fail('ui_module_load_failed'));
  module.addEventListener('load',()=>{
    if(window.korailMonitorVersion!=='0.12.8'){fail('ui_version_mismatch');return;}
    health.textContent='설정창 준비 완료 · 0.12.8';
  });
  document.getElementById('single-start').addEventListener('click',()=>{
    status.textContent='1건 실행 버튼 입력을 받았습니다…';
  },true);
  setTimeout(()=>{if(window.korailMonitorVersion!=='0.12.8')fail('ui_init_timeout');},5000);
})();
