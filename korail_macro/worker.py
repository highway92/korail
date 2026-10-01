"""All Playwright objects live on this thread; GUI receives plain data only."""
from pathlib import Path
from queue import Queue, Empty
from threading import Thread

from .engine import Engine
from .storage import Store


class Worker(Thread):
    def __init__(self, events, data_dir, browser_factory=None):
        super().__init__(name='korail-browser', daemon=True)
        self.events, self.commands = events, Queue()
        self.data_dir = Path(data_dir)
        self.browser_factory = browser_factory
        self.browser = self.engine = None

    def submit(self, command, value=None):
        self.commands.put((command, value))

    def emit(self, **event):
        self.events.put(event)

    def ensure_browser(self):
        if self.browser is None:
            if self.browser_factory:
                self.browser = self.browser_factory()
            else:
                from .browser import Browser
                self.browser = Browser(self.data_dir / 'browser-profile')
        self.browser.open()
        return self.browser

    def run(self):
        try:
            while True:
                try:
                    command, value = self.commands.get(timeout=.1)
                except Empty:
                    command, value = 'tick', None
                if command == 'close':
                    break
                try:
                    self.handle(command, value)
                except Exception as exc:
                    if self.engine and command == 'tick':
                        # Includes failed state writes: no further tick may submit anything.
                        self.engine.state = 'uncertain'
                    # Browser exception text may include form input/DOM; don't log it.
                    message = str(exc) if isinstance(exc, ValueError) else self.safe_error(exc)
                    self.emit(type='error', message=message)
        finally:
            if self.browser:
                try:
                    self.browser.close()
                except Exception:
                    pass
            self.emit(type='closed')

    @staticmethod
    def safe_error(exc):
        from .site import NeedsInspection
        if isinstance(exc, NeedsInspection):
            return str(exc)
        return f'{type(exc).__name__}: 작업을 완료하지 못했습니다. 브라우저 상태를 확인하세요.'

    def handle(self, command, value):
        active = self.engine and self.engine.state not in ('idle','stopped','complete','expired','cancelled')
        if command in ('search', 'start', 'read'):
            if active:
                raise ValueError('진행 중인 작업을 먼저 중지하세요. 결과 미확인 거래는 브라우저에서 확인해야 합니다.')
            value.validate(require_targets=command == 'start')
        if command == 'open':
            self.ensure_browser()
            self.emit(type='opened', message='전용 브라우저를 열었습니다. 코레일에 로그인하세요.')
        elif command in ('search','read'):
            browser = self.ensure_browser()
            trains = browser.search(value) if command == 'search' else browser.read_trains(value)
            self.emit(type='trains', trains=trains, message=f'열차 {len(trains)}편을 읽었습니다.')
        elif command == 'start':
            browser = self.ensure_browser()
            self.engine = Engine(value, browser, Store(self.data_dir/'transaction.json'),
                                 emit=lambda event: self.emit(type='state', **event))
            self.engine.start()
        elif command == 'timings' and self.engine:
            self.engine.update_timings(value)
        elif command in ('pause','resume','stop') and self.engine:
            getattr(self.engine, command)()
        elif command == 'tick' and self.engine:
            self.engine.tick()
