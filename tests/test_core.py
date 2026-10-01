import importlib
import importlib.util
import json
import os
import subprocess
import sys
from dataclasses import replace
from datetime import date

import pytest


TODAY = date(2026, 10, 1)


def module(name):
    assert importlib.util.find_spec('korail_macro') is not None, 'core package not implemented'
    return importlib.import_module('korail_macro.' + name)


def key(**changes):
    return module('models').TrainKey(**dict(date='2026-10-02', departure='서울', arrival='부산', time='10:00', number='001', **changes))


def config():
    return module('config').Config(travel_date='2026-10-02', departure='서울', arrival='부산', targets=(key(),))


def test_identity_and_config_round_trip():
    c = config()
    c.validate(today=TODAY)
    assert json.loads(key().id) == ['2026-10-02', '서울', '부산', '10:00', '001']
    restored = module('config').Config.from_dict(json.loads(json.dumps(c.to_dict())))
    assert restored == c


@pytest.mark.parametrize('changes', [
    {'travel_date': '2026-09-30'}, {'travel_date': '2026-2-3'},
    {'travel_date': '2026-02-30'}, {'departure': ''}, {'arrival': '서울'},
    {'allowed_classes': ()}, {'allowed_classes': ('other',)},
    {'allowed_classes': ('일반실', '일반실')}, {'targets': ()},
    {'preference': ('unknown',)}, {'preference': ('x', 'x')},
])
def test_config_rejects_invalid_values(changes):
    with pytest.raises(ValueError):
        replace(config(), **changes).validate(today=TODAY)


def test_target_validation_and_optional_targets():
    c = config()
    replace(c, targets=()).validate(require_targets=False, today=TODAY)
    for changes in ({'date': '2026-10-03'}, {'departure': '대전'}, {'time': '25:00'}, {'number': ''}):
        with pytest.raises(ValueError):
            replace(c, targets=(replace(key(), **changes),)).validate(today=TODAY)
    with pytest.raises(ValueError):
        replace(c, targets=(key(), key())).validate(today=TODAY)
    replace(c, preference=(key().id,)).validate(today=TODAY)


@pytest.mark.parametrize('field', ['query_interval', 'navigation_timeout', 'element_timeout', 'reservation_retry_delay', 'error_initial_delay', 'error_multiplier', 'error_max_delay', 'payment_check_interval', 'payment_wait', 'ticket_timeout', 'max_runtime'])
@pytest.mark.parametrize('value', [True, 0, -1, float('nan'), float('inf'), '1'])
def test_timing_rejects_nonpositive_and_nonfinite_numbers(field, value):
    with pytest.raises(ValueError):
        replace(module('config').TimingConfig(), **{field: value}).validate()


@pytest.mark.parametrize('field', ['max_queries', 'max_consecutive_errors'])
@pytest.mark.parametrize('value', [True, 0, -1, 1.5, float('nan'), float('inf'), '2'])
def test_integer_limits(field, value):
    with pytest.raises(ValueError):
        replace(module('config').TimingConfig(), **{field: value}).validate()


def test_timing_defaults_backoff_and_stop_time():
    t = module('config').TimingConfig()
    t.validate()
    assert [t.error_delay(i) for i in [1, 2, 3, 4, 10000]] == [20, 40, 80, 80, 80]
    replace(t, max_runtime=None, max_queries=None, stop_at='2026-10-02T10:00:00+09:00').validate()
    for changes in ({'error_max_delay': 1}, {'action_delay': -1}, {'action_delay': True}, {'stop_at': '2026-10-02T10:00'}, {'stop_at': 'garbage'}):
        with pytest.raises(ValueError):
            replace(t, **changes).validate()


class FirstChoice:
    def __init__(self):
        self.sizes = []

    def choice(self, options):
        self.sizes.append(len(options))
        return options[0]


