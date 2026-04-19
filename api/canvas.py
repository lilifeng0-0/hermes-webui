"""
Hermes Web UI -- Canvas API.
Provides list/load/save/new/delete endpoints for the canvas feature.

Canvas data structure:
  {
    id, name, created, modified,
    zoom, panX, panY,
    activeCanvasId,
    canvases: {
      [canvasId]: {
        zoom, panX, panY,
        components[],
        connections[]
      }
    }
  }

Attachment directory: temp/canvas/attachments/
"""

import json
import logging
import time
import uuid
from pathlib import Path

from api.config import REPO_ROOT

logger = logging.getLogger(__name__)

# ── Directory paths ────────────────────────────────────────────────────────────

CANVAS_DIR = REPO_ROOT / "temp" / "canvas"
CANVAS_INDEX_FILE = CANVAS_DIR / "_index.json"
ATTACHMENTS_DIR = CANVAS_DIR / "attachments"

# ── Low-level file I/O ─────────────────────────────────────────────────────────

def _ensure_dirs() -> None:
    """Create canvas dirs and attachment dir on first use."""
    CANVAS_DIR.mkdir(parents=True, exist_ok=True)
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)


def _canvas_file(canvas_id: str) -> Path:
    """Return the path to a canvas JSON file, sandboxed inside CANVAS_DIR."""
    _ensure_dirs()
    # Sanitise: only allow hex/dash chars to prevent traversal
    if not canvas_id or any(c not in '0123456789abcdef-' for c in canvas_id):
        raise ValueError("Invalid canvas_id")
    p = (CANVAS_DIR / f"{canvas_id}.json").resolve()
    p.relative_to(CANVAS_DIR.resolve())  # raises if outside
    return p


def _read_index() -> dict:
    """Return the canvas index {id: {name, created, modified}, ...}."""
    _ensure_dirs()
    if not CANVAS_INDEX_FILE.exists():
        return {}
    try:
        return json.loads(CANVAS_INDEX_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Failed to read canvas index: %s", e)
        return {}


def _write_index(idx: dict) -> None:
    """Persist the canvas index."""
    _ensure_dirs()
    CANVAS_INDEX_FILE.write_text(
        json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ── Canvas CRUD ────────────────────────────────────────────────────────────────

def list_canvases() -> list[dict]:
    """Return a list of canvas summaries (id, name, created, modified)."""
    idx = _read_index()
    return [
        {"id": cid, "name": info["name"], "created": info["created"], "modified": info["modified"]}
        for cid, info in idx.items()
    ]


def load_canvas(canvas_id: str) -> dict:
    """Load a full canvas by id. Raises KeyError if not found."""
    path = _canvas_file(canvas_id)
    if not path.exists():
        raise KeyError(f"Canvas {canvas_id!r} not found")
    return json.loads(path.read_text(encoding="utf-8"))


def new_canvas(name: str = "Untitled") -> dict:
    """Create a new canvas with a single default tab and return it."""
    _ensure_dirs()
    canvas_id = uuid.uuid4().hex
    now = time.time()
    default_tab_id = uuid.uuid4().hex

    canvas = {
        "id": canvas_id,
        "name": name,
        "created": now,
        "modified": now,
        "zoom": 1.0,
        "panX": 0,
        "panY": 0,
        "activeCanvasId": default_tab_id,
        "canvases": {
            default_tab_id: {
                "zoom": 1.0,
                "panX": 0,
                "panY": 0,
                "components": [],
                "connections": [],
            }
        },
    }

    # Persist
    path = _canvas_file(canvas_id)
    path.write_text(json.dumps(canvas, ensure_ascii=False, indent=2), encoding="utf-8")

    # Update index
    idx = _read_index()
    idx[canvas_id] = {"name": name, "created": now, "modified": now}
    _write_index(idx)

    return canvas


def save_canvas(canvas_id: str, data: dict) -> dict:
    """Overwrite a canvas. data may contain partial fields; only update what's given."""
    _ensure_dirs()
    # Load existing to merge
    try:
        existing = load_canvas(canvas_id)
    except KeyError:
        raise KeyError(f"Canvas {canvas_id!r} not found")

    now = time.time()
    # Merge top-level scalar fields
    for field in ("name", "zoom", "panX", "panY", "activeCanvasId"):
        if field in data:
            existing[field] = data[field]
    existing["modified"] = now

    # Merge canvases dict
    if "canvases" in data and isinstance(data["canvases"], dict):
        for cid, cdata in data["canvases"].items():
            if cid not in existing["canvases"]:
                existing["canvases"][cid] = {"zoom": 1.0, "panX": 0, "panY": 0, "components": [], "connections": []}
            for f in ("zoom", "panX", "panY", "components", "connections"):
                if f in cdata:
                    existing["canvases"][cid][f] = cdata[f]

    path = _canvas_file(canvas_id)
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

    # Update index
    idx = _read_index()
    if canvas_id in idx:
        idx[canvas_id]["name"] = existing["name"]
        idx[canvas_id]["modified"] = now
        _write_index(idx)

    return existing


def delete_canvas(canvas_id: str) -> None:
    """Delete a canvas and remove it from the index. Raises KeyError if not found."""
    path = _canvas_file(canvas_id)
    if not path.exists():
        raise KeyError(f"Canvas {canvas_id!r} not found")
    path.unlink()

    idx = _read_index()
    idx.pop(canvas_id, None)
    _write_index(idx)
