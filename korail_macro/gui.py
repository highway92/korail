"""Small settings window. No browser API is called from the Tk thread."""
from dataclasses import asdict
from datetime import datetime
from queue import Queue, Empty
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog

from .config import Config, TimingConfig, KST, CLASSES
from .models import TrainKey
from .storage import Store
from .worker import Worker


TIMING_LABELS = {
    'query_interval':'조회 간격 (초)',
    'navigation_timeout':'페이지 이동 제한 (초)',
    'element_timeout':'화면 요소 대기 제한 (초)',
    'action_delay':'클릭 후 추가 대기 (초)',
    'page_settle_delay':'조회 화면 진입 후 대기 (초)',
    'reservation_retry_delay':'좌석 선점 실패 후 대기 (초)',
    'error_initial_delay':'첫 조회 오류 후 대기 (초)',
    'error_multiplier':'조회 오류 대기 배수',
    'error_max_delay':'조회 오류 대기 상한 (초)',
    'max_consecutive_errors':'연속 조회 오류 중지 횟수',
    'max_queries':'최대 조회 횟수 (빈칸: 제한 없음)',
    'max_runtime':'최대 탐색 시간 (초 / 빈칸: 제한 없음)',
    'stop_at':'종료 시각 (ISO / 빈칸: 제한 없음)',
    'payment_check_interval':'PC 결제 완료 확인 간격 (초)',
    'payment_wait':'결제 대기 제한 (초 / 서비스 최대 600)',
    'ticket_timeout':'발권 결과 확인 제한 (초)',
}


def parse_timings(values):
    fields = {}
    for name, value in values.items():
        value = value.strip()
        try:
            if name == 'stop_at':
                fields[name] = value or None
            elif not value and name in ('max_queries','max_runtime'):
                fields[name] = None
            elif name in ('max_queries','max_consecutive_errors'):
                fields[name] = int(value)
            else:
                fields[name] = float(value)
        except ValueError:
            raise ValueError(f'{TIMING_LABELS[name]}: 숫자를 확인하세요') from None
    result = TimingConfig(**fields)
    result.validate()
    return result


