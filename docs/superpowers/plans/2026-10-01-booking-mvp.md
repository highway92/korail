# 기차예매 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 개인용 Windows 설정창과 전용 브라우저에서 목표 열차를 감시하고 예약 및 카카오페이 완료 확인을 수행한다.

**Architecture:** Tkinter 주 스레드와 Playwright 작업 스레드를 큐로 연결한다. 사이트의 화면 처리, 순수 선택 정책, 설정·상태 저장, 거래 상태 제어를 분리한다. 미검증 실사이트 거래 동작은 활성화하지 않으며 모의 테스트 통과를 실사이트 검증으로 표시하지 않는다.

**Tech Stack:** Python 3.12+, Tkinter, Playwright, pytest, 표준 JSON·파일 잠금. 현재 환경은 Python 번들 런타임에서 프로젝트 .venv를 생성한다.

## 작업 1 — 설정·선택 정책·상태 저장

Files: `korail_macro/__init__.py`, `config.py`, `models.py`, `selection.py`, `storage.py`, `tests/test_core.py`, `pyproject.toml`.

- [ ] 기대 동작을 테스트로 먼저 작성하고 실패를 관찰한다.
- [ ] 설정 dataclass: 날짜·역·대상 열차 목록·허용 등급·선호 순서 및 설계서의 모든 timing 값을 제공한다. 유효 숫자·날짜·서로 다른 역·0개 대상·0개 등급을 검증한다.
- [ ] TrainKey(date, departure, arrival, time, number), Train(key, available_classes), Candidate(train, seat_class)를 제공한다. train_key는 완전 일치 비교한다.
- [ ] `choose_candidate(trains, config, rng)`는 대상·허용 등급 필터 후 열차를 먼저 선택한다. preference가 없으면 rng.choice(열차), 있으면 순위 첫 후보. 이후 rng.choice(가능한 등급). 날짜가 다른 행은 선택하지 않는다.
- [ ] JSON 설정 저장/복원, 상태 저장은 임시 파일을 쓴 후 os.replace로 교체한다. 상태 손상은 조용히 초기화하지 않고 오류를 반환한다. 실행 잠금은 OS 잠금으로 중복 실행을 차단한다.
- [ ] `.venv/Scripts/python.exe -m pytest tests/test_core.py -q`로 검증한다.

필수 테스트 입력 예시:

```python
def test_train_weight_does_not_depend_on_class_count():
    # 후보 두 편 중 한 편에만 두 등급이 있어도 첫 choice 입력은 두 열차여야 한다.
    class RecordingRandom:
        def __init__(self): self.calls = []
        def choice(self, items):
            self.calls.append(list(items))
            return items[0]
    # 구현 테스트에서 완전한 TrainKey와 Config를 생성해 호출한다.
    # assert len(rng.calls[0]) == 2; assert len(rng.calls) == 2
```

## 작업 2 — 거래 상태와 반복 실행

Files: `engine.py`, `site.py`, `tests/test_engine.py`.

- [ ] fake clock·fake site·실제 JSON 저장소로 예약 응답 유실, 결제 미완료 반복, 만료 경계, 재시작 테스트를 작성한다.
- [ ] Site 인터페이스: search(config), reserve(candidate), reconcile(record), request_payment(reservation), check_payment(reservation), verify_ticket(reservation). 결과는 enum과 구조화된 데이터로 받고 문자열 추측을 엔진에 넣지 않는다.
- [ ] 조회 오류 백오프·매진 정상 간격·설정 변경·pause/stop를 구현한다. 제어는 한 단계씩 실행하는 tick 구조로 긴 sleep을 피한다.
- [ ] reserve/request_payment 직전 intent를 영속 저장한다. 결과가 불명확하면 reconcile만 가능하고 새 거래를 보내지 않는다.
- [ ] 미결제 결과는 일반 오류 카운터를 올리지 않고 다음 확인을 예약한다. 만료는 결과 확인 후 종료한다. 거래 원래 기한을 저장하고 복구 시 유지한다.
- [ ] `.venv/Scripts/python.exe -m pytest tests/test_engine.py -q`로 검증한다.

## 작업 3 — 실제 브라우저와 화면 어댑터

Files: `browser.py`, `korail_site.py`, `tests/test_site.py`, `tests/fixtures/`, `docs/site-observations.md`.

