"""Watermark domain logic (phase 1): image validation, preferences, FFmpeg geometry and per-render decision.

- The image is validated by its real bytes (magic number + header dimensions + OpenCV decode), never by the file
  extension or the client content-type, and is ALWAYS stored re-encoded as PNG at a fixed server-built path.
- Geometry follows `docs/profiles-publishing/architecture.md` 11.4 (1080x1920 output, 4% margin, 25% height cap).
- The per-render decision follows the table of 11.3 (request x profile mode).
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from app.domain.profiles import profile_store as ps
from app.infrastructure.storage.atomic_store import atomic_write_bytes

if TYPE_CHECKING:  # runtime import is local to build_overlay (avoids a cycle through domain.rendering)
    from app.infrastructure.video.filter_script_builder import WatermarkOverlay

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MIN_IMAGE_SIDE = 16
MAX_IMAGE_SIDE = 4096

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
MARGIN_PX = 44  # 4% of 1080, rounded to an even number
BOX_HEIGHT_PX = OUTPUT_HEIGHT // 4  # 480: a tall image never takes over the screen

MSG_FORMAT = "Use uma imagem PNG, JPG ou WebP."
MSG_TOO_BIG_FILE = "A imagem passa de 5 MB."
MSG_TOO_BIG_DIMENSIONS = "A imagem é grande demais."
MSG_TOO_SMALL_DIMENSIONS = "A imagem é pequena demais."
MSG_UNREADABLE = "Não foi possível ler a imagem."
MSG_WATERMARK_MISSING = "A imagem da marca d'água não foi encontrada."
MSG_MODE_NEEDS_IMAGE = "Envie uma imagem antes de escolher quando usar a marca d'água."

_MAX_STORED_FILE_BYTES = 64 * 1024 * 1024  # sanity cap when re-reading our own PNG


class InvalidWatermarkImageError(ValueError):
    """The uploaded image was refused. `str(exc)` is the Portuguese message shown to the user."""


class WatermarkMissingError(ValueError):
    """The watermark must be applied but the image is missing or cannot be decoded (`watermark_missing`)."""

    def __init__(self, detail: str = MSG_WATERMARK_MISSING) -> None:
        super().__init__(detail)
        self.detail = detail


class WatermarkPatchError(ValueError):
    """A value of `PUT /profiles/:id/watermark` is out of range or has the wrong type (HTTP 400)."""


# ---------------------------------------------------------------------------
# Image validation
# ---------------------------------------------------------------------------


def _sniff_kind(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _png_header(data: bytes) -> tuple[int, int, bool] | None:
    if len(data) < 33 or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    animated = False
    pos = 8
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        ctype = data[pos + 4 : pos + 8]
        if ctype == b"acTL":
            animated = True
            break
        if ctype in (b"IDAT", b"IEND"):
            break
        pos += 12 + length
    return width, height, animated


def _jpeg_header(data: bytes) -> tuple[int, int, bool] | None:
    pos = 2
    size = len(data)
    while pos + 4 <= size:
        if data[pos] != 0xFF:
            return None
        while pos < size and data[pos] == 0xFF:
            pos += 1
        if pos >= size:
            return None
        marker = data[pos]
        pos += 1
        if marker in (0x01, 0xD8) or 0xD0 <= marker <= 0xD7:
            continue
        if marker == 0xDA or marker == 0xD9:
            return None
        if pos + 2 > size:
            return None
        seg_len = struct.unpack(">H", data[pos : pos + 2])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if pos + 7 > size:
                return None
            height, width = struct.unpack(">HH", data[pos + 3 : pos + 7])
            return width, height, False
        pos += seg_len
    return None


def _webp_header(data: bytes) -> tuple[int, int, bool] | None:
    if len(data) < 30:
        return None
    fourcc = data[12:16]
    body = data[20:]
    animated = b"ANIM" in data[12:256]
    if fourcc == b"VP8X":
        if len(body) < 10:
            return None
        animated = animated or bool(body[0] & 0x02)
        width = 1 + int.from_bytes(body[4:7], "little")
        height = 1 + int.from_bytes(body[7:10], "little")
        return width, height, animated
    if fourcc == b"VP8 ":
        if len(body) < 10 or body[3:6] != b"\x9d\x01\x2a":
            return None
        width = struct.unpack("<H", body[6:8])[0] & 0x3FFF
        height = struct.unpack("<H", body[8:10])[0] & 0x3FFF
        return width, height, animated
    if fourcc == b"VP8L":
        if len(body) < 5 or body[0] != 0x2F:
            return None
        bits = int.from_bytes(body[1:5], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height, animated
    return None


def _read_header(data: bytes, kind: str) -> tuple[int, int, bool] | None:
    try:
        if kind == "png":
            return _png_header(data)
        if kind == "jpeg":
            return _jpeg_header(data)
        return _webp_header(data)
    except (struct.error, IndexError):
        return None


def _decode_to_bgra(data: bytes, kind: str | None = None) -> Any:
    # OpenCV/numpy are imported lazily: they must not load when the API merely starts (heavy-import guard test).
    import cv2
    import numpy as np

    buf = np.frombuffer(data, dtype=np.uint8)
    try:
        # JPEG: IMREAD_COLOR applies the EXIF orientation (a JPEG has no alpha, so nothing is lost).
        flags = cv2.IMREAD_COLOR if kind == "jpeg" else cv2.IMREAD_UNCHANGED
        img = cv2.imdecode(buf, flags)
    except cv2.error as exc:
        raise InvalidWatermarkImageError(MSG_UNREADABLE) from exc
    if img is None or img.size == 0:
        raise InvalidWatermarkImageError(MSG_UNREADABLE)
    if img.dtype == np.uint16:
        img = np.rint(img.astype(np.float32) / 257.0).astype(np.uint8)
    elif img.dtype != np.uint8:
        raise InvalidWatermarkImageError(MSG_UNREADABLE)
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
    if img.ndim == 3 and img.shape[2] == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    if img.ndim == 3 and img.shape[2] == 4:
        return img
    raise InvalidWatermarkImageError(MSG_UNREADABLE)


def validate_and_normalize_image(data: bytes) -> tuple[bytes, int, int]:
    """Validate an uploaded image and return `(png_bytes, width, height)`.

    Raises `InvalidWatermarkImageError` with the exact message the UI shows.
    """
    if len(data) > MAX_IMAGE_BYTES:
        raise InvalidWatermarkImageError(MSG_TOO_BIG_FILE)
    kind = _sniff_kind(data)
    if kind is None:
        raise InvalidWatermarkImageError(MSG_FORMAT)
    header = _read_header(data, kind)
    if header is None:
        raise InvalidWatermarkImageError(MSG_UNREADABLE)
    width, height, animated = header
    if animated:
        raise InvalidWatermarkImageError(MSG_FORMAT)
    # Header dimensions are checked BEFORE decoding so a tiny compressed bomb is never inflated.
    if width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE:
        raise InvalidWatermarkImageError(MSG_TOO_BIG_DIMENSIONS)
    if width < MIN_IMAGE_SIDE or height < MIN_IMAGE_SIDE:
        raise InvalidWatermarkImageError(MSG_TOO_SMALL_DIMENSIONS)

    bgra = _decode_to_bgra(data, kind)
    real_h, real_w = int(bgra.shape[0]), int(bgra.shape[1])
    if real_w > MAX_IMAGE_SIDE or real_h > MAX_IMAGE_SIDE:
        raise InvalidWatermarkImageError(MSG_TOO_BIG_DIMENSIONS)
    if real_w < MIN_IMAGE_SIDE or real_h < MIN_IMAGE_SIDE:
        raise InvalidWatermarkImageError(MSG_TOO_SMALL_DIMENSIONS)

    import cv2

    ok, encoded = cv2.imencode(".png", bgra, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise InvalidWatermarkImageError(MSG_UNREADABLE)
    return encoded.tobytes(), real_w, real_h


def stored_image_is_usable(path: Path | None = None) -> bool:
    """True when the stored watermark exists, is a regular file and decodes to an in-limits image."""
    target = path or ps.watermark_image_path()
    try:
        if not target.is_file() or target.is_symlink() or target.stat().st_size > _MAX_STORED_FILE_BYTES:
            return False
        data = target.read_bytes()
    except OSError:
        return False
    header = _read_header(data, "png") if _sniff_kind(data) == "png" else None
    if header is None:
        return False
    width, height, animated = header
    if animated or not (MIN_IMAGE_SIDE <= width <= MAX_IMAGE_SIDE and MIN_IMAGE_SIDE <= height <= MAX_IMAGE_SIDE):
        return False
    try:
        _decode_to_bgra(data)
    except InvalidWatermarkImageError:
        return False
    return True


# ---------------------------------------------------------------------------
# Preferences (settings view + updates)
# ---------------------------------------------------------------------------


def build_watermark_settings(profile: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build the `WatermarkSettings` response object."""
    profile = profile if profile is not None else ps.load_profile()
    block = ps.get_watermark_block(profile)
    has_image = ps.watermark_image_exists()
    image = block["image"] if has_image else None
    image_url: str | None = None
    if has_image:
        version = f"{image['updated_at']}-{profile.get('revision', 0)}" if image else "0"
        image_url = f"/profiles/{ps.LOCAL_PROFILE_ID}/watermark/image?v={quote(str(version), safe='')}"
    return {
        "mode": block["mode"],
        "has_image": has_image,
        "image_url": image_url,
        "opacity": block["opacity"],
        "position": block["position"],
        "size_percent": block["size_percent"],
        "image": image,
    }


