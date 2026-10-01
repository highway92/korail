"""One operation per tick; no overlapping browser calls or payment retries."""
from dataclasses import replace
from datetime import datetime
import random
import time
from uuid import uuid4

from .config import KST
from .selection import choose_candidate
from .site import Reservation, ReservationRejected, NeedsInspection
from .diagnostics import SearchRequestError


class Engine:
    def __init__(self, config, site, store, *, clock=time.time, emit=lambda event: None, rng=None):
        self.config, self.site, self.store = config, site, store
        self.clock, self.emit, self.rng = clock, emit, rng or random.Random()
        self.state = 'idle'
        self.errors = self.queries = 0
        self.started = self.next_at = self.last_query = 0
        self.deadline = None
        self.reservation = None
        self.record = {}
        self._resume = None

    def notify(self, message, **extra):
        self.emit(dict(state=self.state, message=message, queries=self.queries, next_at=self.next_at, **extra))

    def save(self, state, **fields):
        record = {**self.record, **fields, 'state': state}
        self.store.save(record)  # No submission or state transition if persistence failed.
        self.record, self.state = record, state

    def matches(self, reservation):
        return (reservation is not None and reservation.key in self.config.targets
                and reservation.seat_class in self.config.allowed_classes and bool(reservation.seat))

    def start(self):
        if self.state not in ('idle', 'stopped', 'complete', 'expired', 'cancelled'):
            raise ValueError('실행 중인 작업을 먼저 중지하세요')
        self.config.validate(today=datetime.fromtimestamp(self.clock(),KST).date())
        prior = self.store.load()
        # Any prior transaction must be reconciled, even after a manual stop.
        result = self.site.reconcile(prior, self.config)
        self.record = prior or {'run_id':str(uuid4()), 'config':self.config.to_dict()}
        self.started = self.clock()
        prior_id = (prior or {}).get('reservation',{}).get('id')
        if (result.status == 'complete' and self.matches(result.reservation)
                and (prior_id is None or result.reservation.id == prior_id)):
            self.reservation = result.reservation
            self.save('complete'); self.notify('이미 발권된 목표 승차권을 확인했습니다'); return
        if prior and prior.get('payment_requested_at') is not None:
            self.deadline = prior['payment_deadline']
            self.reservation = Reservation.from_dict(prior['reservation']) if prior.get('reservation') else None
            if self.matches(result.reservation) and result.reservation.id == getattr(self.reservation, 'id', None):
                self.reservation = result.reservation
                if result.status in ('expired','cancelled'):
                    self.save(result.status); self.notify('기존 결제 요청이 종료되었습니다'); return
                if result.status == 'paid':
                    self.save('ticket_verify', ticket_deadline=prior.get('ticket_deadline', self.clock()+self.config.timings.ticket_timeout))
                elif result.status in ('reserved','pending'):
                    self.save('payment_pending')
                else:
                    self.save('uncertain'); self.notify('기존 결제 요청 결과를 확인해야 합니다'); return
                self.next_at=self.clock(); self.notify('기존 결제 요청의 상태 확인을 재개합니다'); return
            self.save('uncertain'); self.notify('기존 결제 요청 결과를 확인해야 합니다'); return
        if result.status == 'reserved':
            self.save('paused'); self.notify('기존 미결제 예약이 있습니다. 브라우저에서 확인하세요'); return
        if result.status != 'clear' or (prior and prior.get('state') not in ('scanning','stopped','complete','expired','cancelled')):
            self.save('uncertain'); self.notify('기존 거래 결과를 확인해야 합니다'); return
        self.record = {'run_id':str(uuid4()), 'config':self.config.to_dict()}
        self.errors=self.queries=0
        self.next_at=self.clock()
        self.save('scanning'); self.notify('목표 열차 탐색을 시작합니다')

    def update_timings(self, timings):
        if self.state not in ('scanning','paused','idle','stopped'):
            raise ValueError('예약·결제 중에는 설정을 변경할 수 없습니다')
        timings.validate()
        self.config=replace(self.config,timings=timings)
        if self.state == 'scanning' and self.last_query:
            delay = timings.error_delay(self.errors) if self.errors else timings.query_interval
            self.next_at=self.last_query+delay
        self.notify('속도 설정을 적용했습니다')

    def pause(self):
        if self.state not in ('scanning','payment_pending'):
            return
        self._resume=self.state
        self.state='paused'
        self.notify('일시정지')

    def resume(self):
        if self.state == 'paused' and self._resume:
            self.state=self._resume
            self._resume=None
            self.notify('재개')

    def stop(self):
        transaction = self.record.get('reservation') or self.record.get('state') in ('reservation_submitting','payment_submitting','uncertain')
        if transaction:
            self._reconcile_end('stopped')
        else:
            self.save('stopped')
        self.notify('새 작업을 중지했습니다')

    def _reconcile_end(self, otherwise):
        try:
            result = self.site.reconcile(self.record,self.config)
        except Exception:
            self.save('uncertain'); return
        same = (self.matches(result.reservation) and
                (self.reservation is None or result.reservation.id == self.reservation.id))
        if result.status == 'complete' and same:
            self.reservation=result.reservation
            self.save('complete')
        elif result.status == 'paid' and same:
            self.reservation=result.reservation
            self.save('ticket_verify',ticket_deadline=self.record.get('ticket_deadline',self.clock()+self.config.timings.ticket_timeout))
        elif result.status in ('expired','cancelled') and same:
            self.save(result.status)
        else:
            # A timeout or clear page alone does not prove a payment failed.
            self.save('uncertain' if self.record.get('payment_requested_at') else otherwise)

    def tick(self):
        now=self.clock(); t=self.config.timings
        if self.state not in ('scanning','reserved','payment_pending','ticket_verify'):
            return
        if self.state == 'scanning':
            stop_at=datetime.fromisoformat(t.stop_at).timestamp() if t.stop_at else None
            departures=[datetime.fromisoformat(f'{k.date}T{k.time}').replace(tzinfo=KST).timestamp() for k in self.config.targets]
            if ((t.max_runtime is not None and now-self.started>=t.max_runtime)
                    or (t.max_queries is not None and self.queries>=t.max_queries)
                    or (stop_at is not None and now>=stop_at) or all(d<=now for d in departures)):
                self.save('stopped'); self.notify('탐색 종료 조건에 도달했습니다'); return
        if self.state == 'payment_pending' and now>=self.deadline:
            self._reconcile_end('expired'); self.notify('결제 대기기한에 도달해 거래 내역을 확인했습니다'); return
        if self.state == 'ticket_verify' and now>=self.record.get('ticket_deadline',now):
            self.save('uncertain'); self.notify('발권 결과를 확인해야 합니다'); return
        if now<self.next_at:
            return
        if self.state == 'scanning':
            self.queries+=1
            try:
                trains=self.site.search(self.config)
            except NeedsInspection as exc:
                self._resume='scanning'; self.state='paused'; self.notify(str(exc)); return
            except Exception as exc:
                self.errors+=1; self.last_query=self.clock()
                if self.errors>=t.max_consecutive_errors:
                    self._resume='scanning'; self.state='paused'
                self.next_at=self.last_query+t.error_delay(self.errors)
                detail=f': {exc}' if isinstance(exc,SearchRequestError) else ''
                self.notify(f'조회 오류 {self.errors}회{detail}'); return
            self.errors=0; self.last_query=self.clock(); self.next_at=self.last_query+t.query_interval
            self.notify('열차 목록 확인', trains=trains)
            trains=[v for v in trains if datetime.fromisoformat(f'{v.key.date}T{v.key.time}').replace(tzinfo=KST).timestamp()>self.clock()]
            candidate=choose_candidate(trains,self.config,self.rng)
            if candidate is None: return
            if not getattr(self.site,'booking_ready',True):
                self.state='paused'; self.notify('좌석 발견. 예약 화면 연결 검증이 필요합니다',candidate=candidate); return
            self.save('reservation_submitting',candidate={'key':candidate.train.key.__dict__,'seat_class':candidate.seat_class})
            try:
                reservation=self.site.reserve(candidate)
            except ReservationRejected:
                self.save('scanning'); self.next_at=self.clock()+t.reservation_retry_delay
                self.notify('좌석 선점으로 예약 실패, 재조회 대기'); return
            except Exception:
                self.save('uncertain'); self.notify('예약 제출 결과가 불명확합니다'); return
            if not self.matches(reservation):
                self.save('uncertain'); self.notify('예약 결과가 목표와 다릅니다'); return
            self.reservation=reservation
            self.save('reserved',reservation=reservation.to_dict()); self.next_at=self.clock()
            self.notify('예약 확보, 결제 요청 준비'); return
        if self.state == 'reserved':
            if self.reservation.deadline is not None and now>=self.reservation.deadline:
                self._reconcile_end('expired'); return
            self.deadline=min(now+t.payment_wait,now+600,self.reservation.deadline or float('inf'))
            self.save('payment_submitting',payment_requested_at=now,payment_deadline=self.deadline)
            try:
                service_deadline=self.site.request_payment(self.reservation)
            except Exception:
                self.save('uncertain'); self.notify('결제 요청 결과가 불명확합니다'); return
            if service_deadline is not None:
                self.deadline=min(self.deadline,service_deadline)
            self.save('payment_pending',payment_deadline=self.deadline)
            self.next_at=self.clock()+t.payment_check_interval
            self.notify('카카오페이 요청 완료. 휴대폰에서 금액 확인 후 결제하세요'); return
        if self.state == 'payment_pending':
            try:
                result=self.site.check_payment(self.reservation)
            except Exception:
                self.save('uncertain'); self.notify('결제 확인 응답이 불명확합니다'); return
            if result.status=='pending':
                self.next_at=self.clock()+t.payment_check_interval
                self.notify('휴대폰 결제 대기 중'); return
            if result.status in ('paid','complete') and self.matches(result.reservation) and result.reservation.id==self.reservation.id:
                self.save('ticket_verify',ticket_deadline=self.clock()+t.ticket_timeout)
                self.next_at=self.clock(); return
            if result.status in ('expired','cancelled'):
                self.save(result.status); self.notify('결제 요청이 만료 또는 취소되었습니다'); return
            self.save('uncertain'); self.notify('결제 상태를 확인해야 합니다'); return
        if self.state=='ticket_verify':
            try:
                result=self.site.verify_ticket(self.reservation)
            except Exception:
                self.save('uncertain'); self.notify('발권 결과 확인이 필요합니다'); return
            if result.status=='complete' and self.matches(result.reservation) and result.reservation.id==self.reservation.id:
                self.save('complete'); self.notify('결제 및 발권 완료',reservation=self.reservation); return
            self.next_at=self.clock()+t.payment_check_interval
