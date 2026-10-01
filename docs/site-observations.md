# 실사이트 화면 관찰 기록

2026-10-01, 공개 코레일 웹 화면을 Chrome/Playwright에서 직접 조회했다. 첨부 스크린샷은 흐름 설명 자료이며 DOM selector의 근거로 취급하지 않는다.

## 확인한 부분

- 일반 조회 주소: `https://www.korail.com/ticket/search/general`
- 조회 결과 주소: `https://www.korail.com/ticket/search/list`
- 출발역/도착역 선택 link, 역명 link, `txtGoStart`, `txtGoEnd` 입력값.
- `출발일` link → 날짜 선택 dialog → `.datepicker`의 `p.date`로 월 구분 → 날짜 link → `적용`.
- 미래 날짜 선택 후 `00시 이후 출발` 표시. `#startDate`에서 적용값 확인.
- `열차 조회` button 클릭 뒤 결과 주소 이동.
- 결과 조건: `#labelstart`, `#labelend`, `#startDate`.
- 결과 영역: `.tckWrap > ul`. 빈 결과는 `해당 스케줄에 운행하는 열차가 없습니다.` 문구.
- 공개 홍보 dialog의 `창닫기`만 처리. 미확인 확인창을 일괄 승인하지 않는다.

## 남은 확인

자동화 Chrome에서 10월 9일 용산→정읍과 10월 2일 서울→부산을 조회했으나 모두 빈 목록을 표시했다. Headless와 화면 표시 Chrome에서 재현했다. 사용자는 일반 브라우저에서 로그인 없이 열차 목록이 보인다고 확인했다. 따라서 이를 실제 운행 없음이나 매진으로 판정하지 않는다.

전용 프로필 Chrome을 열고 사용자의 수동 조회 결과와 비교 중이다. 실제 열차 행이 확보되기 전에는 selector를 추정하여 예약하지 않는다. 결과 로딩/오류 상태와 더보기 처리를 확인한 후 반복 조회를 연결해야 한다.

예약·카카오페이 요청/미결제/완료·발권 화면의 DOM, popup/iframe 구성, 정확한 문구와 예약 식별자는 아직 관찰하지 못했다. 엔진은 모의 사이트로 테스트했고 실사이트 거래 연결은 비활성화했다.
