# Windows 입력 연결

0.12.0은 실행 시작 때 Native Messaging 포트와 로컬 프로세스를 한 번 열고 종료 때 닫습니다. 조회 중 연결을 미리 준비하고 클릭마다 프로세스를 다시 시작하지 않습니다. 프로토콜 버전은2이며, 기존 등록은 그대로 사용하므로 확장프로그램 새로고침/설정창 재열기만 필요합니다. 운영 중에는 한 번에 한 요청만 전달하고 응답 유실 시 재전송하지 않습니다.

확장프로그램 0.11.0은 DOM으로 대상 열차와 버튼을 검증하고 Native Messaging으로 이 프로그램에 좌표만 전달합니다. 프로그램은 Chrome의 앞에 있는 창, 탭 제목의 일회성 표식, DPI/배율, 좌표를 검증한 뒤 `SetCursorPos`와 `SendInput`으로 한 번 누르고 뗍니다. 카드정보는 전달하지 않습니다. HTTP 포트, 백그라운드 서버, 디버거 연결은 사용하지 않습니다.

설치: 프로젝트 폴더에서 `.venv\Scripts\python.exe native_input\install.py`를 실행합니다. 현재 사용자 Chrome 설정에서 이 프로젝트의 확장프로그램 ID 하나를 찾고 `.runtime/native-input`에 실행 파일·manifest를 생성합니다. 자동 탐색이 안 되면 `--extension-id chrome://extensions에서_확인한_ID`를 지정합니다. 등록은 HKCU의 `Software\Google\Chrome\NativeMessagingHosts\com.korail.personal_input`에 한 항목만 생성합니다. 관리자 권한은 필요 없습니다. `.runtime`은 Git에서 제외됩니다.

확장프로그램을 새로고침하고 설정창을 다시 열어 0.11.0을 확인합니다. 새 `nativeMessaging` 권한 승인이 Chrome에 표시되면 활성화해야 합니다. 연결 실패 시 `native_host_unavailable`로 멈추며 JavaScript 클릭으로 대체하지 않습니다. 성공한 버튼 입력은 trace에 `input: windows_mouse`로 표시됩니다.

실행 중 마우스를 조작하거나 창을 이동하지 마세요. Chrome 사이드 패널·분할 보기·개발자도구는 닫아 두세요. 화면 폭과 배율이 일치하지 않으면 `native_viewport_mismatch`, 창이 바뀌면 `native_window_mismatch`로 중단합니다. 입력 응답을 잃으면 이미 클릭됐을 수 있어 자동으로 재전송하지 않습니다. 창은 클릭 전마다 활성화되며 커서가 버튼 위치로 이동합니다.

제거는 해당 HKCU 키만 삭제하면 됩니다. 프로젝트나 Chrome 프로필을 이동하면 설치를 다시 실행해야 합니다.

오프라인 검증과 실제 코레일 성공은 구분합니다. 이 프로그램은 실제 입력을 보내지만 코레일에서 허용되거나 예약/발권이 성공한다는 보장은 아직 검증하지 않았습니다.
