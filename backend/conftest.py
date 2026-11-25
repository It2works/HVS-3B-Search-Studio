"""Pytest configuration for the empty skeleton.

Until the first tests land, collecting zero tests must not fail `make check`.
"""

import pytest


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    if exitstatus == pytest.ExitCode.NO_TESTS_COLLECTED:
        session.exitstatus = pytest.ExitCode.OK
