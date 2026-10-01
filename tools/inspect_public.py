"""Read-only search-flow investigation; never reserves or requests payment."""
from pathlib import Path
import argparse
import json
import re
import time
from html import unescape
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
args.add_argument('--from-home', action='store_true')
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
    started=time.monotonic()
    def clean(text):
        text=re.sub(r'https?://[^\s<>"\']+',lambda m:endpoint(m.group()),text)
        return re.sub(r'[A-Za-z0-9_+/=-]{32,}','[redacted]',text)[:300]
    def endpoint(url):
        parsed=urlsplit(url)
        path=parsed.path
        for prefix in ('/dynaPath/','/web_s/','/dyna/'):
            if path.startswith(prefix): path=prefix+'[redacted]'
        return parsed.scheme+'://'+parsed.netloc+path
    def response_seen(response):
        if response.request.resource_type in ('xhr','fetch') or response.status>=400:
            item={'event':'response','url':endpoint(response.url),
                               'status':response.status,'type':response.request.resource_type,
                               'content_type':response.headers.get('content-type','')}
            if response.status>=400 and urlsplit(response.url).netloc=='www.korail.com':
                try:
                    body=response.text()
                    title=re.search(r'<title[^>]*>(.*?)</title>',body,re.I|re.S)
                    item['error_title']=clean(unescape(title.group(1))) if title else None
                    visible=re.sub(r'<(script|style)\b[^>]*>.*?</\1>','',body,flags=re.I|re.S)
                    visible=re.sub(r'<[^>]+>',' ',visible)
                    item['error_text']=clean(re.sub(r'\s+',' ',unescape(visible)).strip())
                    item['error_markers']=[term for term in ('Internal Server Error','Access Denied','Forbidden','자동화','매크로','차단','비정상','보안','오류') if term.lower() in body.lower()]
                    item['body_length']=len(body)
                except Exception:
                    item['error_body_unavailable']=True
            diagnostic.append(item)
    def failed(request):
        diagnostic.append({'event':'requestfailed','url':endpoint(request.url),
                           'error':request.failure,'type':request.resource_type})
    page.on('response',response_seen)
    page.on('requestfailed',failed)
    def page_error(error):
        sources=re.findall(r'https?://[^\s)]+',error.stack or '')
        diagnostic.append({'event':'pageerror','name':error.name,'message':clean(error.message),
                           'sources':list(dict.fromkeys(endpoint(url) for url in sources)),
                           'elapsed_seconds':round(time.monotonic()-started,2)})
    page.on('pageerror',page_error)
    if args.from_home:
        page.goto('https://www.korail.com/ticket/main',wait_until='load')
        page.wait_for_timeout(args.initial_delay*1000)
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
