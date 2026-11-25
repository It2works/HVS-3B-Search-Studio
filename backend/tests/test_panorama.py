"""Calibration and cache tests for equirectangular view rendering."""

import math

import numpy as np
import pytest

from hvs_backend.panorama import _pose_maps, _remap_grid, render_view

SIZE = 448
FOV = 90
WIDTH = 512
HEIGHT = 256


def _marker_pano(yaw, pitch, radius=3):
    """Black 2:1 panorama with a white marker at ``(yaw, pitch)``.

    Uses the inverse of the render math (lon -> u, lat -> v), with lon
    normalized through atan2 exactly as the forward projection does.
    """
    pano = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    yaw_rad = math.radians(yaw)
    lon = math.atan2(math.sin(yaw_rad), math.cos(yaw_rad))
    lat = math.radians(pitch)
    u = (lon / (2 * math.pi) + 0.5) * WIDTH
    v = (0.5 - lat / math.pi) * HEIGHT
    cx = int(round(u)) % WIDTH
    cy = int(np.clip(round(v), 0, HEIGHT - 1))

    ys = np.arange(max(0, cy - radius), min(HEIGHT, cy + radius + 1))
    xs = np.array([(cx + dx) % WIDTH for dx in range(-radius, radius + 1)])
    pano[np.ix_(ys, xs)] = 255
    return pano


def _white_centroid(view):
    mask = view[..., 0] > 128
    ys, xs = np.nonzero(mask)
    assert xs.size > 0, "marker is missing from the rendered view"
    return float(xs.mean()), float(ys.mean())


@pytest.mark.parametrize(
    ("yaw", "pitch"),
    [
        (0.0, 0.0),
        (45.0, 0.0),
        (123.5, 5.0),
        (359.0, 0.0),  # near the 360 wrap
        (-1.0, 0.0),  # negative yaw equivalent to 359
        (180.0, 0.0),  # exactly on the seam
        (0.0, 60.0),
        (180.0, -60.0),
        (270.0, 60.0),
        (90.0, -30.0),
    ],
)
def test_marker_renders_at_exact_center(yaw, pitch):
    pano = _marker_pano(yaw, pitch)
    view = render_view(pano, yaw, pitch, FOV, SIZE)
    cx, cy = _white_centroid(view)
    assert abs(cx - SIZE / 2) <= 2.0, f"x off by {cx - SIZE / 2}"
    assert abs(cy - SIZE / 2) <= 2.0, f"y off by {cy - SIZE / 2}"


def test_render_view_shape_dtype_and_no_mutation():
    pano = _marker_pano(0.0, 0.0)
    before = pano.copy()
    view = render_view(pano, 0.0, 0.0, FOV, SIZE)
    assert view.shape == (SIZE, SIZE, 3)
    assert view.dtype == np.uint8
    np.testing.assert_array_equal(pano, before)


def test_horizontal_seam_wraps():
    pano = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    pano[:, :6] = 255
    pano[:, -6:] = 255
    view = render_view(pano, 180.0, 0.0, FOV, SIZE)
    assert view[SIZE // 2, SIZE // 2, 0] == 255


def test_remap_grid_is_cached():
    _remap_grid.cache_clear()
    shape = (HEIGHT, WIDTH)
    first = _remap_grid(FOV, SIZE, shape)
    second = _remap_grid(FOV, SIZE, shape)
    assert first[0] is second[0]
    assert _remap_grid.cache_info().hits == 1
    assert _remap_grid.cache_info().misses == 1

    _remap_grid(60.0, SIZE, shape)
    assert _remap_grid.cache_info().misses == 2


def test_cache_is_keyed_by_pano_shape():
    _remap_grid.cache_clear()
    first = _remap_grid(FOV, SIZE, (HEIGHT, WIDTH))
    second = _remap_grid(FOV, SIZE, (HEIGHT // 2, WIDTH // 2))
    assert first[0] is not second[0]
    assert _remap_grid.cache_info().misses == 2


def test_pose_maps_are_vectorized_grid():
    map_x, map_y = _pose_maps(FOV, SIZE, (HEIGHT, WIDTH), 30.0, 10.0)
    assert map_x.shape == (SIZE, SIZE)
    assert map_y.shape == (SIZE, SIZE)
    assert map_x.dtype == np.float32
    assert map_y.dtype == np.float32
    assert np.isfinite(map_x).all()
    assert np.isfinite(map_y).all()
