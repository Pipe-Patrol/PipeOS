"""Getting a recording off the robot.

The frame rate is the whole risk here. A raw MJPEG stream carries no timing, so
a wrong answer does not fail — it produces a video that plays at the wrong speed
and reports the wrong duration, which is the sort of thing nobody notices until
a report quotes a length that never happened.
"""

import json

import pytest

from pipepatrol.runs import video


def _index(path, count, fps):
    """An index of `count` frames captured at exactly `fps`."""
    start = 1_000_000.0
    path.write_text(
        json.dumps(
            [
                {"offset": i * 100, "length": 100, "at": start + i / fps}
                for i in range(count)
            ]
        )
    )
    return path


@pytest.mark.parametrize("fps", [5.0, 14.58, 15.0, 30.0])
def test_the_recorded_rate_is_recovered_exactly(tmp_path, fps):
    path = _index(tmp_path / "video.index.json", 300, fps)
    assert video.recorded_fps(path) == pytest.approx(fps, rel=1e-6)


def test_duration_comes_out_right(tmp_path):
    """What the rate is actually for: n frames at f fps must last n/f seconds."""
    frames, fps = 2172, 14.58
    path = _index(tmp_path / "video.index.json", frames, fps)
    recovered = video.recorded_fps(path)
    assert frames / recovered == pytest.approx(frames / fps, rel=1e-6)


def test_a_missing_index_falls_back_rather_than_failing(tmp_path):
    """No index is a reason to guess the cap, not to refuse the download."""
    assert video.recorded_fps(tmp_path / "absent.json") == video.DEFAULT_FPS


@pytest.mark.parametrize(
    "content",
    ["", "not json", "{}", "[]", '[{"at": 1.0}]', '[{"no_at": 1}, {"no_at": 2}]'],
)
def test_an_unusable_index_falls_back(tmp_path, content):
    path = tmp_path / "video.index.json"
    path.write_text(content)
    assert video.recorded_fps(path) == video.DEFAULT_FPS


def test_a_zero_length_recording_does_not_divide_by_zero(tmp_path):
    """Every frame stamped identically — a clock that never moved."""
    path = tmp_path / "video.index.json"
    path.write_text(json.dumps([{"at": 5.0}, {"at": 5.0}, {"at": 5.0}]))
    assert video.recorded_fps(path) == video.DEFAULT_FPS


def test_the_command_never_re_encodes(tmp_path):
    """The reason this is instant. -c:v copy must survive any future editing."""
    command = video._command(tmp_path / "video.mjpeg", 14.58)
    assert "-c:v" in command
    assert command[command.index("-c:v") + 1] == "copy"
    assert "libx264" not in command


def test_the_command_states_the_frame_rate_before_the_input(tmp_path):
    """`-framerate` is an input option; after -i it is silently ignored."""
    command = video._command(tmp_path / "video.mjpeg", 14.58)
    assert command.index("-framerate") < command.index("-i")
    assert command[command.index("-framerate") + 1] == "14.580"


def test_the_output_is_streamable(tmp_path):
    """A plain MOV writes its index last, so it cannot be streamed at all."""
    command = video._command(tmp_path / "video.mjpeg", 15.0)
    assert command[-1] == "pipe:1"
    assert "frag_keyframe+empty_moov" in command
