import io
import json
import struct

import pytest

from native_input.host import read_message, screen_point, validate, wait_for_title


def message():
    return dict(action='click', token='korail-input-'+'a'*32, x=500, y=400,
                width=1200, height=800, dpr=1.25, sentAt=10000)


def test_frame_and_ping():
    payload=json.dumps({'action':'ping'}).encode()
    assert read_message(io.BytesIO(struct.pack('<I',len(payload))+payload))=={'action':'ping'}
    validate({'action':'ping'})
    assert read_message(io.BytesIO(b'')) is None
    for data in (b'\x01',struct.pack('<I',5000),struct.pack('<I',20)+b'{}'):
        with pytest.raises(ValueError): read_message(io.BytesIO(data))


def test_message_boundaries_and_no_other_commands():
    validate(message(),now=10100)
    for updates in ({'action':'shell'},{'token':'anything'},{'x':-1},{'x':1200},{'dpr':0},{'x':True},{'y':float('nan')},{'sentAt':0},{'card':'secret'}):
        with pytest.raises(ValueError): validate(message()|updates,now=10100)


def test_physical_coordinates_with_dpi_and_negative_monitor_origin():
    assert screen_point(message(),-1920,40,1500,1100)==(-1295,640)
    with pytest.raises(ValueError,match='viewport_mismatch'):
        screen_point(message(),0,0,1800,1100)
    with pytest.raises(ValueError,match='viewport_mismatch'):
        screen_point(message(),0,0,1500,900)


def test_window_title_waits_for_update_without_switching_windows():
    clock=[0]
    def sleep(seconds): clock[0]+=seconds
    assert wait_for_title(lambda:7,lambda _: 'korail-input-test' if clock[0]>=.1 else 'old title',
                          'korail-input-test',now=lambda:clock[0],sleep=sleep)==7
    assert .1<=clock[0]<.2
    with pytest.raises(ValueError,match='native_window_mismatch'):
        wait_for_title(lambda:7,lambda _: 'wrong title','token',now=lambda:clock[0],sleep=sleep)
    windows=iter([7,8])
    with pytest.raises(ValueError,match='native_window_mismatch'):
        wait_for_title(lambda:next(windows),lambda _: 'token','token',now=lambda:0,sleep=sleep)