def parse_watermark_patch(body: Any) -> dict[str, Any]:
    """Validate the body of `PUT /profiles/:id/watermark` (any subset of the four preference fields)."""
    if not isinstance(body, dict):
        raise WatermarkPatchError("Corpo inválido.")
    patch: dict[str, Any] = {}
    if "mode" in body:
        if body["mode"] not in ps.WATERMARK_MODES:
            raise WatermarkPatchError("Modo inválido.")
        patch["mode"] = body["mode"]
    if "opacity" in body:
        value = body["opacity"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise WatermarkPatchError("Transparência inválida.")
        if not (ps.MIN_OPACITY - 1e-9 <= float(value) <= ps.MAX_OPACITY + 1e-9):
            raise WatermarkPatchError("Transparência fora da faixa permitida.")
        patch["opacity"] = round(min(ps.MAX_OPACITY, max(ps.MIN_OPACITY, float(value))), 4)
    if "position" in body:
        if body["position"] not in ps.WATERMARK_POSITIONS:
            raise WatermarkPatchError("Posição inválida.")
        patch["position"] = body["position"]
    if "size_percent" in body:
        value = body["size_percent"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise WatermarkPatchError("Tamanho inválido.")
        if float(value) != int(value):
            raise WatermarkPatchError("Tamanho inválido.")
        if not (ps.MIN_SIZE_PERCENT <= int(value) <= ps.MAX_SIZE_PERCENT):
            raise WatermarkPatchError("Tamanho fora da faixa permitida.")
        patch["size_percent"] = int(value)
    return patch


def apply_watermark_patch(patch: dict[str, Any]) -> dict[str, Any]:
    """Apply validated preference changes. A mode other than `never` requires an image."""
    with ps.profile_lock:
        if patch.get("mode", "never") != "never" and not ps.watermark_image_exists():
            raise WatermarkMissingError(MSG_MODE_NEEDS_IMAGE)
        if not patch:
            return ps.load_profile()

        def _mutate(profile: dict[str, Any]) -> None:
            block = ps.get_watermark_block(profile)
            block.update(patch)
            ps.set_watermark_block(profile, block)

        return ps.update_profile(_mutate)


def store_watermark_image(data: bytes) -> dict[str, Any]:
    """Validate, normalize to PNG and store the image atomically. The mode is NOT changed (P21)."""
    png_bytes, width, height = validate_and_normalize_image(data)
    with ps.profile_lock:
        # Refuse (unreadable / newer schema) BEFORE touching the image file.
        ps._check_writable(ps.load_profile(create=True))
        atomic_write_bytes(ps.watermark_image_path(), png_bytes)
        updated_at = ps.now_iso()

        def _mutate(profile: dict[str, Any]) -> None:
            block = ps.get_watermark_block(profile)
            block["file"] = ps.WATERMARK_RELATIVE_FILE
            block["image"] = {"width": width, "height": height, "updated_at": updated_at}
            ps.set_watermark_block(profile, block)

        return ps.update_profile(_mutate)


def remove_watermark_image() -> dict[str, Any]:
    """Delete the stored image (fixed path) and return the mode to `never`."""
    with ps.profile_lock:
        ps._check_writable(ps.load_profile(create=True))
        ps.watermark_image_path().unlink(missing_ok=True)

        def _mutate(profile: dict[str, Any]) -> None:
            block = ps.get_watermark_block(profile)
            block["mode"] = "never"
            block["file"] = None
            block["image"] = None
            ps.set_watermark_block(profile, block)

        return ps.update_profile(_mutate)


# ---------------------------------------------------------------------------
# FFmpeg geometry
# ---------------------------------------------------------------------------


def _even(value: float) -> int:
    return int(math.floor(value / 2.0 + 0.5)) * 2


def build_overlay(
    position: str,
    size_percent: int | float,
    opacity: float,
    *,
    target_width: int = OUTPUT_WIDTH,
    target_height: int = OUTPUT_HEIGHT,
    image_width: int | None = None,
    image_height: int | None = None,
) -> WatermarkOverlay:
    """Compute the overlay values of architecture.md 11.4 (box width even, height cap 25%, 44 px margin)."""
    from app.infrastructure.video.filter_script_builder import WatermarkOverlay

    if position not in ps.WATERMARK_POSITIONS:
        position = ps.DEFAULT_POSITION
    if position == "center":
        vertical, horizontal = "middle", "center"
    else:
        vertical, horizontal = position.split("-")
    margin = MARGIN_PX
    if horizontal == "left":
        x = str(margin)
    elif horizontal == "center":
        x = "(W-w)/2"
    else:
        x = f"W-w-{margin}"
    if vertical == "top":
        y = str(margin)
    elif vertical == "middle":
        y = "(H-h)/2"
    else:
        y = f"H-h-{margin}"
    box_width = max(2, _even(target_width * float(size_percent) / 100.0))
    box_height = max(2, target_height // 4)
    scaled_width = scaled_height = None
    if image_width and image_height and image_width > 0 and image_height > 0:
        fit = min(box_width / image_width, box_height / image_height)
        scaled_width = max(2, _even(image_width * fit))
        scaled_height = max(2, _even(image_height * fit))
    return WatermarkOverlay(
        box_width=box_width,
        box_height=box_height,
        scaled_width=scaled_width,
        scaled_height=scaled_height,
        opacity=round(float(opacity), 2),
        x=x,
        y=y,
    )


# ---------------------------------------------------------------------------
# Per-render decision (architecture.md 11.3)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WatermarkDecision:
    apply: bool
    reason: str
    overlay: WatermarkOverlay | None = None
    image_path: Path | None = None

    def log_line(self) -> str:
        if not self.apply or self.overlay is None:
            return f"[rendering] Watermark: not applied ({self.reason})"
        return f"[rendering] Watermark: applied ({self.reason})"


def decide_watermark(requested: bool | None) -> WatermarkDecision:
    """Resolve whether a render applies the watermark.

    | requested | mode   | result                                   |
    | True      | any    | apply (WatermarkMissingError w/o image)  |
    | False     | any    | do not apply                             |
    | None      | always | apply                                    |
    | None      | never  | do not apply                             |
    | None      | ask    | do not apply (nobody answered; logged)   |
    """
    if requested is False:
        return WatermarkDecision(False, "request: false")

    try:
        profile = ps.load_profile()
    except (ps.ProfileUnreadableError, OSError):
        if requested is True:
            raise WatermarkMissingError() from None
        return WatermarkDecision(False, "profile unreadable; defaulting to off")

    block = ps.get_watermark_block(profile)
    if requested is True:
        reason = "request: true"
    elif block["mode"] == "always":
        reason = "profile mode: always"
    elif block["mode"] == "ask":
        return WatermarkDecision(False, "profile mode: ask and the request carried no answer")
    else:
        return WatermarkDecision(False, "profile mode: never")

    image_path = ps.watermark_image_path()
    if not stored_image_is_usable(image_path):
        raise WatermarkMissingError()
    image_meta = block.get("image") or {}
    overlay = build_overlay(
        block["position"],
        block["size_percent"],
        block["opacity"],
        image_width=image_meta.get("width"),
        image_height=image_meta.get("height"),
    )
    summary = f"{reason}; {block['position']}, {block['size_percent']}%, opacity {overlay.opacity:.2f}"
    return WatermarkDecision(True, summary, overlay=overlay, image_path=image_path)


def parse_watermark_flag(value: Any) -> bool | None:
    """Parse the optional `watermark` request field (`true`, `false` or absent/null)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    raise WatermarkPatchError("Valor inválido para watermark.")
