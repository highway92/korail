from dataclasses import dataclass, asdict
from .models import TrainKey


class NeedsInspection(RuntimeError):
    """An unverified page or interaction must not be guessed."""


class ReservationRejected(RuntimeError):
    """The site explicitly confirms no reservation was created."""


@dataclass(frozen=True)
class Reservation:
    id: str
    key: TrainKey
    seat_class: str
    seat: str
    deadline: float | None = None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, value):
        value = dict(value)
        value['key'] = TrainKey(**value['key'])
        return cls(**value)


@dataclass(frozen=True)
class CheckResult:
    status: str  # clear, reserved, pending, paid, complete, expired, cancelled, unknown
    reservation: Reservation | None = None
