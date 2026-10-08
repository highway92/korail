"""Offline fixture only: no Korail request or real reservation/payment."""
import html
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

source=Path('extension/booking-dom.js').read_text(encoding='utf-8').replace('export function','function')
def call(page,name,arg=None):
    return page.evaluate('(arg)=>{'+source+';return '+name+'(arg);}',arg)
def render(node):
    tag=node['tag']
    return '<'+tag+' class="'+html.escape(' '.join(node['classes']))+'">'+html.escape(node['text'])+''.join(render(c) for c in node['children'])+'</'+tag+'>'
data=json.loads(Path('tests/fixtures/korail-selected-discount.json').read_text(encoding='utf-8'))
fixture='<!doctype html><meta charset="utf-8">'+''.join('<input id="'+id+'" value="'+html.escape(value)+'">' for id,value in {
    'startDate':data['conditions']['date'],'labelstart':'용산','labelend':'정읍','labelple':'총 1명'}.items())
fixture+=render(data['structure'])+'<button class="path_button reservbtn" onclick="window.wrong++">예매</button><button class="reservbtn btn_bn-blue02" onclick="window.submits++">예매</button>'
fixture+='<script>window.wrong=0;window.submits=0;</script>'
arg={'mode':'reserve','key':{'date':'2026-10-07','departure':'용산','arrival':'정읍','time':'05:48','number':'403'},'seatClass':'일반실'}
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page()
    page.route('**/*',lambda r:r.fulfill(body=fixture,content_type='text/html;charset=utf-8'))
    page.goto('https://www.korail.com/ticket/search/list')
    page.evaluate("""()=>{window.inputEvents=[];for(const t of ['pointerdown','mousedown','pointerup','mouseup','click'])document.querySelector('button.btn_bn-blue02').addEventListener(t,e=>window.inputEvents.push([e.type,e.isTrusted]));}""")
    prepared=call(page,'searchAction',{**arg,'native':True})
    assert prepared['ok'] and prepared['native'] is True
    assert page.evaluate('[window.submits,window.wrong,window.inputEvents.length]')==[0,0,0]
    assert page.evaluate("window.__korailNativeTarget.element.matches('button.btn_bn-blue02.reservbtn')")
    result=call(page,'searchAction',arg)
    assert result['ok'] and set(result['target']['classes'])=={'btn_bn-blue02','reservbtn'}
    assert page.evaluate('[window.submits,window.wrong]')==[1,0]
    assert page.evaluate('window.inputEvents')==[[t,False] for t in ['pointerdown','mousedown','pointerup','mouseup','click']]
    assert result['input']=='pointer_sequence' and result['clickDispatched']
    page.evaluate("""()=>{document.documentElement.style.scrollBehavior='smooth';const cover=document.createElement('div');cover.id='cover';cover.className='modal-backdrop';cover.style='position:fixed;inset:0;z-index:999999';document.body.append(cover);}""")
    result=call(page,'searchAction',arg)
    assert result['code']=='covered_action' and result['blocker']['classes']==['modal-backdrop']
    assert page.evaluate('window.submits')==1
    page.locator('#cover').evaluate('(e)=>e.remove()')
    bad={**arg,'key':{**arg['key'],'number':'409'}}
    assert call(page,'searchAction',bad)['code']=='ambiguous_train'
    page.locator('.price_box.active').evaluate('(el)=>el.classList.remove("active")')
    assert call(page,'searchAction',arg)['code']=='selection_mismatch'
    page.locator('.price_box.gen a').evaluate('(el)=>el.onclick=()=>el.closest(".price_box").classList.add("active")')
    assert call(page,'searchAction',{**arg,'mode':'select'})['ok']
    assert call(page,'searchAction',{**arg,'mode':'verify'})['ok']
    page.locator('.price_box.gen').evaluate('(el)=>el.classList.add("sold_out")')
    assert call(page,'searchAction',arg)['code']=='seat_unavailable'
    assert page.evaluate('window.submits')==1
    page.locator('.price_box.gen').evaluate('(el)=>el.classList.remove("sold_out")')
    page.locator('button.btn_bn-blue02').evaluate('(el)=>el.addEventListener("pointerdown",()=>el.remove())')
    result=call(page,'searchAction',arg)
    assert result['ok'] and result['clickDispatched'] is False
    assert page.evaluate('window.submits')==1
    page.goto('https://www.korail.com/ticket/payment/payment?token=URL_SECRET')
    page.set_content('<label for="card">신용카드 번호</label><input id="card" value="CARD_SECRET"><input type="password" value="PIN_SECRET"><input type="hidden" value="HIDDEN_SECRET"><button>결제/발권</button><p>결제가 완료되었습니다.</p><p>ACCOUNT_SECRET</p>')
    result=call(page,'inspectBookingPage')
    assert result['page']=='payment' and result['notices']==['결제가 완료되었습니다.']
    assert 'SECRET' not in json.dumps(result)
    assert len(result['fields'])==2
    assert call(page,'searchAction',arg)['code']=='wrong_page'
    page.goto('https://www.korail.com/ticket/login')
    assert call(page,'inspectBookingPage')=={'page':'login'}
    browser.close()
print('Offline booking DOM checks passed: identity, selection, one exact button, unavailable seat, value-free diagnostics.')
