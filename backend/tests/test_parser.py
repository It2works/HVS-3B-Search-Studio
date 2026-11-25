"""Table-driven tests for model-output parsing."""

import pytest

from hvs_backend.parser import parse_model_output

FAILURE = {"think": "", "action": None, "parse_ok": False}


@pytest.mark.parametrize(
    ("raw", "current_yaw", "current_pitch", "think", "action", "parse_ok"),
    [
        # Valid tags
        (
            "<think>look left</think><answer>rotate(45, 0)</answer>",
            0.0,
            0.0,
            "look left",
            {"type": "rotate", "dyaw": 45.0, "dpitch": 0.0},
            True,
        ),
        # Weird spacing inside tags and around the arguments
        (
            "< think >  plan  < /think > < answer > ROTATE ( -12.5 , +3.5 ) < /answer >",
            0.0,
            0.0,
            "plan",
            {"type": "rotate", "dyaw": -12.5, "dpitch": 3.5},
            True,
        ),
        (
            "<answer>\n  rotate(\n 45 ,\n 0 )\n</answer>",
            0.0,
            0.0,
            "",
            {"type": "rotate", "dyaw": 45.0, "dpitch": 0.0},
            True,
        ),
        # Bare calls without tags
        (
            "rotate(45, 0)",
            0.0,
            0.0,
            "",
            {"type": "rotate", "dyaw": 45.0, "dpitch": 0.0},
            True,
        ),
        (
            "submit(90, 5)",
            0.0,
            0.0,
            "",
            {"type": "submit", "yaw": 90.0, "pitch": 5.0},
            True,
        ),
        # Uppercase tags + floats
        (
            "<ANSWER>SUBMIT(90.5, -5.25)</ANSWER>",
            0.0,
            0.0,
            "",
            {"type": "submit", "yaw": 90.5, "pitch": -5.25},
            True,
        ),
        (
            "rotate(1e2, -2.5e1)",
            0.0,
            0.0,
            "",
            {"type": "rotate", "dyaw": 100.0, "dpitch": -25.0},
            True,
        ),
        # Bare submit falls back to the current pose
        (
            "<answer>submit</answer>",
            123.4,
            -12.3,
            "",
            {"type": "submit", "yaw": 123.4, "pitch": -12.3},
            True,
        ),
        (
            "submit()",
            359.9,
            100.0,
            "",
            {"type": "submit", "yaw": 359.9, "pitch": 90.0},
            True,
        ),
        # One argument: given yaw, current pitch
        (
            "submit(42)",
            7.0,
            -8.0,
            "",
            {"type": "submit", "yaw": 42.0, "pitch": -8.0},
            True,
        ),
        # Submit coordinates are wrapped / clamped
        (
            "submit(370, 120)",
            0.0,
            0.0,
            "",
            {"type": "submit", "yaw": 10.0, "pitch": 90.0},
            True,
        ),
        (
            "submit(-90, -120)",
            0.0,
            0.0,
            "",
            {"type": "submit", "yaw": 270.0, "pitch": -90.0},
            True,
        ),
        # Multiple actions: only the first is used
        (
            "<answer>rotate(10,0) submit(20,5)</answer>",
            0.0,
            0.0,
            "",
            {"type": "rotate", "dyaw": 10.0, "dpitch": 0.0},
            True,
        ),
        (
            "submit(20,5) rotate(10,0)",
            0.0,
            0.0,
            "",
            {"type": "submit", "yaw": 20.0, "pitch": 5.0},
            True,
        ),
        # Reasoning is ignored when locating the action
        (
            "<think>I should rotate(99,99)</think><answer>rotate(1,2)</answer>",
            0.0,
            0.0,
            "I should rotate(99,99)",
            {"type": "rotate", "dyaw": 1.0, "dpitch": 2.0},
            True,
        ),
        (
            "<think>planning</think>rotate(7, 8)",
            0.0,
            0.0,
            "planning",
            {"type": "rotate", "dyaw": 7.0, "dpitch": 8.0},
            True,
        ),
        # Garbage / malformed output
        ("hello world", 0.0, 0.0, "", None, False),
        ("", 0.0, 0.0, "", None, False),
        ("rotate(abc, 0)", 0.0, 0.0, "", None, False),
        ("rotate(45)", 0.0, 0.0, "", None, False),
        ("submit(1,2,3)", 0.0, 0.0, "", None, False),
        ("💥 rotate(💥,0)", 0.0, 0.0, "", None, False),
        ("<think>trying</think>no action here", 0.0, 0.0, "trying", None, False),
    ],
)
def test_parse_model_output(raw, current_yaw, current_pitch, think, action, parse_ok):
    result = parse_model_output(raw, current_yaw, current_pitch)
    assert set(result) == {"think", "action", "parse_ok"}
    assert result["think"] == think
    assert result["action"] == action
    assert result["parse_ok"] is parse_ok


@pytest.mark.parametrize("raw", [None, 123, [], {}, b"rotate(1,2)"])
def test_parse_model_output_never_raises(raw):
    assert parse_model_output(raw, 0.0, 0.0) == FAILURE


@pytest.mark.parametrize(
    "raw",
    [
        "rotate(1,2)",
        "submit(3,4)",
        "<answer>rotate(1,2)</answer>",
    ],
)
def test_action_dict_has_exact_shape(raw):
    action = parse_model_output(raw, 0.0, 0.0)["action"]
    assert action is not None
    if action["type"] == "rotate":
        assert set(action) == {"type", "dyaw", "dpitch"}
        assert isinstance(action["dyaw"], float)
        assert isinstance(action["dpitch"], float)
    else:
        assert set(action) == {"type", "yaw", "pitch"}
        assert isinstance(action["yaw"], float)
        assert isinstance(action["pitch"], float)
