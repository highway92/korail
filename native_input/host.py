"""Chrome native messaging -> one checked Windows mouse click. No HTTP server."""
import ctypes
from ctypes import wintypes
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import time


def validate(message, now=None):
    if not isinstance(message, dict):
        raise ValueError('native_invalid_message')
    if message == {'action': 'ping'}:
        return
    if set(message) != {'action', 'token', 'x', 'y', 'width', 'height', 'dpr', 'sentAt'}:
        raise ValueError('native_invalid_message')
    if message['action'] != 'click' or not isinstance(message['token'], str) or not re.fullmatch(r'korail-input-[a-f0-9]{32}', message['token']):
        raise ValueError('native_invalid_message')
    for name in ('x', 'y', 'width', 'height', 'dpr', 'sentAt'):
        if type(message[name]) not in (int, float) or not math.isfinite(message[name]):
            raise ValueError('native_invalid_message')
    if not (0 <= message['x'] < message['width'] <= 20000 and 0 <= message['y'] < message['height'] <= 20000 and .25 <= message['dpr'] <= 8):
        raise ValueError('native_invalid_geometry')
    if not -250 <= (time.time()*1000 if now is None else now)-message['sentAt'] <= 3000:
        raise ValueError('native_stale_request')


def screen_point(message, left, top, width, height):
    scale = width/message['width']
    # Reject side panels, split views, and mismatched display/zoom geometry.
    if abs(scale/message['dpr']-1) > .035:
        raise ValueError('native_viewport_mismatch')
    toolbar = height-message['height']*scale
    if not 0 <= toolbar <= 350*scale:
        raise ValueError('native_viewport_mismatch')
    x = round(left+message['x']*scale)
    y = round(top+toolbar+message['y']*scale)
    if not (left <= x < left+width and top+toolbar <= y < top+height):
        raise ValueError('native_invalid_geometry')
    return x, y


def wait_for_title(foreground, read_title, token, now=time.monotonic, sleep=time.sleep):
    window = foreground()
    deadline = now()+.6
    while True:
        if foreground() != window:
            raise ValueError('native_window_mismatch')
        if read_title(window).startswith(token):
            return window
        if now() >= deadline:
            raise ValueError('native_window_mismatch')
        sleep(.025)


def windows_click(message):
    if sys.platform != 'win32':
        raise ValueError('native_windows_required')
    user = ctypes.WinDLL('user32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    try:
        user.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except AttributeError:
        user.SetProcessDPIAware()
    user.GetForegroundWindow.restype = wintypes.HWND
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    user.WindowFromPoint.argtypes = [wintypes.POINT]
    user.WindowFromPoint.restype = wintypes.HWND
    user.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    user.GetAncestor.restype = wintypes.HWND
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    title = ctypes.create_unicode_buffer(512)
    # Chrome's native window title can lag behind document.title. Wait only on
    # this same foreground window, without moving the cursor or sending input.
    def read_title(window):
        user.GetWindowTextW(window, title, len(title))
        return title.value
    window = wait_for_title(user.GetForegroundWindow, read_title, message['token'])
    pid = wintypes.DWORD()
    user.GetWindowThreadProcessId(window, ctypes.byref(pid))
    process = kernel.OpenProcess(0x1000, False, pid.value)
    if not process:
        raise ValueError('native_process_unknown')
    try:
        executable = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(executable))
        if not kernel.QueryFullProcessImageNameW(process, 0, executable, ctypes.byref(length)) or Path(executable.value).name.lower() != 'chrome.exe':
            raise ValueError('native_process_mismatch')
    finally:
        kernel.CloseHandle(process)
    rect, origin = wintypes.RECT(), wintypes.POINT(0, 0)
    if not user.GetClientRect(window, ctypes.byref(rect)) or not user.ClientToScreen(window, ctypes.byref(origin)):
        raise ValueError('native_geometry_failed')
    x, y = screen_point(message, origin.x, origin.y, rect.right, rect.bottom)
    if user.GetAncestor(user.WindowFromPoint(wintypes.POINT(x, y)), 2) != window:
        raise ValueError('native_point_covered')

    class Mouse(ctypes.Structure):
        _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('mouseData', wintypes.DWORD),
                    ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]
    class Keyboard(ctypes.Structure):
        _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD),
                    ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]
    class Hardware(ctypes.Structure):
        _fields_ = [('uMsg', wintypes.DWORD), ('wParamL', wintypes.WORD), ('wParamH', wintypes.WORD)]
    class InputUnion(ctypes.Union):
        _fields_ = [('mi', Mouse), ('ki', Keyboard), ('hi', Hardware)]
    class Input(ctypes.Structure):
        _fields_ = [('type', wintypes.DWORD), ('data', InputUnion)]
    user.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
    user.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
    def send(flags):
        event = Input(type=0, data=InputUnion(mi=Mouse(dwFlags=flags)))
        return user.SendInput(1, ctypes.byref(event), ctypes.sizeof(Input)) == 1
    if not user.SetCursorPos(x, y):
        raise ValueError('native_move_failed')
    validate(message)  # Recheck freshness immediately before input.
    if user.GetForegroundWindow() != window:
        raise ValueError('native_window_changed')
    user.GetWindowTextW(window, title, len(title))
    if not title.value.startswith(message['token']) or user.GetAncestor(user.WindowFromPoint(wintypes.POINT(x, y)), 2) != window:
        raise ValueError('native_window_changed')
    if not send(0x0002):
        raise ValueError('native_down_failed')
    try:
        time.sleep(.045)
    finally:
        released = send(0x0004)
    if not released:
        raise ValueError('native_release_unknown')
    return {'ok': True, 'input': 'windows_mouse'}


def read_message(stream):
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError('native_invalid_frame')
    length = struct.unpack('<I', header)[0]
    if not 0 < length <= 4096:
        raise ValueError('native_invalid_frame')
    payload = stream.read(length)
    if len(payload) != length:
        raise ValueError('native_invalid_frame')
    return json.loads(payload)


def main():
    if sys.platform == 'win32':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    while True:
        fatal=False
        try:
            message = read_message(sys.stdin.buffer)
            if message is None:
                return
            validate(message)
            response = {'ok': True, 'version': 2} if message['action'] == 'ping' else windows_click(message)
        except Exception as error:
            code = str(error)
            response = {'ok': False, 'code': code if re.fullmatch(r'native_[a-z_]+', code) else 'native_host_error'}
            fatal = code == 'native_invalid_frame'
            if code == 'native_window_mismatch':
                response['inputDispatched'] = False  # This guard precedes all mouse operations.
        data = json.dumps(response, separators=(',', ':')).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('<I', len(data))+data)
        sys.stdout.buffer.flush()
        if fatal:
            return


if __name__ == '__main__':
    main()
