"""Visible Chrome with a separate profile. Only inspected site actions are enabled."""
from datetime import date
from pathlib import Path
import re
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

from .site import NeedsInspection
from .diagnostics import SearchDiagnostics


class Browser:
    booking_ready = False

    def __init__(self, profile):
        self.profile = Path(profile)
        self.playwright = self.context = self.page = None
        self.diagnostics = SearchDiagnostics()

    def observe_page(self):
        page=self.page
        page.on('request',lambda request:self.diagnostics.begin_request(page.url,request))
        page.on('response',lambda response:self.diagnostics.response(page.url,response))
        page.on('requestfailed',lambda request:self.diagnostics.failed(page.url,request))
        page.on('pageerror',lambda error:self.diagnostics.page_error(page.url))

    def open(self):
        if self.context is not None:
            if self.page.is_closed():
                self.page = self.context.new_page()
                self.observe_page()
                self.page.goto('https://www.korail.com/ticket/search/general')
            return
        self.profile.mkdir(parents=True, exist_ok=True)
        self.playwright = sync_playwright().start()
        try:
            self.context = self.playwright.chromium.launch_persistent_context(
                str(self.profile), channel='chrome', headless=False,
                viewport={'width':1400,'height':1000})
            self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
            self.observe_page()
            self.page.goto('https://www.korail.com/ticket/search/general', wait_until='domcontentloaded')
        except Exception:
            self.close()
            raise

    def close(self):
        try:
            if self.context:
                self.context.close()
        finally:
            self.context = self.page = None
            if self.playwright:
                self.playwright.stop()
                self.playwright = None

    def apply_timings(self, timings):
        expect.set_options(timeout=timings.element_timeout*1000)
        self.page.set_default_timeout(timings.element_timeout*1000)
        self.page.set_default_navigation_timeout(timings.navigation_timeout*1000)
        self.action_delay = timings.action_delay

    def click(self, locator):
        locator.click()
        if self.action_delay:
            self.page.wait_for_timeout(self.action_delay*1000)

    def search(self, config):
        config.validate(require_targets=False)
        self.apply_timings(config.timings)
        page = self.page
        self.diagnostics.clear()
        page.goto('https://www.korail.com/ticket/search/general', wait_until='domcontentloaded')
        page.get_by_role('button', name='열차 조회', exact=True).wait_for()
        for dialog in page.get_by_role('dialog').all():
            close = dialog.get_by_role('button', name='창닫기', exact=True)
            if close.count() and close.is_visible():
                self.click(close)
        for field, station in (('출발역 선택',config.departure),('도착역 선택',config.arrival)):
            self.click(page.get_by_role('link', name=field, exact=True))
            station_link = page.get_by_role('link', name=station, exact=True)
            if not station_link.count():
                page.get_by_placeholder('역명을 입력해주세요').fill(station)
                self.click(page.get_by_role('button',name='검색',exact=True))
            self.click(station_link)
        expect(page.locator('input[name="txtGoStart"]')).to_have_value(config.departure)
        expect(page.locator('input[name="txtGoEnd"]')).to_have_value(config.arrival)
        self.click(page.get_by_role('link',name='출발일',exact=True))
        page.get_by_role('dialog').get_by_role('button').first.wait_for()
        d = date.fromisoformat(config.travel_date)
        calendar = page.locator('.datepicker').filter(has=page.locator('p.date',has_text=f'{d.year}. {d.month:02d}.'))
        day = calendar.get_by_role('link',name=str(d.day),exact=True)
        if day.count()!=1 or not day.is_visible():
            raise NeedsInspection('달력에서 탑승일을 선택할 수 없습니다. 브라우저에서 날짜를 확인하세요.')
        self.click(day)
        expect(page.locator('.info_day')).to_contain_text(f'{d.day:02d}일')
        self.click(page.get_by_role('button',name='적용',exact=True))
        expect(page.locator('#startDate')).to_have_value(re.compile(re.escape(config.travel_date)))
        # The empty-result container renders before the search response arrives.
        with page.expect_response(lambda r: self.diagnostics.search_request(r.url,r.request.resource_type)
                                  and urlsplit(r.url).path.startswith('/web_s/'),
                                  timeout=config.timings.navigation_timeout*1000):
            self.click(page.get_by_role('button',name='열차 조회',exact=True))
        page.wait_for_url('**/ticket/search/list')
        return self.read_trains(config)

    def read_trains(self, config):
        config.validate(require_targets=False)
        self.apply_timings(config.timings)
        page = self.page
        if page.url.split('?')[0] != 'https://www.korail.com/ticket/search/list':
            raise NeedsInspection('전용 브라우저에서 날짜·구간을 조회한 뒤 목록 읽기를 누르세요.')
        expect(page.locator('#labelstart')).to_have_value(config.departure)
        expect(page.locator('#labelend')).to_have_value(config.arrival)
        expect(page.locator('#startDate')).to_have_value(re.compile(re.escape(config.travel_date)))
        page.locator('.tckWrap > ul').wait_for()
        self.diagnostics.check()
        # Only the public train result container; no login or payment page capture.
        (self.profile.parent/'search-rows.html').write_text(page.locator('.tckWrap').inner_html(),encoding='utf-8')
        if page.get_by_text('해당 스케줄에 운행하는 열차가 없습니다.',exact=True).is_visible():
            raise NeedsInspection('조회 결과가 비어 있습니다. 전용 브라우저에서 로그인과 날짜·구간을 확인하세요.')
        # Train rows have not yet been observed in the connected browser.
        raise NeedsInspection('열차 목록을 찾았습니다. 실제 행 구조를 확인한 뒤 목록 연결을 마무리해야 합니다.')

    def reconcile(self, record, config):
        raise NeedsInspection('예약·결제 화면 연결 검증이 아직 필요합니다. 자동 예매는 활성화되지 않았습니다.')
