import importlib.util
import queue
import threading
from datetime import datetime
from korail_macro.config import Config, KST


def test_browser_is_owned_by_worker_thread_and_close_finishes(tmp_path):
    assert importlib.util.find_spec('korail_macro.worker'), 'worker not implemented'
    from korail_macro.worker import Worker
    owner=[]
    class Browser:
        def open(self): owner.append(threading.get_ident())
        def close(self): owner.append(threading.get_ident())
    events=queue.Queue()
    w=Worker(events,tmp_path,browser_factory=Browser)
    w.start(); w.submit('open')
    event=events.get(timeout=3)
    assert event['type']=='opened'
    w.submit('close'); w.join(timeout=3)
    assert not w.is_alive()
    assert len(set(owner))==1 and owner[0]!=threading.get_ident()


def test_search_config_validation_happens_before_browser_call(tmp_path):
    assert importlib.util.find_spec('korail_macro.worker'), 'worker not implemented'
    from korail_macro.worker import Worker
    events=queue.Queue()
    w=Worker(events,tmp_path)
    w.start()
    w.submit('search',Config('2000-01-01','용산','정읍'))
    event=events.get(timeout=3)
    assert event['type']=='error'
    assert '탑승일' in event['message']
    w.submit('close');w.join(timeout=3)
