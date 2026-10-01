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
</ul></div>'''
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
        name=route.request.url.rsplit('/',1)[-1]
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
    browser.close()
print('Offline extension checks OK: scope, public rows, no secrets, empty/unknown states, popup, JSON download')
