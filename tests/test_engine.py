from dataclasses import replace
from datetime import datetime
import importlib.util
import pytest

from korail_macro.config import Config, TimingConfig, KST
from korail_macro.models import TrainKey, Train
from korail_macro.storage import Store


def setup_engine(tmp_path, **timings):
    assert importlib.util.find_spec('korail_macro.engine'), 'engine not implemented'
    from korail_macro.engine import Engine
    from korail_macro.site import Reservation, CheckResult
    clock = [datetime(2026,10,1,10,tzinfo=KST).timestamp()]
    key = TrainKey('2026-10-09','용산','정읍','07:47','409')
    cfg = Config(key.date,key.departure,key.arrival,(key,),timings=replace(TimingConfig(), **timings))
    reservation = Reservation('r1',key,'일반실','1호차 1A')
    class Site:
        def __init__(self):
            self.reserves = self.requests = self.checks = self.searches = 0
            self.stock = True
            self.result = 'pending'
            self.reconciled = 'clear'
            self.raise_reserve = False
        def search(self, cfg):
            self.searches += 1
            return [Train(key, ('일반실',) if self.stock else ())]
        def reconcile(self, record, cfg):
            return CheckResult(self.reconciled, reservation if self.reconciled != 'clear' else None)
        def reserve(self, candidate):
            self.reserves += 1
            if self.raise_reserve: raise TimeoutError('lost response')
            return reservation
        def request_payment(self, r):
            self.requests += 1
            return None
        def check_payment(self, r):
            self.checks += 1
            return CheckResult(self.result, r)
        def verify_ticket(self, r):
            return CheckResult('complete',r)
    site = Site()
    e = Engine(cfg,site,Store(tmp_path/'state.json'), clock=lambda:clock[0])
    return e,site,clock,cfg


def until(e, state):
    for _ in range(12):
        if e.state == state: return
        e.tick()
    assert e.state == state


def test_pending_repeats_confirmation_not_payment_request(tmp_path):
    e,s,c,_ = setup_engine(tmp_path)
    e.start(); until(e,'payment_pending')
    for _ in range(4):
        c[0] += 3; e.tick()
    assert (s.reserves,s.requests,s.checks) == (1,1,4)
    assert e.errors == 0
    s.result='paid'; c[0]+=3
    e.tick(); e.tick()
    assert e.state == 'complete'


def test_ambiguous_reservation_never_retries(tmp_path):
    e,s,c,_=setup_engine(tmp_path)
    s.raise_reserve=True
    e.start(); until(e,'uncertain')
    for _ in range(5): c[0]+=100; e.tick()
    assert s.reserves == 1 and s.requests == 0
    assert e.store.load()['state'] == 'uncertain'


def test_restart_reconciles_and_keeps_original_payment_deadline(tmp_path):
    e,s,c,cfg=setup_engine(tmp_path)
    e.start(); until(e,'payment_pending')
    deadline=e.deadline
    from korail_macro.engine import Engine
    c[0]+=20; s.reconciled='reserved'
    second=Engine(cfg,s,e.store,clock=lambda:c[0])
    second.start()
    assert second.state == 'payment_pending'
    assert second.deadline == deadline
    assert s.requests == 1


def test_expiry_reconciles_before_declaring_failure(tmp_path):
    e,s,c,_=setup_engine(tmp_path)
    e.start(); until(e,'payment_pending')
    c[0]=e.deadline; s.reconciled='complete'
    e.tick()
    assert e.state == 'complete' and s.requests == 1


def test_query_interval_update_and_stop(tmp_path):
    e,s,c,_=setup_engine(tmp_path)
    s.stock=False; e.start(); e.tick()
    assert s.searches == 1
    c[0]+=2; e.update_timings(replace(e.config.timings,query_interval=1)); e.tick()
    assert s.searches == 2
    e.stop(); c[0]+=100; e.tick()
    assert s.searches == 2 and e.state == 'stopped'


def test_query_limit_blocks_next_search(tmp_path):
    e,s,c,_=setup_engine(tmp_path,max_queries=1)
    s.stock=False; e.start(); e.tick(); c[0]+=100; e.tick()
    assert s.searches == 1 and e.state == 'stopped'


def test_existing_unowned_reservation_does_not_pay(tmp_path):
    e,s,c,_=setup_engine(tmp_path)
    s.reconciled='reserved'; e.start()
    assert e.state == 'paused' and s.requests == 0


def test_store_failure_prevents_reservation(tmp_path,monkeypatch):
    e,s,c,_=setup_engine(tmp_path)
    e.start()
    def fail(record): raise OSError('disk full')
    monkeypatch.setattr(e.store,'save',fail)
    with pytest.raises(OSError): e.tick()
    assert s.reserves == 0


def test_restart_does_not_resume_expired_payment(tmp_path):
    from korail_macro.engine import Engine
    e,s,c,cfg=setup_engine(tmp_path)
    e.start(); until(e,'payment_pending')
    s.reconciled='expired'
    second=Engine(cfg,s,e.store,clock=lambda:c[0])
    second.start(); second.tick()
    assert second.state=='expired' and s.checks==0


def test_restart_paid_persists_verification_deadline(tmp_path):
    from korail_macro.engine import Engine
    e,s,c,cfg=setup_engine(tmp_path)
    e.start(); until(e,'payment_pending')
    s.reconciled='paid'
    second=Engine(cfg,s,e.store,clock=lambda:c[0])
    second.start()
    assert second.store.load()['ticket_deadline']==c[0]+cfg.timings.ticket_timeout


def test_reconciliation_cannot_complete_a_different_reservation(tmp_path):
    from korail_macro.site import Reservation, CheckResult
    e,s,c,cfg=setup_engine(tmp_path)
    e.start(); until(e,'payment_pending')
    s.reconcile=lambda record,config:CheckResult('complete',Reservation('different',cfg.targets[0],'일반실','1호차 1A'))
    e.stop()
    assert e.state=='uncertain'


def test_backoff_and_consecutive_error_limit(tmp_path):
    e,s,c,_=setup_engine(tmp_path,error_initial_delay=5,error_max_delay=9,max_consecutive_errors=3)
    def fail(cfg): raise TimeoutError()
    s.search=fail
    e.start(); e.tick()
    assert e.next_at==c[0]+5
    c[0]=e.next_at; e.tick()
    assert e.next_at==c[0]+9
    c[0]=e.next_at; e.tick()
    assert e.state=='paused' and e.queries==3


def test_payment_request_timeout_does_not_retry(tmp_path):
    e,s,c,_=setup_engine(tmp_path)
    def fail(r):
        s.requests+=1
        raise TimeoutError()
    s.request_payment=fail
    e.start(); until(e,'uncertain')
    for _ in range(4): c[0]+=20; e.tick()
    assert s.requests==1 and e.store.load()['payment_requested_at'] is not None


def test_http_failure_uses_backoff_and_explains_empty_list(tmp_path):
    from korail_macro.diagnostics import SearchRequestError
    e,s,c,_=setup_engine(tmp_path)
    events=[]; e.emit=events.append
    def fail(cfg): raise SearchRequestError('조회 중 HTTP 500 응답')
    s.search=fail
    e.start(); e.tick()
    assert e.next_at==c[0]+e.config.timings.error_initial_delay
    assert 'HTTP 500' in events[-1]['message']
    assert e.state=='scanning' and s.reserves==0