class App:
    def __init__(self, root, data_dir, worker_factory=Worker):
        self.root, self.data_dir = root, data_dir
        self.events = Queue()
        self.worker = worker_factory(self.events,data_dir)
        self.store = Store(data_dir/'settings.json')
        self.keys = {}
        self.closing = False
        self.advanced = None
        root.title('코레일 개인 예매 도우미 · 개발 중')
        root.geometry('730x620')
        root.minsize(680,540)
        self.date = tk.StringVar(value=datetime.now(KST).date().isoformat())
        self.departure = tk.StringVar(value='용산')
        self.arrival = tk.StringVar(value='정읍')
        self.classes = {name:tk.BooleanVar(value=True) for name in CLASSES}
        self.preferred = tk.BooleanVar(value=False)
        self.timings = {k:tk.StringVar(value='' if v is None else str(v)) for k,v in asdict(TimingConfig()).items()}
        self.status = tk.StringVar(value='브라우저 연결 준비 · 실제 예약/결제 연결은 검증 중')
        body = ttk.Frame(root,padding=12)
        body.pack(fill='both',expand=True)
        conditions = ttk.Frame(body)
        conditions.pack(fill='x')
        for col,(label,var,width) in enumerate((('탑승일',self.date,12),('출발역',self.departure,10),('도착역',self.arrival,10))):
            ttk.Label(conditions,text=label).grid(row=0,column=col*2,padx=(0,5))
            ttk.Entry(conditions,textvariable=var,width=width).grid(row=0,column=col*2+1,padx=(0,12))
        options = ttk.Frame(body); options.pack(fill='x',pady=10)
        for name,var in self.classes.items():
            ttk.Checkbutton(options,text=name,variable=var).pack(side='left',padx=(0,10))
        ttk.Label(options,text='성인 1명 · 카카오페이 · 휴대폰에서 직접 결제').pack(side='left')
        browser_buttons = ttk.Frame(body); browser_buttons.pack(fill='x')
        for text,cmd in (('전용 브라우저 열기','open'),('조건으로 조회','search'),('현재 목록 읽기','read')):
            ttk.Button(browser_buttons,text=text,command=lambda c=cmd:self.send(c)).pack(side='left',padx=(0,6))
        ttk.Label(body,text='대상 열차: Ctrl/Shift로 여러 편 선택 · 선호 순서를 끄면 동일 가중치').pack(anchor='w',pady=(12,4))
        self.tree = ttk.Treeview(body,columns=('time','number','classes'),show='headings',selectmode='extended',height=7)
        for name,label,width in (('time','출발 시각',130),('number','열차 번호',130),('classes','현재 가능 등급',300)):
            self.tree.heading(name,text=label); self.tree.column(name,width=width)
        self.tree.pack(fill='both',expand=True)
        target_buttons = ttk.Frame(body); target_buttons.pack(fill='x',pady=6)
        ttk.Checkbutton(target_buttons,text='위에서부터 선호 순서 적용',variable=self.preferred).pack(side='left')
        for label,fn in (('위로',lambda:self.move(-1)),('아래로',lambda:self.move(1)),('직접 추가',self.add_target)):
            ttk.Button(target_buttons,text=label,command=fn,width=10).pack(side='left',padx=3)
        timing_row = ttk.Frame(body); timing_row.pack(fill='x',pady=6)
        ttk.Label(timing_row,text='조회 간격 (초)').pack(side='left')
        ttk.Entry(timing_row,textvariable=self.timings['query_interval'],width=8).pack(side='left',padx=6)
        ttk.Button(timing_row,text='속도·재시도 상세 설정',command=self.show_timings).pack(side='left')
        ttk.Button(timing_row,text='실행 중 간격 적용',command=lambda:self.send('timings')).pack(side='left',padx=6)
        controls = ttk.Frame(body); controls.pack(fill='x',pady=6)
        for text,cmd in (('설정 저장','save'),('시작','start'),('일시정지','pause'),('재개','resume'),('중지','stop')):
            ttk.Button(controls,text=text,command=lambda c=cmd:self.send(c),width=10).pack(side='left',padx=(0,5))
        ttk.Label(body,textvariable=self.status,wraplength=690).pack(fill='x',pady=6)
        self.log = tk.Text(body,height=6,state='disabled',wrap='word')
        self.log.pack(fill='x')
        self.restore()
        self.worker.start()
        root.protocol('WM_DELETE_WINDOW',self.close)
        root.after(100,self.poll)

    def timing_config(self):
        return parse_timings({k:v.get() for k,v in self.timings.items()})

    def config(self):
        selected = set(self.tree.selection())
        keys = tuple(self.keys[i] for i in self.tree.get_children() if i in selected)
        return Config(self.date.get().strip(),self.departure.get().strip(),self.arrival.get().strip(),
                      keys,tuple(k for k,v in self.classes.items() if v.get()),
                      tuple(k.id for k in keys) if self.preferred.get() else (),self.timing_config())

    def restore(self):
        try:
            saved = self.store.load()
            if not saved: return
            c = Config.from_dict(saved)
            self.date.set(c.travel_date); self.departure.set(c.departure); self.arrival.set(c.arrival)
            for k,v in self.classes.items(): v.set(k in c.allowed_classes)
            for k,v in asdict(c.timings).items(): self.timings[k].set('' if v is None else str(v))
            self.preferred.set(bool(c.preference))
            targets = sorted(c.targets,key=lambda k:c.preference.index(k.id)) if c.preference else c.targets
            for key in targets: self.insert_key(key,'미조회')
            self.tree.selection_set(self.tree.get_children())
        except Exception:
            self.status.set('저장된 설정을 읽지 못했습니다. 설정 파일을 확인하세요.')

    def insert_key(self,key,availability='미조회'):
        if key in self.keys.values(): return
        item = self.tree.insert('', 'end',values=(key.time,key.number,availability))
        self.keys[item] = key
        self.tree.selection_add(item)

    def add_target(self):
        answer = simpledialog.askstring('대상 열차 직접 추가','출발 시각과 열차 번호 (예: 07:47 409)',parent=self.root)
        if not answer: return
        try:
            at,number = answer.split()
            key = TrainKey(self.date.get().strip(),self.departure.get().strip(),self.arrival.get().strip(),at,number)
            Config(key.date,key.departure,key.arrival,(key,)).validate()
            self.insert_key(key)
        except ValueError as exc:
            messagebox.showerror('입력 확인',str(exc),parent=self.root)

    def move(self,direction):
        selected = self.tree.selection()
        if len(selected)!=1: return
        item=selected[0]; index=self.tree.index(item)
        self.tree.move(item,'',max(0,index+direction))

    def show_timings(self):
        if self.advanced and self.advanced.winfo_exists():
            self.advanced.lift(); return
        win=self.advanced=tk.Toplevel(self.root)
        win.title('속도·재시도 설정')
        frame=ttk.Frame(win,padding=12); frame.pack(fill='both',expand=True)
        for row,(name,label) in enumerate(TIMING_LABELS.items()):
            ttk.Label(frame,text=label).grid(row=row,column=0,sticky='w',pady=3)
            ttk.Entry(frame,textvariable=self.timings[name],width=29).grid(row=row,column=1,padx=10,pady=3)
        ttk.Label(frame,text='종료 시각 예: 2026-10-09T07:30:00+09:00\n조회 간격은 직전 조회 완료 후부터 계산합니다.').grid(row=len(TIMING_LABELS),column=0,columnspan=2,sticky='w',pady=8)
        ttk.Button(frame,text='닫기',command=win.destroy).grid(row=len(TIMING_LABELS)+1,column=1,sticky='e')

    def send(self,command):
        if self.closing: return
        try:
            if command in ('search','read','start','save'):
                config=self.config(); config.validate(require_targets=command=='start')
                self.store.save(config.to_dict())
                if command=='save': self.write_log('설정을 저장했습니다.'); return
                self.worker.submit(command,config)
            elif command=='timings':
                self.worker.submit(command,self.timing_config())
            else: self.worker.submit(command)
            self.status.set('작업 중… 진행 중인 브라우저 작업이 끝나면 명령을 적용합니다.')
        except (ValueError,OSError) as exc:
            messagebox.showerror('설정 확인',str(exc),parent=self.root)

    def write_log(self,text):
        self.log.configure(state='normal')
        self.log.insert('end',f'{datetime.now():%H:%M:%S} {text}\n')
        if int(self.log.index('end-1c').split('.')[0])>200: self.log.delete('1.0','2.0')
        self.log.see('end'); self.log.configure(state='disabled')

    def poll(self):
        try:
            while True:
                event=self.events.get_nowait()
                if event['type']=='closed':
                    if self.closing: self.root.destroy(); return
                if event['type']=='trains':
                    selected={self.keys[i] for i in self.tree.selection()}
                    self.tree.delete(*self.tree.get_children()); self.keys.clear()
                    for train in event['trains']:
                        self.insert_key(train.key,', '.join(train.available_classes) or '매진')
                    self.tree.selection_set([i for i,k in self.keys.items() if k in selected])
                if event.get('message'):
                    text=event['message']
                    if 'queries' in event: text+=f" · 조회 {event['queries']}회"
                    self.status.set(text); self.write_log(text)
        except Empty: pass
        self.root.after(100,self.poll)

    def close(self):
        if self.closing: return
        self.closing=True
        self.status.set('현재 브라우저 작업을 마친 뒤 종료합니다. 미완료 거래 기록은 보존합니다.')
        self.worker.submit('close')
