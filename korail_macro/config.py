from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta, timezone
import math
import re

from .models import TrainKey

KST = timezone(timedelta(hours=9))
CLASSES = ("일반실", "특실")


def positive(value, name, minimum=0, inclusive=False):
    if (type(value) not in (int, float) or not math.isfinite(value)
            or (value < minimum if inclusive else value <= minimum)):
        raise ValueError(f"{name}: 올바른 숫자를 입력하세요")


@dataclass(frozen=True)
class TimingConfig:
    query_interval: float = 10
    navigation_timeout: float = 30
    element_timeout: float = 10
    action_delay: float = 0
    reservation_retry_delay: float = 10
    error_initial_delay: float = 20
    error_multiplier: float = 2
    error_max_delay: float = 80
    max_consecutive_errors: int = 3
    max_queries: int | None = None
    max_runtime: float | None = 7200
    stop_at: str | None = None
    payment_check_interval: float = 3
    payment_wait: float = 600
    ticket_timeout: float = 60

    def validate(self):
        integer_fields = ("max_queries", "max_consecutive_errors")
        for name, value in asdict(self).items():
            if name == "stop_at":
                if value is not None:
                    try:
                        parsed = datetime.fromisoformat(value)
                        if parsed.tzinfo is None:
                            raise ValueError()
                    except (TypeError, ValueError):
                        raise ValueError("종료 시각은 시간대가 포함된 ISO 날짜·시각이어야 합니다") from None
            elif name in integer_fields:
                if name == "max_queries" and value is None:
                    continue
                if type(value) is not int or value < 1:
                    raise ValueError(f"{name}: 양의 정수를 입력하세요")
            elif name == "max_runtime" and value is None:
                continue
            else:
                positive(value, name, 1 if name == "error_multiplier" else 0,
                         name in ("action_delay", "error_multiplier"))
        if self.error_max_delay < self.error_initial_delay:
            raise ValueError("오류 대기 상한은 첫 대기 이상이어야 합니다")

    def error_delay(self, count):
        try:
            return min(self.error_initial_delay * self.error_multiplier ** max(0, count - 1), self.error_max_delay)
        except OverflowError:
            return self.error_max_delay


@dataclass(frozen=True)
class Config:
    travel_date: str
    departure: str
    arrival: str
    targets: tuple[TrainKey, ...] = ()
    allowed_classes: tuple[str, ...] = CLASSES
    preference: tuple[str, ...] = ()
    timings: TimingConfig = field(default_factory=TimingConfig)

    def validate(self, require_targets=True, today=None):
        try:
            d = date.fromisoformat(self.travel_date)
            if d.isoformat() != self.travel_date or d < (today or datetime.now(KST).date()):
                raise ValueError()
        except (TypeError, ValueError):
            raise ValueError("탑승일은 오늘 이후 YYYY-MM-DD 날짜로 입력하세요") from None
        if not all(isinstance(x, str) and x.strip() for x in (self.departure, self.arrival)) or self.departure == self.arrival:
            raise ValueError("서로 다른 출발역·도착역을 입력하세요")
        if not self.allowed_classes or len(set(self.allowed_classes)) != len(self.allowed_classes) or set(self.allowed_classes) - set(CLASSES):
            raise ValueError("일반실·특실 중 하나 이상 선택하세요")
        if require_targets and not self.targets:
            raise ValueError("대상 열차를 하나 이상 선택하세요")
        if len(set(self.targets)) != len(self.targets):
            raise ValueError("대상 열차가 중복되었습니다")
        for key in self.targets:
            if (key.date, key.departure, key.arrival) != (self.travel_date, self.departure, self.arrival):
                raise ValueError("조회 조건과 대상 열차가 다릅니다. 목록을 다시 조회하세요")
            if not isinstance(key.time, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", key.time) or not key.number:
                raise ValueError("열차 시각·번호를 확인하세요")
        if self.preference and (len(set(self.preference)) != len(self.preference) or set(self.preference) != {k.id for k in self.targets}):
            raise ValueError("선호 순서에는 모든 대상 열차가 한 번씩 있어야 합니다")
        self.timings.validate()

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        data = dict(data)
        data["targets"] = tuple(TrainKey(**v) for v in data.get("targets", []))
        data["allowed_classes"] = tuple(data.get("allowed_classes", CLASSES))
        data["preference"] = tuple(data.get("preference", []))
        data["timings"] = TimingConfig(**data.get("timings", {}))
        return cls(**data)
