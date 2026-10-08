"""Offline semantic page adapter checks; never contacts Korail."""
from pathlib import Path
from playwright.sync_api import sync_playwright
source=Path('extension/checkout-dom.js').read_text(encoding='utf-8').replace('export function','function')
candidate={'train':{'key':{'date':'2099-10-09','departure':'용산','arrival':'정읍','time':'07:47','number':'409'}},'seatClass':'일반실'}
reservation={'coach':'14','seat':'2A','deadline':4096252800000}
target='<div class="booking"><h3>KTX-산천 409 2099년10월09일(금)</h3><p>용산 → 정읍 (07:47 ~ 09:23)</p><p>일반실 14호차 2A</p>{}</div>'
def run(page,mode='inspect',**extra):
    return page.evaluate('(args)=>{'+source+';return checkoutPage(args);}',{'mode':mode,'candidate':candidate,**extra})
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':1000,'height':1000})
    page.route('**/*',lambda r:r.fulfill(body='<meta charset="utf-8">',content_type='text/html;charset=utf-8'))
    page.goto('https://www.korail.com/ticket/search/list')
    page.set_content('<div><h2>이용안내</h2><p>선택하신 열차는 KTX-산천 2개 편성을 연결하여 운행하는 열차로서, 반드시 열차 번호와 해당호차를 확인하시고 승차하시기 바랍니다.</p><button onclick="this.parentNode.remove()">확인</button></div><button onclick="window.wrong=true">확인</button>')
    assert run(page)['notice']=='train'
    prepared=run(page,'dismiss',notice='train',native=True)
    assert prepared['ok'] and prepared['native'] is True
    assert page.locator('div button').count()==1
    assert page.evaluate("window.__korailNativeTarget.element===document.querySelector('div button')")
    page.evaluate("""()=>{const b=document.querySelector('div button');b.onclick=()=>{if(window.pressed)b.parentNode.remove()};b.addEventListener('pointerdown',()=>window.pressed=true);}""")
    assert run(page,'dismiss',notice='train')['ok']
    assert page.locator('div button').count()==0
    assert not page.evaluate('Boolean(window.wrong)')
    for message,kind in [('서대전정차하는 열차입니다. 도착시간을 확인하시기 바랍니다.','route'),('열차의 운행 시간을 확인하시기 바랍니다.','info_')]:
        page.set_content('<div><h2>이용안내</h2><p>'+message+'</p><button onclick="this.parentNode.remove()">확인</button></div>')
        result=run(page)
        assert result['notice'].startswith(kind)
        assert run(page,'dismiss',notice=result['notice'])['ok']
    page.set_content('<div><h2>이용안내</h2><p>매진으로 예약할 수 없습니다.</p><button>확인</button></div>')
    assert 'notice' not in run(page)
    page.set_content('<div><h2>이용안내</h2><p>열차 안내입니다.</p><button>확인</button><button>취소</button></div>')
    assert 'notice' not in run(page)
    duplicate='<div><h2>안내 메시지</h2><p>동일한 예약 내역이 있으니, 기존 예약 건을 취소하거나 발권 후 구매하시기 바랍니다.</p><button onclick="window.other=(window.other||0)+1">다른여정예약</button><button onclick="window.historyClicked=true">예약내역확인</button></div>'
    page.set_content(duplicate+'<button onclick="window.wrong=true">다른여정예약</button>')
    assert run(page)['notice']=='duplicate_journey'
    assert run(page,'dismiss',notice='duplicate_journey')['ok']
    assert page.evaluate('window.other')==1 and not page.evaluate('Boolean(window.historyClicked)')
    assert not page.evaluate('Boolean(window.wrong)')
    for path in ['reservation/detail','reservation/list','payment/payment']:
        page.goto('https://www.korail.com/ticket/'+path)
        page.set_content(duplicate)
        assert run(page)['notice']=='duplicate_journey'
        prepared=run(page,'dismiss',notice='duplicate_journey',native=True)
        assert prepared['native'] and prepared['target']['text']=='다른여정예약'
        assert not page.evaluate('Boolean(window.historyClicked)')
    for path in ['search/list','reservation/detail','payment/payment']:
        page.goto('https://www.korail.com/ticket/'+path)
        confirm_only=duplicate.replace('다른여정예약','확인')
        page.set_content(confirm_only)
        assert run(page)['notice']=='duplicate_journey'
        prepared=run(page,'dismiss',notice='duplicate_journey',native=True)
        assert prepared['target']['text']=='확인'
        page.set_content(duplicate.replace('</div>','<button>확인</button></div>'))
        assert run(page,'dismiss',notice='duplicate_journey',native=True)['target']['text']=='다른여정예약'
    page.goto('https://www.korail.com/ticket/search/list')
    page.set_content(duplicate.replace('동일한 예약 내역이 있으니,','다른 안내입니다.'))
    assert 'notice' not in run(page)
    page.set_content(duplicate.replace('예약내역확인','취소'))
    assert 'notice' not in run(page)
    page.goto('https://www.korail.com/ticket/reservation/detail')
    page.set_content(target.format('<p>결제기한: 2099. 10. 08. 12:00</p>')+'<button onclick="window.next=true">결제하기</button>')
    result=run(page)
    assert result['match'] and result['reservation']['seat']=='2A'
    reservation=result['reservation']
    assert run(page,'openPayment',reservation=reservation)['ok']
    assert page.evaluate('window.next')
    page.goto('https://www.korail.com/ticket/payment/payment')
    # Adjacent inline badges have CSS spacing but no literal whitespace in innerText.
    inline='<div class="booking"><h3><span>KTX-산천</span><span>409</span><span>2099년10월09일(금)</span></h3><p>용산 → 정읍 (07:47 ~ 09:23)</p><p>일반실 | 순방향 | 14호차 | 2A | 어른</p></div>'
    page.set_content(inline+'<p>합계(1건): 29,700원</p>')
    assert not page.locator('h3').inner_text().startswith('KTX-산천 409 ')
    assert run(page,reservation=reservation)['match']
    page.set_content(inline.replace('<span>409</span>','<span>4090</span>')+'<p>합계(1건): 29,700원</p>')
    mismatch=run(page,reservation=reservation)
    assert mismatch['match'] # User requested paying the current page without identity comparison.
    page.set_content(target.format('')+'<p>합계(1건): 29,700원</p><button onclick="window.card=true">카드결제</button><input id="option01" type="radio" checked><input id="check" type="checkbox" checked><input id="shuttle01" type="checkbox" checked><button onclick="window.paid=true">결제/발권</button>')
    direct=run(page)
    assert direct['reservation']=={'source':'payment','deadline':None}
    assert run(page,'chooseCard',reservation=direct['reservation'])['ok']
    assert run(page,reservation=reservation)['match']
    assert run(page,'chooseCard',reservation=reservation)['ok']
    assert run(page,'submitPayment',reservation=reservation)['ok']
    assert page.evaluate('window.paid')
    page.locator('p').filter(has_text='합계').evaluate('(el)=>el.textContent="합계(2건): 59,400원"')
    assert run(page,'submitPayment',reservation=reservation)['ok']
    page.set_content('<button onclick="window.card=true">카드결제</button><input id="option01" type="radio" checked><input id="check" type="checkbox" checked><input id="shuttle01" type="checkbox" checked><button onclick="window.paid=true">결제/발권</button>')
    assert run(page)['match'] and run(page,'chooseCard')['ok']
    assert run(page,'submitPayment')['ok'] and page.evaluate('window.paid')
    page.locator('#shuttle01').uncheck()
    assert run(page,'submitPayment')['code']=='card_not_ready'
    page.goto('https://www.korail.com/ticket/reservation/list#')
    listing='<section><span>1매</span><h3>KTX-산천 409 2099년10월09일(금)</h3><p>용산 → 정읍 (07:47 ~ 09:23)</p><p>결제기한: 2099. 10. 08. 12:00</p><button onclick="window.selected=true">결제/발권</button></section>'
    page.set_content(listing+'<button onclick="window.wrong=true">결제/발권</button>')
    result=run(page)
    assert result['match'] and result['reservation']['source']=='reservation_list'
    assert run(page,'openPayment',reservation=result['reservation'])['ok']
    assert page.evaluate('window.selected') and not page.evaluate('Boolean(window.wrong)')
    page.set_content(listing+listing)
    assert not run(page)['match']
    page.set_content(listing.replace('1매','2매'))
    assert run(page)['code']=='unknown_passenger_count'
    page.set_content(listing.replace('409','411'))
    assert not run(page)['match']
    page.goto('https://www.korail.com/ticket/myticket/list')
    page.set_content(target.format(''))
    assert run(page,reservation=reservation)['match']
    assert not run(page,reservation={**reservation,'seat':'9B'})['match']
    page.set_content(target.format('')+target.format(''))
    assert not run(page,reservation=reservation)['match']
    browser.close()
print('Offline checkout DOM checks passed: scoped notice, reservation, single-target payment, exact seat, duplicate rejection.')
