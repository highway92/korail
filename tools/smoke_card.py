"""Synthetic card values and mocked page only. No real site or payment request."""
from pathlib import Path
from playwright.sync_api import sync_playwright

source=Path('extension/card-dom.js').read_text(encoding='utf-8').replace('export async function','async function')
fixture='''<!doctype html><meta charset="utf-8">
<select id="sale_sel"><option>할인 방법 선택</option></select>
<label for="option01">개인카드</label><input type="radio" id="option01" name="kind" checked>
<label for="option02">법인카드</label><input type="radio" id="option02" name="kind">
<input type="text"><input type="password"><input type="password"><input type="text">
<input type="text" id="mon03"><select><option value="99">2099</option></select>
<label for="certi_num">인증번호</label><input type="password" id="certi_num">
<select><option value="00">일시불</option><option value="03">3개월</option></select>
<input type="password"><label for="check">동의함</label><input type="checkbox" id="check">
<label for="shuttle01">코레일 앱(스마트티켓)으로 발권</label><input type="checkbox" id="shuttle01">
<input type="checkbox" id="savePaymentMethod">
<button class="btn_bn-depblue" onclick="window.submissions++">결제/발권</button>
<script>window.submissions=0;</script>'''
card={'number':'0000000000000000','month':'06','year':'2099','birth':'000101','pin':'00','agree':True,'appTicket':True}
def fill(page,data=card):return page.evaluate('(card)=>{'+source+';return fillPersonalCard(card);}',data)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page()
    page.route('**/*',lambda r:r.fulfill(body=fixture,content_type='text/html;charset=utf-8'))
    page.goto('https://www.korail.com/ticket/payment/payment')
    result=fill(page)
    assert result=={'ok':True,'stage':'card_filled_not_submitted'}
    assert page.locator('#mon03').input_value()=='6'
    assert page.locator('select').nth(1).input_value()=='99'
    assert page.locator('select').nth(2).input_value()=='00'
    assert page.locator('#check').is_checked() and page.locator('#shuttle01').is_checked()
    assert not page.locator('#savePaymentMethod').is_checked()
    assert page.evaluate('window.submissions')==0
    page.reload()
    assert fill(page,{**card,'number':'1'})['code']=='invalid_card_input'
    assert page.locator('#certi_num').input_value()==''
    page.evaluate('document.body.insertAdjacentHTML("afterbegin", "<input type=text>")')
    assert fill(page)['code']=='card_layout_mismatch'
    page.reload()
    page.locator('#option02').check()
    assert fill(page)['code']=='personal_card_required'
    page.reload()
    page.locator('#certi_num').evaluate('(el)=>el.addEventListener("input",()=>el.value="")')
    assert fill(page)['code']=='input_not_retained'
    assert page.locator('input[type=password]').first.input_value()==''
    assert page.evaluate('window.submissions')==0
    page.goto('https://www.korail.com/ticket/login')
    assert fill(page)['code']=='wrong_page'
    browser.close()
print('Offline card checks passed: strict layout, synthetic fill, no submission, invalid data, changed layout, input rejection cleanup.')
