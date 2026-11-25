"""Angle helpers shared by the episode loop, evaluator and replay UI.

All angles are degrees. Yaws are circular, pitches are bounded.
"""

from __future__ import annotations

FULL_TURN = 360.0
HALF_TURN = 180.0
PITCH_LIMIT = 90.0


def wrap_yaw(yaw: float) -> float:
    """Normalize any yaw into the half-open interval ``[0, 360)``."""
    wrapped = yaw % FULL_TURN
    # Very small negative floats can round back up to exactly 360.0.
    if wrapped >= FULL_TURN:
        return 0.0
    return float(wrapped)


def clamp_pitch(pitch: float) -> float:
    """Clamp pitch into ``[-90, 90]`` (straight down .. straight up)."""
    return float(max(-PITCH_LIMIT, min(PITCH_LIMIT, pitch)))


def angular_diff(yaw1: float, yaw2: float) -> float:
    """Shortest absolute circular distance between two yaws.

    ``angular_diff(350, 10) == 20`` rather than 340. The result is always
    in ``[0, 180]``.
    """
    diff = abs((yaw1 - yaw2) % FULL_TURN)
    if diff > HALF_TURN:
        diff = FULL_TURN - diff
    return float(diff)


def check_success(
    task: str,
    pred_yaw: float,
    pred_pitch: float,
    gt_yaw: float,
    gt_pitch: float,
) -> bool:
    """Evaluate a submitted pose against ground truth for a task.

    HOS (object search) tolerates 30 degrees azimuth and 20 degrees pitch.
    HPS (pose/heading search) is azimuth-only with a 10 degree tolerance.
    Unknown tasks are not successful.
    """
    dyaw = angular_diff(pred_yaw, gt_yaw)
    dpitch = abs(pred_pitch - gt_pitch)
    if task == "HOS":
        return dyaw <= 30.0 and dpitch <= 20.0
    if task == "HPS":
        return dyaw <= 10.0
    return False
