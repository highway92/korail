"""Read-only search-flow investigation; never reserves or requests payment."""
from pathlib import Path
import argparse
import json
import re
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

args = argparse.ArgumentParser()
args.add_argument('--date', default='2026-10-09')
args.add_argument('--departure', default='용산')
args.add_argument('--arrival', default='정읍')
args.add_argument('--visible', action='store_true')
args.add_argument('--sandbox', action='store_true')
args.add_argument('--action-delay', type=float, default=0)
args.add_argument('--initial-delay', type=float, default=0)
args = args.parse_args()
year, month, day = map(int, args.date.split('-'))
out = Path('.artifacts')
out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=not args.visible,chromium_sandbox=args.sandbox)
    page = browser.new_page(viewport={'width': 1400, 'height': 1000})
    def click(locator):
        locator.click()
        if args.action_delay:
            page.wait_for_timeout(args.action_delay*1000)
    diagnostic = []
    def endpoint(url):
        parsed=urlsplit(url)
        path=parsed.path
        for prefix in ('/dynaPath/','/web_s/','/dyna/'):
            if path.startswith(prefix): path=prefix+'[redacted]'
        return parsed.scheme+'://'+parsed.netloc+path
    def response_seen(response):
        if response.request.resource_type in ('xhr','fetch') or response.status>=400:
            diagnostic.append({'event':'response','url':endpoint(response.url),
                               'status':response.status,'type':response.request.resource_type,
                               'content_type':response.headers.get('content-type','')})
    def failed(request):
        diagnostic.append({'event':'requestfailed','url':endpoint(request.url),
                           'error':request.failure,'type':request.resource_type})
    page.on('response',response_seen)
    page.on('requestfailed',failed)
    page.on('pageerror',lambda error:diagnostic.append({'event':'pageerror','name':error.name}))
    page.goto('https://www.korail.com/ticket/search/general', wait_until='domcontentloaded')
    page.get_by_role('button', name='열차 조회', exact=True).wait_for()
    if args.initial_delay:
        page.wait_for_timeout(args.initial_delay*1000)
    for dialog in page.get_by_role('dialog').all():
        close = dialog.get_by_role('button', name='창닫기', exact=True)
        if close.count():
            click(close)
    click(page.get_by_role('link', name='출발역 선택', exact=True))
    click(page.get_by_role('link', name=args.departure, exact=True))
    click(page.get_by_role('link', name='도착역 선택', exact=True))
    click(page.get_by_role('link', name=args.arrival, exact=True))
    click(page.get_by_role('link', name='출발일', exact=True))
    page.get_by_role('dialog').get_by_role('button').first.wait_for()
    calendar = page.locator('.datepicker').filter(has=page.locator('p.date', has_text=f'{year}. {month:02d}.'))
    click(calendar.get_by_role('link', name=str(day), exact=True))
    expect(page.locator('.info_day')).to_contain_text(f'{day:02d}일')
    click(page.get_by_role('button', name='적용', exact=True))
    expect(page.locator('#startDate')).to_have_value(re.compile(re.escape(args.date)))
    click(page.get_by_role('button', name='열차 조회', exact=True))
    page.wait_for_url('**/ticket/search/list')
    try:
        page.get_by_text('매진', exact=True).first.wait_for(timeout=10000)
    except Exception:
        pass
    print('Result date:',page.locator('#startDate').input_value())
    out.joinpath('public-list.html').write_text(page.content(), encoding='utf-8')
    out.joinpath('public-diagnostic.json').write_text(json.dumps(diagnostic,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(diagnostic,ensure_ascii=False,indent=2))
    browser.close()
