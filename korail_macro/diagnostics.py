"""Bounded public-search diagnostics. Never retain URLs, bodies, headers or tokens."""
from urllib.parse import urlsplit


class SearchRequestError(RuntimeError):
    pass


class SearchDiagnostics:
    def __init__(self):
        self.clear()

    def clear(self):
        self.statuses=set()
        self.failed_requests=self.page_errors=0

    @staticmethod
    def public_page(url):
        parsed=urlsplit(url)
        return (parsed.scheme=='https' and parsed.netloc=='www.korail.com' and
                parsed.path in ('/ticket/search/general','/ticket/search/list'))

    @staticmethod
    def search_request(url,kind):
        parsed=urlsplit(url)
        return (kind in ('xhr','fetch') and parsed.scheme=='https' and
                parsed.netloc=='www.korail.com' and
                parsed.path.startswith(('/web_s/','/dynaPath/')))

    def response(self,page_url,response):
        if (self.public_page(page_url) and
                self.search_request(response.url,response.request.resource_type) and
                400<=response.status<=599):
            self.statuses.add(response.status)

    def begin_request(self,page_url,request):
        # A manually started new search must not inherit a previous failure.
        if (self.public_page(page_url) and self.search_request(request.url,request.resource_type)
                and urlsplit(request.url).path.startswith('/web_s/')):
            self.clear()

    def failed(self,page_url,request):
        if self.public_page(page_url) and self.search_request(request.url,request.resource_type):
            self.failed_requests=min(999,self.failed_requests+1)

    def page_error(self,page_url):
        if self.public_page(page_url):
            self.page_errors=min(999,self.page_errors+1)

    def snapshot(self):
        return {'http_statuses':sorted(self.statuses),'failed_requests':self.failed_requests,
                'page_errors':self.page_errors}

    def check(self):
        if self.statuses:
            codes=', '.join(map(str,sorted(self.statuses)))
            raise SearchRequestError(f'조회 중 HTTP {codes} 응답을 받았습니다. 빈 목록을 매진·운행 없음으로 판단하지 않습니다.')
        if self.failed_requests:
            raise SearchRequestError('조회 요청 전송에 실패했습니다. 빈 목록을 매진·운행 없음으로 판단하지 않습니다.')