- [ ] 로그인 없는 조회 화면을 실제 브라우저에서 관찰하고 DOM 근거를 기록한다. URL만 직접 열어서 결과가 없으면 화면의 검색 UI를 이용한다.
- [ ] 관찰한 행 구조와 상태를 축약한 HTML fixture로 파싱·selector 테스트를 먼저 작성한다.
- [ ] 전용 프로필로 브라우저를 열고 사용자 로그인 경로를 제공한다. 정상 검색 UI로 날짜·역을 설정하고 갱신·더보기를 처리한다.
- [ ] 실제 관찰하지 못한 예약/결제 단계는 `NeedsInspection` 결과로 멈추게 한다. 알려지지 않은 팝업을 무조건 확인하지 않는다.
- [ ] 사용자가 필요한 로그인·결제 화면을 제공하면 관찰 문구로 fixture와 어댑터를 확장한다. 민감 입력·결제 화면을 진단 로그에 수집하지 않는다.
- [ ] `.venv/Scripts/python.exe -m pytest tests/test_site.py -q`로 검증하고 실제 조회와 대조한다.

## 작업 4 — 설정창·실행 도구

Files: `gui.py`, `worker.py`, `__main__.py`, `run.ps1`, `run.cmd`, `README.md`, `tests/test_worker.py`.

- [ ] 제어 큐 처리, 잘못된 설정 시작 차단, 실시간 간격 변경과 종료 이벤트 테스트를 먼저 작성한다.
- [ ] 작은 설정창에 날짜·역·열차 목록 복수 선택·등급 체크·선호 순서·조회간격·상세 timing 입력을 제공한다.
- [ ] 브라우저 열기, 목록 읽기/조회, 시작, 일시정지, 중지 및 상태·로그를 제공한다. GUI 스레드에서 브라우저 작업을 실행하지 않는다.
- [ ] `.venv` 런타임으로 실행하는 Windows 런처와 설치 방법을 제공한다. 실제 연결 범위와 미검증 부분을 README에 명확히 표시한다.
- [ ] 창 생성·닫기 smoke test와 실제 설정창 표시를 검증한다.

## 작업 5 — 통합 검토

- [ ] 하위 에이전트가 요구사항 일치 여부를 검토한다. 발견한 누락은 수정한다.
- [ ] 이어서 품질 검토: 중복 예약/결제, 기한·중지 처리, 민감 로그, 설정 적용, thread 소유권을 확인한다.
- [ ] 전체 pytest, compileall, git diff --check를 실행한다.
- [ ] 실제 예약·결제는 사용자 로그인과 지정한 실제 목표가 확인된 뒤만 검증한다. 미확인 상태는 완료라고 보고하지 않는다.
- [ ] 로컬 커밋에 코드·문서·테스트만 포함하고 .venv·프로필·진단 산출물을 제외한다.

## 진행 기록

- 사용자 ‘이제 작업시작하자’ 지시로 문서 검토와 구현 착수 승인 확인.
- codex/booking-mvp 브랜치, 프로젝트 .venv 생성 완료.
- Chrome CUA 연결이 없어 Codex 브라우저로 공개 화면을 조사 중. 프로그램의 전용 브라우저는 Playwright에서 별도로 실행한다.

### 2026-10-01 구현 체크포인트

- 작업 1 완료: 설정 검증·열차별 동일 가중치·선호 순서·원자적 JSON 저장·OS 실행 잠금.
- 작업 2 모의 사이트에서 구현/검증: 간격·오류 백오프·거래 의도 선저장·결제 요청 1회·재시작 기한 유지·예약 식별자 대조. 실사이트 거래 연결은 남아 있음.
- 작업 3 부분 완료: 전용 Chrome 프로필과 공개 조회 UI 이동. 실제 결과 행을 확보하지 못해 목록 파싱·더보기·예약·결제·발권 연결은 미완료. 자동화 브라우저의 빈 결과를 매진으로 처리하지 않음.
- 작업 4 설정창 구현: 모든 timing 필드, 등급 기본 둘 다, 선호 순서 옵션, 브라우저 제어 스레드, 실행 도구. 실제 열차 목록 선택 기능은 작업 3의 파서 연결에 의존함.
- 작업 5 진행 중: 122개 자동 테스트 통과. 실제 Tk 창 생성/상세 설정/종료 및 오프라인 Chrome DOM 방어 검사 통과. 하위 에이전트는 사용량 제한으로 중단되어 별도 에이전트 리뷰를 수행하지 못했으며 주 에이전트가 검토함.
- 사용자가 평소 브라우저에서는 로그인 없이 조회 가능하다고 확인. 전용 Chrome 수동 조회 결과와 ‘현재 목록 읽기’ 실행을 요청한 상태. 이 결과를 받아 실사이트 연결 작업을 계속한다.
