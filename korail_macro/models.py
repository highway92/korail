from dataclasses import dataclass, asdict
import json


@dataclass(frozen=True)
class TrainKey:
    date: str
    departure: str
    arrival: str
    time: str
    number: str

    @property
    def id(self):
        return json.dumps(list(asdict(self).values()), ensure_ascii=False, separators=(",", ":"))


@dataclass(frozen=True)
class Train:
    key: TrainKey
    available_classes: tuple[str, ...]
    label: str = ""


@dataclass(frozen=True)
class Candidate:
    train: Train
    seat_class: str
