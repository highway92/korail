import json
import os
from pathlib import Path
import tempfile


class CorruptStateError(ValueError):
    pass


class AlreadyRunningError(RuntimeError):
    pass


def app_data_dir():
    return Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share")) / "KorailMacro"


def _object(pairs):
    data = {}
    for key, value in pairs:
        if key in data:
            raise ValueError("duplicate JSON key")
        data[key] = value
    return data


def _invalid_constant(value):
    raise ValueError("non-finite JSON value")


class Store:
    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            value = json.loads(text, object_pairs_hook=_object, parse_constant=_invalid_constant)
            if not isinstance(value, dict):
                raise ValueError("object required")
            return value
        except (ValueError, TypeError) as exc:
            raise CorruptStateError("저장된 상태를 읽을 수 없습니다. 새 예약을 시작하지 않습니다") from exc

    def save(self, value):
        if not isinstance(value, dict):
            raise ValueError("object required")
        text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as f:
                temp = Path(f.name)
                f.write(text)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temp, self.path)
        finally:
            if temp is not None and temp.exists():
                temp.unlink()

    def clear(self):
        self.path.unlink(missing_ok=True)


class FileLock:
    def __init__(self, path):
        self.path = Path(path)
        self.handle = None

    def acquire(self):
        if self.handle is not None:
            raise AlreadyRunningError("이미 실행 중입니다")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.path, "a+b")
        try:
            handle.seek(0, 2)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            handle.close()
            raise AlreadyRunningError("프로그램이 이미 실행 중입니다") from exc
        self.handle = handle
        return self

    def release(self):
        if self.handle is not None:
            self.handle.close()
            self.handle = None

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *args):
        self.release()
