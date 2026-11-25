#!/usr/bin/env python3
"""Capture aligned Intel RealSense color and depth frames for Robot Vision.

The helper keeps Intel-specific capture outside the Node process. It writes a
small framed binary protocol to stdout. Depth is aligned to the color camera so
the previews share one pixel coordinate system, and the raw Z16 map can be
sampled with the same coordinates as the RGB image.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import signal
import struct
import sys
from typing import Any

MAGIC = b"RSP1"
RECORD_HEADER = struct.Struct("<4sIIIIfI")
RECORD_DEPTH = 1
RECORD_DEPTH_PREVIEW = 2
RECORD_COLOR_PREVIEW = 3
MAX_RECORD_BYTES = 64 * 1024 * 1024
OPTION_CHOICE_LABELS = {
    ("visual_preset", 6.0): "Remove Irregular Streaks",
}
COLOR_CONTROL_OPTIONS = {
    "exposure": "exposure",
    "gain": "gain",
    "whiteBalance": "white_balance",
    "brightness": "brightness",
    "contrast": "contrast",
    "focus": "focus",
}


def fail(message: str) -> None:
    print(message, file=sys.stderr, flush=True)
    raise SystemExit(1)


def imports() -> tuple[Any, Any, Any]:
    try:
        import numpy as np
        import pyrealsense2 as rs
        from PIL import Image
    except ImportError as error:
        fail(
            "RealSense depth support needs pyrealsense2, numpy and Pillow. "
            "Install packages/shared/vision/native/realsense-depth/requirements.txt "
            f"with the selected Python interpreter ({error})."
        )
    return rs, np, Image


def format_number(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return f"{value:.9g}"


def option_choices(
    sensor: Any,
    option: Any,
    minimum: float,
    maximum: float,
    step: float,
) -> list[dict[str, Any]]:
    get_description = getattr(sensor, "get_option_value_description", None)
    if not callable(get_description) or maximum <= minimum:
        return []
    count = int(round((maximum - minimum) / step)) + 1
    if count < 2 or count > 32:
        return []
    choices = []
    has_descriptive_label = False
    for index in range(count):
        value = minimum + index * step
        fallback = format_number(value)
        try:
            raw_label = get_description(option, value)
        except (RuntimeError, TypeError):
            raw_label = None
        label = (
            str(raw_label).strip()
            if raw_label is not None
            else OPTION_CHOICE_LABELS.get((option.name, value), fallback)
        )
        if not label:
            label = fallback
        if label != fallback:
            has_descriptive_label = True
        choices.append({"value": value, "label": label})
    return choices if has_descriptive_label else []


def sensor_for_stream(device: Any, stream_type: Any) -> Any | None:
    for sensor in device.sensors:
        if any(
            profile.stream_type() == stream_type
            for profile in sensor.get_stream_profiles()
        ):
            return sensor
    return None


def supported_capture_modes(
    sensor: Any,
    stream_type: Any,
    video_format: Any,
) -> list[dict[str, Any]]:
    modes: dict[tuple[int, int, int], dict[str, float]] = {}
    for profile in sensor.get_stream_profiles():
        if (
            profile.stream_type() != stream_type
            or profile.format() != video_format
        ):
            continue
        video = profile.as_video_stream_profile()
        intrinsics = video.get_intrinsics()
        modes[(video.width(), video.height(), profile.fps())] = {
            "fx": float(intrinsics.fx),
            "fy": float(intrinsics.fy),
            "cx": float(intrinsics.ppx),
            "cy": float(intrinsics.ppy),
        }
    return [
        {
            "width": width,
            "height": height,
            "fps": fps,
            "intrinsics": modes[(width, height, fps)],
        }
        for width, height, fps in sorted(
            modes.keys(),
            key=lambda item: (-item[0], -item[1], -item[2]),
        )
    ]


def color_sensor(rs: Any, serial: str) -> Any:
    device = next(
        (
            candidate
            for candidate in rs.context().query_devices()
            if candidate.get_info(rs.camera_info.serial_number) == serial
        ),
        None,
    )
    if device is None:
        raise RuntimeError(f"RealSense device not found: {serial}")
    sensor = sensor_for_stream(device, rs.stream.color)
    if sensor is None:
        raise RuntimeError(f"RealSense device has no color sensor: {serial}")
    return sensor


def option_control(
    sensor: Any,
    rs: Any,
    property_name: str,
    option_name: str,
    *,
    supports_auto: bool,
    auto_option: Any | None = None,
) -> dict[str, Any]:
    option = getattr(rs.option, option_name)
    if option not in sensor.get_supported_options():
        raise RuntimeError(f"Unsupported RealSense color option: {option_name}")
    option_range = sensor.get_option_range(option)
    auto = (
        supports_auto
        and auto_option is not None
        and sensor.get_option(auto_option) > 0
    )
    return {
        "property": property_name,
        "value": float(sensor.get_option(option)),
        "mode": "auto" if auto else "manual",
        "min": float(option_range.min),
        "max": float(option_range.max),
        "step": float(option_range.step),
        "default": float(option_range.default),
        "supportsAuto": supports_auto,
        "supportsManual": True,
    }


def query_color_controls(rs: Any, sensor: Any) -> dict[str, Any]:
    auto_exposure = rs.option.enable_auto_exposure
    auto_white_balance = rs.option.enable_auto_white_balance
    controls = {}
    supported = sensor.get_supported_options()
    for property_name, option_name in COLOR_CONTROL_OPTIONS.items():
        option = getattr(rs.option, option_name, None)
        if option is None:
            if property_name == "focus":
                continue
            raise RuntimeError(f"Unsupported RealSense color option: {option_name}")
        if option not in supported:
            if property_name == "focus":
                continue
            raise RuntimeError(f"Unsupported RealSense color option: {option_name}")
        supports_auto = property_name in ("exposure", "gain", "whiteBalance")
        controls[property_name] = option_control(
            sensor,
            rs,
            property_name,
            option_name,
            supports_auto=supports_auto,
            auto_option=(
                auto_white_balance
                if property_name == "whiteBalance"
                else auto_exposure
            )
            if supports_auto
            else None,
        )
    return controls


def set_color_control(rs: Any, sensor: Any, command: dict[str, Any]) -> None:
    property_name = command.get("property")
    option_name = COLOR_CONTROL_OPTIONS.get(str(property_name))
    if option_name is None:
        raise RuntimeError(f"Unsupported RealSense camera control: {property_name}")
    option = getattr(rs.option, option_name, None)
    if option is None:
        raise RuntimeError(f"Unsupported RealSense camera control: {property_name}")
    mode = command.get("mode")
    if mode not in ("auto", "manual"):
        raise RuntimeError(f"Invalid control mode: {mode}")
    if property_name == "focus" and mode == "auto":
        return
    if property_name in ("exposure", "gain"):
        sensor.set_option(
            rs.option.enable_auto_exposure,
            0.0 if mode == "manual" else 1.0,
        )
    if property_name == "whiteBalance":
        sensor.set_option(
            rs.option.enable_auto_white_balance,
            0.0 if mode == "manual" else 1.0,
        )
    if mode == "manual" or property_name in ("brightness", "contrast"):
        value = command.get("value")
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise RuntimeError(f"Invalid control value for {property_name}: {value}")
        sensor.set_option(option, float(value))


def control_bridge(rs: Any, serial: str) -> None:
    sensor = color_sensor(rs, serial)
    sys.stdout.write(
        json.dumps({"id": "ready", "ok": True}, separators=(",", ":")) + "\n"
    )
    sys.stdout.flush()
    for line in sys.stdin:
        request_id = None
        try:
            command = json.loads(line)
            request_id = command.get("id")
            action = command.get("action")
            if action == "query":
                response = {
                    "id": request_id,
                    "ok": True,
                    "controls": query_color_controls(rs, sensor),
                }
            elif action == "set":
                set_color_control(rs, sensor, command)
                response = {"id": request_id, "ok": True}
            elif action == "shutdown":
                sys.stdout.write(
                    json.dumps({"id": request_id, "ok": True}, separators=(",", ":"))
                    + "\n"
                )
                sys.stdout.flush()
                return
            else:
                raise RuntimeError(f"Unknown control action: {action}")
        except Exception as error:
            response = {
                "id": request_id,
                "ok": False,
                "error": str(error),
            }
        sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def list_devices(rs: Any) -> dict[str, Any]:
    devices = []
    for device in rs.context().query_devices():
        try:
            serial = device.get_info(rs.camera_info.serial_number)
            name = device.get_info(rs.camera_info.name)
        except RuntimeError:
            continue
        if not serial:
            continue
        try:
            product_line = device.get_info(rs.camera_info.product_line)
        except RuntimeError:
            product_line = ""
        depth_controls = []
        capture_modes = {"color": [], "depth": []}
        try:
            depth_sensor = sensor_for_stream(device, rs.stream.depth)
            if depth_sensor is None:
                raise StopIteration
            capture_modes["depth"] = supported_capture_modes(
                depth_sensor,
                rs.stream.depth,
                rs.format.z16,
            )
            for option in depth_sensor.get_supported_options():
                try:
                    if depth_sensor.is_option_read_only(option):
                        continue
                    option_range = depth_sensor.get_option_range(option)
                    minimum = float(option_range.min)
                    maximum = float(option_range.max)
                    step = float(option_range.step)
                    if (
                        not all(
                            math.isfinite(value)
                            for value in (minimum, maximum, step)
                        )
                        or maximum < minimum
                        or step <= 0
                    ):
                        continue
                    choices = option_choices(
                        depth_sensor,
                        option,
                        minimum,
                        maximum,
                        step,
                    )
                    depth_controls.append(
                        {
                            "key": option.name,
                            "label": option.name.replace("_", " ").title(),
                            "description": depth_sensor.get_option_description(
                                option
                            ),
                            "type": (
                                "boolean"
                                if minimum == 0
                                and maximum == 1
                                and step == 1
                                else "select"
                                if choices
                                else "number"
                            ),
                            **({"choices": choices} if choices else {}),
                            "min": minimum,
                            "max": maximum,
                            "step": step,
                            "default": float(option_range.default),
                            "value": float(depth_sensor.get_option(option)),
                        }
                    )
                except RuntimeError:
                    continue
        except (StopIteration, RuntimeError):
            pass
        try:
            color_sensor = sensor_for_stream(device, rs.stream.color)
            if color_sensor is not None:
                capture_modes["color"] = supported_capture_modes(
                    color_sensor,
                    rs.stream.color,
                    rs.format.bgr8,
                )
        except RuntimeError:
            pass
        devices.append(
            {
                "serial": serial,
                "name": name,
                "productLine": product_line,
                "depthControls": depth_controls,
                "captureModes": capture_modes,
            }
        )
    return {"devices": devices}


def write_record(
    stream: Any,
    record_type: int,
    frame_id: int,
    width: int,
    height: int,
    depth_scale_meters: float,
    payload: bytes,
) -> None:
    if len(payload) > MAX_RECORD_BYTES:
        fail(f"RealSense frame payload is too large: {len(payload)} bytes")
    stream.write(
        RECORD_HEADER.pack(
            MAGIC,
            record_type,
            frame_id,
            width,
            height,
            depth_scale_meters,
            len(payload),
        )
    )
    stream.write(payload)
    stream.flush()


def jpeg_bytes(image_module: Any, image: Any) -> bytes:
    buffer = io.BytesIO()
    image_module.fromarray(image).save(
        buffer,
        format="JPEG",
        quality=82,
        optimize=False,
    )
    return buffer.getvalue()


def stream_capture(
    rs: Any,
    np: Any,
    image_module: Any,
    serial: str,
    depth_width: int,
    depth_height: int,
    depth_fps: int,
    color_width: int,
    color_height: int,
    color_fps: int,
    horizontal_flip: bool,
    vertical_flip: bool,
    controls: dict[str, float],
) -> None:
    config = rs.config()
    config.enable_device(serial)
    config.enable_stream(
        rs.stream.depth,
        depth_width,
        depth_height,
        rs.format.z16,
        depth_fps,
    )
    config.enable_stream(
        rs.stream.color,
        color_width,
        color_height,
        rs.format.bgr8,
        color_fps,
    )
    pipeline = rs.pipeline()
    profile = pipeline.start(config)
    align = rs.align(rs.stream.color)
    stopping = False

    def stop(_signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True
        raise KeyboardInterrupt

    previous_sigint = signal.signal(signal.SIGINT, stop)
    previous_sigterm = signal.signal(signal.SIGTERM, stop)
    try:
        depth_sensor = profile.get_device().first_depth_sensor()
        apply_depth_controls(depth_sensor, controls)
        # Read the scale after applying saved controls. Reading it before the
        # restart applies depth_units reports the default scale with every frame.
        depth_scale = float(depth_sensor.get_depth_scale())
        colorizer = rs.colorizer()
        while not stopping:
            frames = pipeline.wait_for_frames(5000)
            aligned = align.process(frames)
            depth_frame = aligned.get_depth_frame()
            color_frame = frames.get_color_frame()
            if not depth_frame or not color_frame:
                fail("RealSense returned a frame without color and depth")
            frame_id = int(color_frame.get_frame_number())
            depth = np.asanyarray(depth_frame.get_data())
            color = np.asanyarray(color_frame.get_data())[:, :, ::-1].copy()
            depth_preview = np.asanyarray(
                colorizer.colorize(depth_frame).get_data()
            )
            if horizontal_flip:
                depth = np.fliplr(depth)
                color = np.fliplr(color)
                depth_preview = np.fliplr(depth_preview)
            if vertical_flip:
                depth = np.flipud(depth)
                color = np.flipud(color)
                depth_preview = np.flipud(depth_preview)
            depth_jpeg = jpeg_bytes(image_module, depth_preview)
            color_jpeg = jpeg_bytes(image_module, color)
            # The backend pairs all records by frame id.
            write_record(
                sys.stdout.buffer,
                RECORD_DEPTH,
                frame_id,
                color_width,
                color_height,
                depth_scale,
                np.ascontiguousarray(depth, dtype=np.uint16).tobytes(),
            )
            write_record(
                sys.stdout.buffer,
                RECORD_DEPTH_PREVIEW,
                frame_id,
                color_width,
                color_height,
                depth_scale,
                depth_jpeg,
            )
            write_record(
                sys.stdout.buffer,
                RECORD_COLOR_PREVIEW,
                frame_id,
                color_width,
                color_height,
                depth_scale,
                color_jpeg,
            )
    except KeyboardInterrupt:
        return
    finally:
        pipeline.stop()
        signal.signal(signal.SIGINT, previous_sigint)
        signal.signal(signal.SIGTERM, previous_sigterm)


def apply_depth_controls(sensor: Any, controls: dict[str, float]) -> None:
    if not controls:
        return
    values = dict(controls)
    if values.get("enable_auto_exposure", 0) == 1:
        values.pop("exposure", None)
        values.pop("gain", None)
    if values.get("auto_exposure_limit_toggle", 0) != 1:
        values.pop("auto_exposure_limit", None)
    if values.get("auto_gain_limit_toggle", 0) != 1:
        values.pop("auto_gain_limit", None)
    priorities = {
        "enable_auto_exposure": 0,
        "auto_exposure_limit_toggle": 1,
        "auto_gain_limit_toggle": 1,
        "visual_preset": 2,
        "emitter_enabled": 2,
        "laser_power": 3,
        "auto_exposure_limit": 3,
        "auto_gain_limit": 3,
    }
    options = {option.name: option for option in sensor.get_supported_options()}
    for key in sorted(values, key=lambda item: (priorities.get(item, 10), item)):
        option = options.get(key)
        if option is None:
            raise RuntimeError(f"Unsupported RealSense depth control: {key}")
        try:
            sensor.set_option(option, float(values[key]))
        except RuntimeError as error:
            raise RuntimeError(
                f"Failed to set RealSense depth control {key}={values[key]}: {error}"
            ) from error


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list")
    control = subparsers.add_parser("control")
    control.add_argument("--serial", required=True)
    stream = subparsers.add_parser("stream")
    stream.add_argument("--serial", required=True)
    stream.add_argument("--depth-width", required=True, type=int)
    stream.add_argument("--depth-height", required=True, type=int)
    stream.add_argument("--depth-fps", required=True, type=int)
    stream.add_argument("--color-width", required=True, type=int)
    stream.add_argument("--color-height", required=True, type=int)
    stream.add_argument("--color-fps", required=True, type=int)
    stream.add_argument("--horizontal-flip", action="store_true")
    stream.add_argument("--vertical-flip", action="store_true")
    stream.add_argument("--control", action="append", default=[])
    args = parser.parse_args()

    rs, np, image_module = imports()
    if args.command == "list":
        print(json.dumps(list_devices(rs), separators=(",", ":")), flush=True)
        return
    if args.command == "control":
        control_bridge(rs, args.serial)
        return
    controls = {}
    for item in args.control:
        key, separator, value = item.partition("=")
        if not separator or not key or not value:
            fail(f"Invalid RealSense control argument: {item}")
        try:
            controls[key] = float(value)
        except ValueError:
            fail(f"Invalid RealSense control value: {item}")
    stream_capture(
        rs,
        np,
        image_module,
        args.serial,
        args.depth_width,
        args.depth_height,
        args.depth_fps,
        args.color_width,
        args.color_height,
        args.color_fps,
        args.horizontal_flip,
        args.vertical_flip,
        controls,
    )


if __name__ == "__main__":
    main()
