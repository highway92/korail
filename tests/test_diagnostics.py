from types import SimpleNamespace
import pytest
from korail_macro.diagnostics import SearchDiagnostics, SearchRequestError


def response(status=500,url='https://www.korail.com/web_s/private-path?token=secret',kind='xhr'):
    return SimpleNamespace(status=status,url=url,request=SimpleNamespace(resource_type=kind))


def test_failed_search_is_reported_without_retaining_url_or_tokens():
    d=SearchDiagnostics()
    d.response('https://www.korail.com/ticket/search/list',response())
    assert d.snapshot()=={'http_statuses':[500],'failed_requests':0,'page_errors':0}
    with pytest.raises(SearchRequestError,match='HTTP 500'): d.check()
    assert 'secret' not in repr(d.__dict__)


@pytest.mark.parametrize('page_url',[
    'https://www.korail.com/ticket/login',
    'https://www.korail.com/ticket/reservation/detail',
    'https://example.com/ticket/search/list',
])
def test_nonpublic_pages_are_not_collected(page_url):
    d=SearchDiagnostics()
    d.response(page_url,response()); d.page_error(page_url); d.failed(page_url,response())
    assert d.snapshot()=={'http_statuses':[],'failed_requests':0,'page_errors':0}


def test_reset_discards_previous_search_failure():
    d=SearchDiagnostics()
    d.response('https://www.korail.com/ticket/search/list',response())
    d.clear(); d.check()


def test_unrelated_assets_and_success_are_ignored():
    d=SearchDiagnostics()
    for r in (response(200),response(404,'https://www.korail.com/image.png','image'),
              response(500,'https://ads.example.com/web_s/xyz')):
        d.response('https://www.korail.com/ticket/search/list',r)
    d.check()


def test_page_error_alone_is_not_proof_search_failed():
    d=SearchDiagnostics()
    d.page_error('https://www.korail.com/ticket/search/general')
    d.check()
    assert d.snapshot()['page_errors']==1


def test_manual_search_resets_previous_failure():
    d=SearchDiagnostics()
    url='https://www.korail.com/ticket/search/list'
    d.response(url,response())
    d.begin_request(url,SimpleNamespace(url='https://www.korail.com/web_s/new',resource_type='xhr'))
    d.check()
