"""Table-driven tests for angle math and success criteria."""

import pytest

from hvs_backend.geometry import angular_diff, check_success, clamp_pitch, wrap_yaw


@pytest.mark.parametrize(
    ("yaw", "expected"),
    [
        (0.0, 0.0),
        (90.0, 90.0),
        (359.0, 359.0),
        (360.0, 0.0),
        (450.0, 90.0),
        (720.0, 0.0),
        (-90.0, 270.0),
        (-360.0, 0.0),
        (-450.0, 270.0),
        (-1e-15, 0.0),  # tiny negative must not come back as 360.0
    ],
)
def test_wrap_yaw(yaw, expected):
    result = wrap_yaw(yaw)
    assert result == expected
    assert 0.0 <= result < 360.0


@pytest.mark.parametrize(
    ("pitch", "expected"),
    [
        (0.0, 0.0),
        (45.5, 45.5),
        (-45.5, -45.5),
        (90.0, 90.0),
        (-90.0, -90.0),
        (90.1, 90.0),
        (-90.1, -90.0),
        (180.0, 90.0),
        (-180.0, -90.0),
    ],
)
def test_clamp_pitch(pitch, expected):
    result = clamp_pitch(pitch)
    assert result == expected
    assert -90.0 <= result <= 90.0


@pytest.mark.parametrize(
    ("yaw1", "yaw2", "expected"),
    [
        (0.0, 0.0, 0.0),
        (45.0, 45.0, 0.0),
        (350.0, 10.0, 20.0),  # wrap-around the short way
        (10.0, 350.0, 20.0),
        (359.0, 1.0, 2.0),
        (1.0, 359.0, 2.0),
        (-10.0, 10.0, 20.0),
        (370.0, 10.0, 0.0),  # equivalent angles
        (0.0, 180.0, 180.0),
        (180.0, 0.0, 180.0),
        (90.0, 280.0, 170.0),
    ],
)
def test_angular_diff(yaw1, yaw2, expected):
    result = angular_diff(yaw1, yaw2)
    assert result == pytest.approx(expected)
    assert 0.0 <= result <= 180.0


@pytest.mark.parametrize(
    ("task", "pyaw", "ppitch", "gyaw", "gpitch", "expected"),
    [
        # HOS: dyaw <= 30 AND dpitch <= 20
        ("HOS", 0.0, 0.0, 0.0, 0.0, True),
        ("HOS", 30.0, 20.0, 0.0, 0.0, True),  # both boundaries
        ("HOS", 30.1, 0.0, 0.0, 0.0, False),
        ("HOS", 0.0, 20.1, 0.0, 0.0, False),
        ("HOS", 350.0, 0.0, 10.0, 0.0, True),  # circular dyaw = 20
        ("HOS", 0.0, 0.0, 350.0, 0.0, True),
        ("HOS", 0.0, 20.0, 0.0, -20.0, False),  # pitch difference is 40
        ("HOS", 0.0, -21.0, 0.0, 0.0, False),
        # HPS: dyaw <= 10, pitch ignored
        ("HPS", 0.0, 0.0, 0.0, 0.0, True),
        ("HPS", 10.0, 0.0, 0.0, 0.0, True),
        ("HPS", 10.1, 0.0, 0.0, 0.0, False),
        ("HPS", 0.0, 80.0, 0.0, -80.0, True),
        ("HPS", 350.0, 0.0, 0.0, 0.0, True),
        ("HPS", 349.0, 0.0, 0.0, 0.0, False),
        # Unknown tasks never succeed
        ("UNKNOWN", 0.0, 0.0, 0.0, 0.0, False),
        ("", 0.0, 0.0, 0.0, 0.0, False),
    ],
)
def test_check_success(task, pyaw, ppitch, gyaw, gpitch, expected):
    assert check_success(task, pyaw, ppitch, gyaw, gpitch) is expected
