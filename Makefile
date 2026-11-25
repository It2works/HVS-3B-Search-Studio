# HVS-3B Search Studio - developer entry points
PYTHON ?= python3

BACKEND_DIR := backend
FRONTEND_DIR := frontend
VENV_DIR := $(BACKEND_DIR)/.venv
BACKEND_PIP := "$(abspath $(VENV_DIR))/bin/pip"
BACKEND_PY := "$(abspath $(VENV_DIR))/bin/python"
BACKEND_RUFF := "$(abspath $(VENV_DIR))/bin/ruff"
BACKEND_PYTEST := "$(abspath $(VENV_DIR))/bin/pytest"

.PHONY: install check dev-backend dev-frontend

# install: backend dependencies into a local venv, frontend dependencies via npm
install:
	$(PYTHON) -m venv "$(VENV_DIR)"
	$(BACKEND_PIP) install -e "$(BACKEND_DIR)"
	cd "$(FRONTEND_DIR)" && npm install

# check: lint + test the empty skeleton on both sides
check:
	cd "$(BACKEND_DIR)" && $(BACKEND_RUFF) check .
	cd "$(BACKEND_DIR)" && $(BACKEND_PYTEST)
	cd "$(FRONTEND_DIR)" && npm run lint
	cd "$(FRONTEND_DIR)" && npx tsc --noEmit
	cd "$(FRONTEND_DIR)" && npm run test

# dev-backend: FastAPI dev server (app module arrives with the API implementation)
dev-backend:
	cd "$(BACKEND_DIR)" && $(BACKEND_PY) -m uvicorn hvs_backend.main:app --reload --host 0.0.0.0 --port 8000

# dev-frontend: Vite dev server
dev-frontend:
	cd "$(FRONTEND_DIR)" && npm run dev
