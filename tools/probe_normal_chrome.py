"""Read-only public-search comparison using a separate Chrome and standard CDP."""
from pathlib import Path
import runpy
import socket
import subprocess
import sys
import time
from urllib.request import build_opener, ProxyHandler
from uuid import uuid4


profile=Path('.artifacts','normal-probe-'+uuid4().hex).resolve()
profile.mkdir(parents=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0))
    port=sock.getsockname()[1]
endpoint=f'http://127.0.0.1:{port}'
process=subprocess.Popen([
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    f'--user-data-dir={profile}',f'--remote-debugging-port={port}',
    '--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check',
    'about:blank'],creationflags=subprocess.CREATE_NO_WINDOW)
try:
    opener=build_opener(ProxyHandler({}))
    deadline=time.monotonic()+20
    while True:
        try:
            with opener.open(endpoint+'/json/version',timeout=1) as response:
                if response.status==200: break
        except OSError:
            if process.poll() is not None or time.monotonic()>=deadline: raise
            time.sleep(.2)
    sys.argv=['inspect_public.py','--cdp-endpoint',endpoint,'--initial-delay','10','--action-delay','2']
    runpy.run_path('tools/inspect_public.py',run_name='__main__')
finally:
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
