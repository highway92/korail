"""Offline DOM checks using observed public selectors; no Korail request is sent."""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright
from korail_macro.browser import Browser
from korail_macro.config import Config, TimingConfig
from korail_macro.site import NeedsInspection
from korail_macro.diagnostics import SearchRequestError


with TemporaryDirectory() as directory, sync_playwright() as p:
    chrome=p.chromium.launch(channel='chrome',headless=True)
    page=chrome.new_page()
    # Minimal public DOM observed on 2026-10-01; never imitates a successful booking.
    html='''<meta charset="utf-8"><input id="labelstart" value="용산"><input id="labelend" value="정읍">
    <input id="startDate" value="2026-10-09(금) 00:00">
    <div class="tckWrap"><ul><div class="tck_confirm_no-data">
    <p>해당 스케줄에 운행하는 열차가 없습니다.</p></div></ul></div>'''
    page.route('**/*',lambda route:route.fulfill(body=html,content_type='text/html'))
    page.goto('https://www.korail.com/ticket/search/list')
    adapter=Browser(Path(directory)/'profile')
    adapter.page=page
    adapter.observe_page()
    cfg=Config('2026-10-09','용산','정읍',timings=TimingConfig(element_timeout=.2))
    try: adapter.read_trains(cfg)
    except NeedsInspection as exc: assert '비어' in str(exc)
    else: raise AssertionError('Empty result incorrectly treated as a successful scan')
    captured=Path(directory)/'search-rows.html'
    assert captured.exists() and 'labelstart' not in captured.read_text(encoding='utf-8')
    page.route('**/web_s/test',lambda route:route.fulfill(status=500,body='failure'))
    page.evaluate("async () => (await fetch('/web_s/test')).status")
    try: adapter.read_trains(cfg)
    except SearchRequestError as exc: assert 'HTTP 500' in str(exc)
    else: raise AssertionError('HTTP failure incorrectly reported as no trains')
    adapter.diagnostics.clear()
    page.locator('.tckWrap').evaluate('(el)=>el.innerHTML="<ul><li>Unrecognized result layout</li></ul>"')
    try: adapter.read_trains(cfg)
    except NeedsInspection as exc: assert '행 구조' in str(exc)
    else: raise AssertionError('Unknown layout accepted')
    page.goto('https://www.korail.com/ticket/login')
    try: adapter.read_trains(cfg)
    except NeedsInspection as exc: assert '조회한 뒤' in str(exc)
    else: raise AssertionError('Login page accepted as train results')
    chrome.close()
print('Offline Chrome DOM: empty/unknown/private-page guards OK; no live booking tested')
