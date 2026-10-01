from dataclasses import asdict
import pytest
from korail_macro.config import TimingConfig
from korail_macro.gui import parse_timings, TIMING_LABELS


def test_every_timing_is_exposed_and_round_trips():
    defaults=TimingConfig()
    assert set(TIMING_LABELS)==set(asdict(defaults))
    values={k:'' if v is None else str(v) for k,v in asdict(defaults).items()}
    assert parse_timings(values)==defaults
    values.update(query_interval='1.5',max_queries='20',stop_at='2026-10-09T07:30:00+09:00')
    parsed=parse_timings(values)
    assert parsed.query_interval==1.5 and parsed.max_queries==20


@pytest.mark.parametrize('field,value',[('query_interval','0'),('max_queries','1.5'),('payment_wait','nan'),('stop_at','2026-10-09T07:30:00')])
def test_invalid_ui_values_are_rejected(field,value):
    values={k:'' if v is None else str(v) for k,v in asdict(TimingConfig()).items()}
    values[field]=value
    with pytest.raises(ValueError): parse_timings(values)
