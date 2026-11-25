"""Equirectangular panorama -> perspective view rendering.

The expensive camera-plane meshgrid is cached per ``(fov, size, pano_shape)``.
Applying a pose to that grid (and the final sampling maps) is fully vectorized
and cached as well, so repeated frames at the same pose are effectively free.
"""

from __future__ import annotations

import math
from functools import lru_cache

import cv2
import numpy as np

_TWO_PI = 2.0 * math.pi


@lru_cache(maxsize=32)
def _remap_grid(
    fov: float, size: int, pano_shape: tuple[int, int]
) -> tuple[np.ndarray, np.ndarray, float]:
    """Camera-plane coordinates for the output grid.

    Cached by ``(fov, size, pano_shape)``: these are the invariant parts of
    every frame. Returns ``(x, y, f)`` with ``x`` right and ``y`` up, in units
    of the focal length.
    """
    del pano_shape  # part of the cache key; the grid itself only depends on fov/size
    f = size / 2.0 / math.tan(math.radians(fov) / 2.0)
    grid_y, grid_x = np.mgrid[0:size, 0:size]
    center = (size - 1) / 2.0
    x = (grid_x.astype(np.float64) - center) / f
    y = (center - grid_y.astype(np.float64)) / f
    return x, y, f


@lru_cache(maxsize=256)
def _pose_maps(
    fov: float,
    size: int,
    pano_shape: tuple[int, int],
    yaw: float,
    pitch: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Build the cv2 sampling maps for one pose from the cached camera grid."""
    x, y, _ = _remap_grid(fov, size, pano_shape)
    height, width = pano_shape

    yr = math.radians(yaw)
    pr = math.radians(pitch)
    sy, cy = math.sin(yr), math.cos(yr)
    sp, cp = math.sin(pr), math.cos(pr)

    # d = fwd + x*right + y*up, with
    #   fwd   = [sin(yaw)cos(pitch),  sin(pitch),  cos(yaw)cos(pitch)]
    #   right = [cos(yaw),           0,          -sin(yaw)]
    #   up    = [-sin(yaw)sin(pitch), cos(pitch), -cos(yaw)sin(pitch)]
    dx = sy * cp + x * cy + y * (-sy * sp)
    dy = sp + y * cp
    dz = cy * cp + x * (-sy) + y * (-cy * sp)

    lon = np.arctan2(dx, dz)
    lat = np.arctan2(dy, np.hypot(dx, dz))

    u = (lon / _TWO_PI + 0.5) * width
    v = (0.5 - lat / math.pi) * height

    # u is left unclamped so cv2.BORDER_WRAP handles the horizontal seam.
    # v is kept off the final row so BORDER_WRAP never blends top into bottom.
    map_x = u.astype(np.float32)
    map_y = np.clip(v, 0.0, max(height - 2, 0)).astype(np.float32)
    return map_x, map_y


def render_view(
    pano_rgb: np.ndarray,
    yaw: float,
    pitch: float,
    fov: float,
    size: int,
) -> np.ndarray:
    """Render a ``size x size`` perspective view at ``(yaw, pitch)`` degrees."""
    shape = (int(pano_rgb.shape[0]), int(pano_rgb.shape[1]))
    map_x, map_y = _pose_maps(
        float(fov), int(size), shape, float(yaw), float(pitch)
    )
    return cv2.remap(
        pano_rgb,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_WRAP,
    )
