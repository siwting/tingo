"""Regression: inference silence padding must not extend source timestamps."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "mlx_helper", Path(__file__).parents[1] / "scripts" / "mlx_helper.py"
)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def test_short_tail_preserves_padding_but_not_its_duration():
    padded = [0] * 16000
    chunks = list(helper.timed_chunks([1] * 3200, 16000,
                                     lambda *a, **kw: [(padded, 0.0)]))
    assert chunks == [(padded, 0.0, 0.2)]
    assert len(chunks[0][0]) == 16000


def test_last_chunk_is_bounded_and_offset_preserved():
    chunks = list(helper.timed_chunks([1] * 60300, 1000,
        lambda *a, **kw: [([1] * 60000, 0), ([0] * 1000, 60)]))
    assert [(start, end) for _, start, end in chunks] == [(0, 60), (60, 60.3)]


def test_empty_audio_does_not_emit_padding_as_speech():
    assert list(helper.timed_chunks([], 16000,
        lambda *a, **kw: [([0] * 16000, 0)])) == []
