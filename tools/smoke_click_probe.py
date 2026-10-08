"""Offline passive click diagnostics: synthetic controls, no live requests."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
source=Path('extension/click-probe.js').read_text(encoding='utf-8').replace('export function','function')
def run(page,mode):
    return page.evaluate('(mode)=>{'+source+';return clickProbe({mode});}',mode)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page()
    page.route('**/*',lambda r:r.fulfill(body='<meta charset="utf-8">',content_type='text/html;charset=utf-8'))
    page.goto('https://www.korail.com/ticket/search/list')
    page.set_content('<input value="PRIVATE_VALUE"><button class="reservbtn btn_bn-blue02" onclick="window.count=(window.count||0)+1">예매</button><button>확인</button><button>PRIVATE_ACCOUNT</button>')
    assert run(page,'start')['ok']
    assert page.evaluate('window.count||0')==0
    page.locator('.reservbtn').evaluate('(el)=>el.click()')
    page.get_by_role('button',name='확인',exact=True).click()
    page.get_by_role('button',name='PRIVATE_ACCOUNT').click()
    report=run(page,'read')
    assert len(report['events'])==4
    assert report['events'][0]['trusted'] is False
    assert all(e['trusted'] for e in report['events'][1:])
    assert [e['event'] for e in report['events']]==['click','pointerdown','pointerup','click']
    assert 'PRIVATE' not in json.dumps(report)
    # Reinstallation replaces the listener; it does not duplicate captured events.
    run(page,'start');run(page,'start')
    page.locator('.reservbtn').evaluate('(el)=>el.click()')
    assert len(run(page,'read')['events'])==1
    page.goto('https://www.korail.com/ticket/payment/payment')
    page.set_content('<input value="CARD_SECRET"><button>확인</button>')
    page.get_by_role('button',name='확인').click()
    assert len(run(page,'read')['events'])==1
    assert run(page,'start')['code']=='wrong_page'
    assert run(page,'stop')['ok']
    assert run(page,'read')['events']==[]
    browser.close()
print('Offline passive click probe checks passed: no actions, trusted/untrusted capture, navigation persistence, payment excluded, no values.')