def test_selection_uses_train_first_then_class_and_full_identity():
    m = module('models')
    a, b = key(), replace(key(), number='003', time='11:00')
    c = replace(config(), targets=(a, b))
    rng = FirstChoice()
    trains = [m.Train(a, ('일반실', '특실')), m.Train(b, ('일반실',)), m.Train(replace(a, date='2026-10-03'), ('일반실',))]
    chosen = module('selection').choose_candidate(trains, c, rng)
    assert chosen == m.Candidate(trains[0], '일반실')
    assert rng.sizes == [2, 2]
    assert module('selection').choose_candidate([], c, rng) is None
    assert module('selection').choose_candidate([m.Train(a, ('특실',))], replace(c, allowed_classes=('일반실',)), rng) is None


def test_preference_and_duplicate_search_rows():
    m = module('models')
    a, b = key(), replace(key(), number='003')
    trains = [m.Train(a, ('일반실',)), m.Train(a, ('특실',)), m.Train(b, ('일반실',))]
    rng = FirstChoice()
    c = replace(config(), targets=(a, b), preference=(b.id, a.id))
    assert module('selection').choose_candidate(trains, c, rng).train.key == b
    rng = FirstChoice()
    module('selection').choose_candidate(trains, replace(c, preference=()), rng)
    assert rng.sizes == [2, 2]


def test_store_round_trip_clear_and_corrupt_refusal(tmp_path):
    s = module('storage').Store(tmp_path / 'nested' / 'state.json')
    assert s.load() is None
    s.save({'한글': '서울', 'count': 3})
    assert s.load() == {'한글': '서울', 'count': 3}
    s.path.write_text('{broken', encoding='utf-8')
    with pytest.raises(module('storage').CorruptStateError):
        s.load()
    assert s.path.read_text(encoding='utf-8') == '{broken'
    s.clear()
    s.clear()
    assert s.load() is None


def test_store_failed_replace_preserves_prior_data(tmp_path, monkeypatch):
    m = module('storage')
    s = m.Store(tmp_path / 'state.json')
    s.save({'value': 1})
    def fail(*args):
        raise OSError('simulated replace failure')
    monkeypatch.setattr(os, 'replace', fail)
    with pytest.raises(OSError):
        s.save({'value': 2})
    assert s.load() == {'value': 1}
    assert list(tmp_path.iterdir()) == [s.path]


def test_store_rejects_nonobject_and_nonfinite_json(tmp_path):
    m = module('storage')
    s = m.Store(tmp_path / 'state.json')
    for text in ['[]', 'null', '{"bad": NaN}', '{"x":1,"x":2}']:
        s.path.write_text(text, encoding='utf-8')
        with pytest.raises(m.CorruptStateError):
            s.load()
    with pytest.raises(ValueError):
        s.save({'bad': float('nan')})


def test_app_data_path_does_not_create_directory(tmp_path, monkeypatch):
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path))
    p = module('storage').app_data_dir()
    assert p == tmp_path / 'KorailMacro'
    assert not p.exists()


def test_file_lock_exclusion_and_release(tmp_path):
    m = module('storage')
    path = tmp_path / 'run.lock'
    with m.FileLock(path):
        with pytest.raises(m.AlreadyRunningError):
            m.FileLock(path).acquire()
        code = 'from korail_macro.storage import FileLock; import sys; FileLock(sys.argv[1]).acquire()'
        child = subprocess.run([sys.executable, '-c', code, str(path)], capture_output=True)
        assert child.returncode != 0
    with m.FileLock(path):
        pass


def test_process_death_releases_file_lock(tmp_path):
    m = module('storage')
    path = tmp_path / 'run.lock'
    code = 'from korail_macro.storage import FileLock; import sys; lock=FileLock(sys.argv[1]); lock.acquire(); print("locked", flush=True); sys.stdin.read()'
    child = subprocess.Popen([sys.executable, '-c', code, str(path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert child.stdout.readline().strip() == b'locked'
        child.terminate()
        child.wait(timeout=5)
        with m.FileLock(path):
            pass
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
