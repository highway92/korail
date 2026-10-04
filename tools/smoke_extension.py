"""Offline reader and popup checks; no live Korail or installed extension tested."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

folder=Path('extension').resolve()
manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
assert manifest['permissions']==['activeTab','scripting']
assert 'host_permissions' not in manifest and 'content_scripts' not in manifest
source=(folder/'reader.js').read_text(encoding='utf-8').replace('export function','function',1)
read='(() => {'+source+'; return readPublicSearch();})()'
fixture='''<!doctype html><meta charset="utf-8">
<input id="startDate" readonly value="2026-10-09(금) 07:00">
<input id="labelstart" readonly value="용산"><input id="labelend" readonly value="정읍">
<input id="labelple" readonly value="총 1명"><p>OUTSIDE_SECRET</p>
<div class="tckWrap"><ul>
<li class="sample"><span>KTX 산천 409</span><span>용산 → 정읍(07:47 ~ 09:23)</span><button data-token="TOKEN_SECRET">매진</button></li>
<li class="sample"><span>KTX 산천 411</span><span>용산 → 정읍(08:20 ~ 09:50)</span><span>매진</span>
<div hidden>HIDDEN_SECRET</div><div style="opacity:0">INVISIBLE_SECRET</div><input type="hidden" value="FORM_SECRET"></li>
</ul></div><button class="reserve" data-token="ACTION_SECRET">예매</button>
<div hidden><button>예매</button></div><button>ACCOUNT_SECRET</button>'''
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page()
    page.route('**/*',lambda route:route.fulfill(body=fixture,content_type='text/html;charset=utf-8'))
    page.goto('https://www.korail.com/ticket/search/list?token=QUERY_SECRET')
    before=page.content()
    report=page.evaluate(read)
    assert report['ok'] and report['status']=='readable' and len(report['rows'])==2
    assert report['conditions']['departure']=='용산'
    assert report['source']=='https://www.korail.com/ticket/search/list'
    assert 'SECRET' not in json.dumps(report)
    assert report['actions']==[{'tag':'button','text':'예매','classes':['reserve'],'disabled':False}]
    assert page.content()==before
    page.goto('https://www.korail.com/ticket/reservation/detail')
    assert page.evaluate(read)=={'ok':False,'code':'wrong_page'}
    page.goto('https://www.korail.com/ticket/search/list')
    page.locator('.tckWrap').evaluate('(e)=>e.innerHTML="<ul><li>해당 스케줄에 운행하는 열차가 없습니다.</li></ul>"')
    assert page.evaluate(read)['status']=='empty'
    page.locator('.tckWrap').evaluate('(e)=>e.remove()')
    assert page.evaluate(read)=={'ok':False,'code':'missing_list'}

    popup=browser.new_page(viewport={'width':420,'height':760},accept_downloads=True)
    def asset(route):
        name=route.request.url.split('?',1)[0].rsplit('/',1)[-1]
        path=folder/name
        if path.parent!=folder or not path.is_file():
            route.fulfill(status=404,body=''); return
        kind='text/javascript' if path.suffix=='.js' else 'text/css' if path.suffix=='.css' else 'text/html'
        route.fulfill(body=path.read_text(encoding='utf-8'),content_type=kind+';charset=utf-8')
    popup.route('**/*',asset)
    popup.add_init_script('window.chrome={tabs:{query:async()=>[{id:1}]},scripting:{executeScript:async()=>[{result:'+json.dumps(report,ensure_ascii=False)+'}]}};')
    popup.goto('https://extension.test/popup.html')
    popup.get_by_role('button',name='현재 목록 읽기').click()
    expect(popup.locator('#status')).to_contain_text('항목 2개')
    expect(popup.locator('#rows li')).to_have_count(2)
    with popup.expect_download() as download_info:
        popup.get_by_role('button',name='진단 파일 저장').click()
    downloaded=json.loads(Path(download_info.value.path()).read_text(encoding='utf-8'))
    assert downloaded['structure']==report['structure'] and downloaded['parseStatus']=='needs_inspection'
    actual=json.loads(Path('tests/fixtures/korail-public-rows.json').read_text(encoding='utf-8'))
    actual.update(rows=[],documentEpoch=1)
    popup.evaluate('data=>{window.probeData=data;window.probeReloads=0;chrome.tabs.reload=async()=>{window.probeReloads++;window.probeData.documentEpoch=2;};chrome.scripting.executeScript=async()=>[{result:structuredClone(window.probeData)}];}',actual)
    popup.get_by_role('button',name='현재 목록 읽기').click()
    expect(popup.locator('#status')).to_contain_text('열차 4편')
    expect(popup.locator('#targets')).to_contain_text('08:20 · 411편')
    popup.get_by_role('button',name='갱신 1회 시험').click()
    expect(popup.locator('#status')).to_contain_text('새로 열린 문서',timeout=5000)
    assert popup.evaluate('window.probeReloads')==1
    Path('.artifacts').mkdir(exist_ok=True)
    popup.screenshot(path='.artifacts/extension-popup.png',full_page=True)
    # Dashboard uses the saved target tab, not whichever tab is currently active.
    dashboard_context=browser.new_context(viewport={'width':650,'height':1000})
    dashboard=dashboard_context.new_page()
    dashboard.route('**/*',asset)
    dashboard.add_init_script('window.data='+json.dumps(actual,ensure_ascii=False)+';window.reloads=0;window.chrome={scripting:{executeScript:async()=>[{result:structuredClone(window.data)}]},tabs:{reload:async()=>{window.reloads++;window.data.documentEpoch++;}}};')
    dashboard.goto('https://extension.test/monitor.html?tab=1')
    dashboard.get_by_role('button',name='현재 목록 불러오기').click()
    expect(dashboard.locator('#trains input')).to_have_count(4)
    expect(dashboard.locator('#general')).to_be_checked()
    expect(dashboard.locator('#special')).to_be_checked()
    cards=dashboard.context.new_page()
    cards.route('**/*',asset)
    cards.goto('https://extension.test/cards.html')
    for key,value in {'number':'0000000000000000','month':'06','year':'2099','birth':'000101','pin':'00'}.items():
        cards.locator('#'+key).fill(value)
    cards.get_by_role('button',name='저장',exact=True).click()
    expect(cards.locator('#status')).to_contain_text('저장했습니다')
    expect(dashboard.locator('#saved-card')).to_contain_text('0000')
    cards.reload()
    expect(cards.locator('#summary')).to_contain_text('0000')
    cards.get_by_role('button',name='저장 카드 수정').click()
    expect(cards.locator('#number')).to_have_value('0000000000000000')
    cards.screenshot(path='.artifacts/card-management.png',full_page=True)
    dashboard.locator('#interval').fill('1')
    dashboard.locator('#maxQueries').fill('1')
    dashboard.get_by_role('button',name='반복 조회 시작').click()
    expect(dashboard.locator('#status')).to_contain_text('조회 횟수',timeout=7000)
    assert dashboard.evaluate('window.reloads')==1
    dashboard.locator('#trains input').nth(1).uncheck()
    dashboard.locator('#interval').fill('30')
    dashboard.get_by_role('button',name='반복 조회 시작').click()
    expect(dashboard.locator('#status')).to_contain_text('다음 조회 대기')
    dashboard.get_by_role('button',name='중지',exact=True).click()
    expect(dashboard.locator('#status')).to_contain_text('중지했습니다')
    assert dashboard.evaluate('window.reloads')==1
    dashboard.screenshot(path='.artifacts/extension-monitor.png',full_page=True)
    # One start executes the entire mocked transaction; card inputs are not requested again.
    dashboard.evaluate('''()=>{
      localStorage.setItem('korail-transaction-v1','{old_broken_record');window.reserveAttempts=0;window.trainConfirms=0;window.notice=null;window.flowPage='search';window.payments=0;window.fills=0;
      chrome.scripting.executeScript=async({func,args})=>{
        if(func.name==='readPublicSearch')return [{result:structuredClone(window.data)}];
        if(func.name==='searchAction'){
          if(args[0].mode==='reserve'){window.reserveAttempts++;if(window.reserveAttempts===1)return [{result:{ok:false,code:'covered_action'}}];if(window.reserveAttempts<=3)window.notice='train';else window.flowPage='reservation';}return [{result:{ok:true}}];
        }
        if(func.name==='checkoutPage'){
          const mode=args[0].mode;
          if(mode==='dismiss'){window.notice=null;window.trainConfirms++;if(window.trainConfirms===2)window.flowPage='reservation';}
          if(mode==='inspect'&&window.notice)return [{result:{ok:true,page:window.flowPage,notice:window.notice}}];
          if(mode==='openPayment')window.flowPage='payment';
          if(mode==='submitPayment'){window.flowPage='tickets';window.payments++;}
          return [{result:{ok:true,page:window.flowPage,match:true,reservation:{coach:'14',seat:'2A',deadline:Date.now()+600000}}}];
        }
        if(func.name==='fillPersonalCard'){
          if(args[0].number!=='0000000000000000')throw Error('missing_card');
          window.fills++;return [{result:{ok:true}}];
        }
        throw Error('unexpected_function');
      };
    }''')
    dashboard.locator('#trains input').nth(1).check()
    dashboard.locator('#action-delay').fill('0')
    assert dashboard.locator('#auto-payment, #auto-reserve, #archive-transaction').count()==0
    dashboard.get_by_role('button',name='반복 조회 시작').click()
    expect(dashboard.locator('#status')).to_contain_text('실행을 완료했습니다',timeout=7000)
    assert dashboard.evaluate('window.payments')==1
    assert dashboard.evaluate('window.reserveAttempts')==3
    assert dashboard.evaluate('window.trainConfirms')==2
    assert dashboard.evaluate('window.fills')==2
    assert '0000000000000000' not in dashboard.evaluate('localStorage.getItem("korail-transaction-v1")')
    assert dashboard.locator('#card-agree').count()==0
    assert dashboard.locator('#card-app').count()==0
    cards.get_by_role('button',name='삭제',exact=True).click()
    expect(dashboard.locator('#saved-card')).to_contain_text('저장된 카드 없음')
    browser.close()
print('Offline extension checks OK: scope, public rows, no secrets, empty/unknown states, popup, JSON download')
