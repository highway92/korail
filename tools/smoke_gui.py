"""Creates the real widgets without opening a browser or submitting a transaction."""
from pathlib import Path
from tempfile import TemporaryDirectory
import tkinter as tk
from korail_macro.gui import App


class StubWorker:
    def __init__(self,events,data_dir): self.events=events
    def start(self): pass
    def submit(self,command,value=None):
        if command=='close': self.events.put({'type':'closed'})


with TemporaryDirectory() as directory:
    root=tk.Tk()
    app=App(root,Path(directory),worker_factory=StubWorker)
    root.update()
    assert root.winfo_width()>=680
    app.show_timings(); root.update()
    assert app.advanced.winfo_height()>300
    assert app.config().allowed_classes==('일반실','특실')
    app.close(); app.poll()
print('GUI creation, advanced settings, defaults, and close: OK')
