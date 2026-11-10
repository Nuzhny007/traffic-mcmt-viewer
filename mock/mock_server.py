"""Mock TrafficMCMT WebSocket server (protocol v1).

Generates moving tracks around Aire (France), camera zones, heartbeats,
occasional ReID id merges and a synthetic concentration grid, mimicking the C++
backend stream.

Usage:
    pip install -r mock/requirements.txt
    python mock/mock_server.py

Environment:
    MOCK_HOST       bind address (default 0.0.0.0)
    MOCK_PORT       port (default 8080)
    MOCK_TICK_HZ    updates per second (default 10)
    MOCK_TRACKS     number of simulated tracks (default 60)
    MOCK_EMISSIONS  emit emission_grid at 1 Hz (default 1, set 0 to disable)
"""

from __future__ import annotations

import array
import asyncio
import base64
import json
import math
import os
import random
import time
from dataclasses import dataclass

from aiohttp import WSMsgType, web

HOST = os.getenv("MOCK_HOST", "0.0.0.0")
PORT = int(os.getenv("MOCK_PORT", "8080"))
TICK_HZ = float(os.getenv("MOCK_TICK_HZ", "10"))
TRACK_COUNT = int(os.getenv("MOCK_TRACKS", "60"))
EMISSIONS = os.getenv("MOCK_EMISSIONS", "1") not in ("0", "false", "off", "")
WS_PATH = "/ws"

# Concentration grid: 600 x 450 m of 5 m cells, centred on the road.
EMISSION_COLS = 120
EMISSION_ROWS = 90
EMISSION_CELL_M = 5.0
EMISSION_ORIGIN = (5.97445, 45.52736)
EMISSION_HZ = 1.0
# Plume offset and width, metres. Wind from 225 deg pushes it north-east.
WIND_EAST = 0.7071
WIND_NORTH = 0.7071
EMISSION_SIGMA_M = 18.0
EMISSION_DRIFT_M = 12.0
# Peak concentration per unit of source strength, ug/m3.
POLLUTANT_SCALE = {
    "NOx": 900.0,
    "CO": 7_000.0,
    "PM2.5": 45.0,
    "PM10": 90.0,
    "CO2": 210_000.0,
}

EARTH_M_PER_DEG = 111_320.0

# Road centreline around Aire, matching data/aire/geo_bind.ini.
ROAD: list[tuple[float, float]] = [
    (5.97295, 45.52820),
    (5.97345, 45.52792),
    (5.97395, 45.52764),
    (5.97445, 45.52736),
    (5.97495, 45.52708),
    (5.97545, 45.52678),
    (5.97595, 45.52650),
    (5.97640, 45.52624),
]

ZONES = [
    {
        "camera_id": 1,
        "polygon": [
            [5.97270, 45.52855],
            [5.97425, 45.52855],
            [5.97465, 45.52710],
            [5.97315, 45.52710],
        ],
        "color": [239, 68, 68, 55],
    },
    {
        "camera_id": 2,
        "polygon": [
            [5.97430, 45.52735],
            [5.97615, 45.52735],
            [5.97650, 45.52595],
            [5.97465, 45.52595],
        ],
        "color": [59, 130, 246, 55],
    },
]

CLASSES = ["car", "car", "car", "truck", "bus", "bike", "person"]


def now_ms() -> int:
    return int(time.time() * 1000)


def local_xy(
    a: tuple[float, float], b: tuple[float, float]
) -> tuple[float, float]:
    """Approximate east/north offset in metres between two lon/lat points."""
    lat = math.radians((a[1] + b[1]) / 2.0)
    dx = (b[0] - a[0]) * EARTH_M_PER_DEG * math.cos(lat)
    dy = (b[1] - a[1]) * EARTH_M_PER_DEG
    return dx, dy


@dataclass(frozen=True)
class Segment:
    a: tuple[float, float]
    b: tuple[float, float]
    length: float
    east: float  # unit vector, east component
    north: float  # unit vector, north component


def build_segments(points: list[tuple[float, float]]) -> list[Segment]:
    segments: list[Segment] = []
    for a, b in zip(points, points[1:]):
        dx, dy = local_xy(a, b)
        length = math.hypot(dx, dy)
        if length <= 0:
            continue
        segments.append(Segment(a, b, length, dx / length, dy / length))
    return segments


SEGMENTS = build_segments(ROAD)
TOTAL_LENGTH = sum(segment.length for segment in SEGMENTS)


def point_at(distance: float) -> tuple[float, float, float, float]:
    """Return (lon, lat, east, north) at the given distance along the road."""
    d = max(0.0, min(distance, TOTAL_LENGTH))
    for segment in SEGMENTS:
        if d <= segment.length:
            t = d / segment.length if segment.length else 0.0
            lon = segment.a[0] + (segment.b[0] - segment.a[0]) * t
            lat = segment.a[1] + (segment.b[1] - segment.a[1]) * t
            return lon, lat, segment.east, segment.north
        d -= segment.length

    last = SEGMENTS[-1]
    return last.b[0], last.b[1], last.east, last.north


@dataclass
class Track:
    id: int
    distance: float
    direction: int
    speed: float
    lane: float
    cls: str

    @property
    def camera_id(self) -> int:
        return 1 if self.distance < TOTAL_LENGTH / 2.0 else 2

    def step(self, dt: float) -> None:
        self.distance += self.speed * self.direction * dt

        # Ping-pong at both ends of the simulated road.
        if self.distance > TOTAL_LENGTH:
            self.distance = TOTAL_LENGTH - (self.distance - TOTAL_LENGTH)
            self.direction = -1
        elif self.distance < 0:
            self.distance = -self.distance
            self.direction = 1

        self.distance = max(0.0, min(self.distance, TOTAL_LENGTH))

    def to_update(self) -> dict:
        lon, lat, east, north = point_at(self.distance)

        # Perpendicular lane offset, metres.
        offset_east = -north * self.lane
        offset_north = east * self.lane
        lon += offset_east / (EARTH_M_PER_DEG * math.cos(math.radians(lat)))
        lat += offset_north / EARTH_M_PER_DEG

        return {
            "global_id": self.id,
            "camera_id": self.camera_id,
            "class": self.cls,
            "position": [round(lon, 7), round(lat, 7)],
            "velocity": [
                round(east * self.speed * self.direction, 2),
                round(north * self.speed * self.direction, 2),
            ],
            "speed_kmh": round(self.speed * 3.6, 2),
        }


def make_track(track_id: int) -> Track:
    return Track(
        id=track_id,
        distance=random.uniform(0.0, TOTAL_LENGTH),
        direction=random.choice((-1, 1)),
        speed=random.uniform(6.0, 16.0),
        lane=random.choice((-1, 1)) * random.uniform(2.0, 6.0),
        cls=random.choice(CLASSES),
    )


def make_tracks(count: int) -> list[Track]:
    return [make_track(1000 + index) for index in range(count)]


TRACKS = make_tracks(TRACK_COUNT)
CLIENTS: set[web.WebSocketResponse] = set()
NEXT_MERGE_ID = 100_000
NEXT_TRACK_ID = 200_000


def snapshot_payload() -> str:
    return json.dumps(
        {
            "type": "tracks_update",
            "timestamp": now_ms(),
            "mode": "snapshot",
            "tracks": [track.to_update() for track in TRACKS],
        },
        separators=(",", ":"),
    )


def zones_payload() -> str:
    return json.dumps(
        {
            "type": "camera_zones",
            "timestamp": now_ms(),
            "camera_zones": ZONES,
        },
        separators=(",", ":"),
    )


def _grid_bounds() -> dict[str, float]:
    lat0 = EMISSION_ORIGIN[1]
    m_per_deg_lon = EARTH_M_PER_DEG * math.cos(math.radians(lat0))
    half_w = EMISSION_COLS * EMISSION_CELL_M / 2.0
    half_h = EMISSION_ROWS * EMISSION_CELL_M / 2.0
    return {
        "west": EMISSION_ORIGIN[0] - half_w / m_per_deg_lon,
        "south": lat0 - half_h / EARTH_M_PER_DEG,
        "east": EMISSION_ORIGIN[0] + half_w / m_per_deg_lon,
        "north": lat0 + half_h / EARTH_M_PER_DEG,
    }


def _concentration_field() -> list[float]:
    """Sum of Gaussian puffs over the tracks, in relative units (0..1 per puff)."""
    lat0 = EMISSION_ORIGIN[1]
    m_per_deg_lon = EARTH_M_PER_DEG * math.cos(math.radians(lat0))
    half_w = EMISSION_COLS * EMISSION_CELL_M / 2.0
    half_h = EMISSION_ROWS * EMISSION_CELL_M / 2.0

    sources: list[tuple[float, float]] = []
    for track in TRACKS[:8]:
        lon, lat, _east, _north = point_at(track.distance)
        east = (lon - EMISSION_ORIGIN[0]) * m_per_deg_lon
        north = (lat - lat0) * EARTH_M_PER_DEG
        sources.append(
            (
                east + EMISSION_DRIFT_M * WIND_EAST,
                north + EMISSION_DRIFT_M * WIND_NORTH,
            )
        )

    inv = 1.0 / (2.0 * EMISSION_SIGMA_M * EMISSION_SIGMA_M)
    field: list[float] = []
    for row in range(EMISSION_ROWS):
        y = (row + 0.5) * EMISSION_CELL_M - half_h
        for col in range(EMISSION_COLS):
            x = (col + 0.5) * EMISSION_CELL_M - half_w
            total = 0.0
            for source_east, source_north in sources:
                dx = x - source_east
                dy = y - source_north
                total += math.exp(-(dx * dx + dy * dy) * inv)
            field.append(total)
    return field


def _field_stats(values: list[float]) -> tuple[float, float, float]:
    if not values:
        return 0.0, 0.0, 0.0
    peak = max(values)
    mean = sum(values) / len(values)
    nonzero = sorted(value for value in values if value > 0.0)
    p95 = nonzero[int(0.95 * (len(nonzero) - 1))] if nonzero else 0.0
    return peak, mean, p95


def emission_payload() -> str:
    """One `emission_grid` frame, same wire format as the C++ backend."""
    field = _concentration_field()
    fields: dict[str, dict[str, object]] = {}

    for name, scale in POLLUTANT_SCALE.items():
        values = [value * scale for value in field]
        peak, mean, p95 = _field_stats(values)
        # float32 LE, row-major south -> north; `array("f")` is LE on every
        # platform we support, matching the viewer's decoder.
        encoded = base64.b64encode(array.array("f", values).tobytes()).decode("ascii")
        fields[name] = {
            "data": encoded,
            "max": round(peak, 3),
            "mean": round(mean, 3),
            "p95": round(p95, 3),
        }

    return json.dumps(
        {
            "type": "emission_grid",
            "timestamp": now_ms(),
            "unit": "ug/m3",
            "bounds": _grid_bounds(),
            "cols": EMISSION_COLS,
            "rows": EMISSION_ROWS,
            "fields": fields,
        },
        separators=(",", ":"),
    )


LAST_EMISSION: str | None = None


def current_emission_payload(refresh: bool = False) -> str:
    global LAST_EMISSION
    if refresh or LAST_EMISSION is None:
        LAST_EMISSION = emission_payload()
    return LAST_EMISSION


async def broadcast(payload: str) -> None:
    dead: list[web.WebSocketResponse] = []
    for ws in list(CLIENTS):
        try:
            await ws.send_str(payload)
        except Exception:  # noqa: BLE001 - a broken client must not stop the feed
            dead.append(ws)
    for ws in dead:
        CLIENTS.discard(ws)


async def do_id_merge() -> None:
    global NEXT_MERGE_ID

    if not TRACKS:
        return

    track = random.choice(TRACKS)
    old_id = track.id
    track.id = NEXT_MERGE_ID
    NEXT_MERGE_ID += 1

    await broadcast(
        json.dumps(
            {
                "type": "id_merge",
                "old_id": old_id,
                "new_id": track.id,
                "timestamp": now_ms(),
            },
            separators=(",", ":"),
        )
    )
    print(f"[mock] id_merge {old_id} -> {track.id}", flush=True)


async def do_track_remove() -> None:
    """Expire one track and replace it with a fresh one.

    Mirrors the backend's `tracks_remove` extension: the viewer must delete the
    track instead of waiting for its local TTL.
    """
    global NEXT_TRACK_ID

    if not TRACKS:
        return

    track = random.choice(TRACKS)
    TRACKS.remove(track)
    await broadcast(
        json.dumps(
            {
                "type": "tracks_remove",
                "ids": [track.id],
                "timestamp": now_ms(),
            },
            separators=(",", ":"),
        )
    )

    replacement = make_track(NEXT_TRACK_ID)
    NEXT_TRACK_ID += 1
    TRACKS.append(replacement)
    print(f"[mock] tracks_remove {track.id} -> {replacement.id}", flush=True)


async def tick_loop() -> None:
    dt = 1.0 / TICK_HZ
    next_tick = time.monotonic()
    next_heartbeat = time.monotonic() + 5.0
    next_merge = time.monotonic() + 20.0
    next_remove = time.monotonic() + 15.0
    next_emission = time.monotonic()

    while True:
        next_tick += dt
        delay = next_tick - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)

        for track in TRACKS:
            track.step(dt)

        await broadcast(
            json.dumps(
                {
                    "type": "tracks_update",
                    "timestamp": now_ms(),
                    "mode": "delta",
                    "tracks": [track.to_update() for track in TRACKS],
                },
                separators=(",", ":"),
            )
        )

        now = time.monotonic()
        if EMISSIONS and now >= next_emission:
            next_emission = now + 1.0 / EMISSION_HZ
            await broadcast(current_emission_payload(refresh=True))
        if now >= next_heartbeat:
            next_heartbeat = now + 5.0
            await broadcast(
                json.dumps(
                    {"type": "heartbeat", "timestamp": now_ms()},
                    separators=(",", ":"),
                )
            )
        if now >= next_merge:
            next_merge = now + 25.0
            await do_id_merge()
        if now >= next_remove:
            next_remove = now + 15.0
            await do_track_remove()


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=30.0, max_msg_size=1 << 20)
    await ws.prepare(request)
    CLIENTS.add(ws)
    print(
        f"[mock] client connected from {request.remote} "
        f"({len(CLIENTS)} total)",
        flush=True,
    )

    try:
        await ws.send_str(zones_payload())
        await ws.send_str(snapshot_payload())
        if EMISSIONS:
            await ws.send_str(current_emission_payload())

        async for message in ws:
            if message.type == WSMsgType.TEXT and message.data == "ping":
                await ws.send_str(
                    json.dumps(
                        {"type": "heartbeat", "timestamp": now_ms()},
                        separators=(",", ":"),
                    )
                )
            elif message.type == WSMsgType.ERROR:
                break
    finally:
        CLIENTS.discard(ws)
        print(
            f"[mock] client disconnected ({len(CLIENTS)} total)",
            flush=True,
        )

    return ws


async def health_handler(request: web.Request) -> web.Response:
    return web.json_response(
        {
            "status": "ok",
            "protocol": 1,
            "clients": len(CLIENTS),
            "tracks": len(TRACKS),
            "tick_hz": TICK_HZ,
            "road_length_m": round(TOTAL_LENGTH, 1),
            "emissions": EMISSIONS,
        }
    )


async def on_startup(app: web.Application) -> None:
    app["tick_task"] = asyncio.create_task(tick_loop())


async def on_cleanup(app: web.Application) -> None:
    task: asyncio.Task = app["tick_task"]
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def main() -> None:
    app = web.Application()
    app.router.add_get(WS_PATH, ws_handler)
    app.router.add_get("/health", health_handler)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    print(
        f"[mock] TrafficMCMT stream on ws://{HOST}:{PORT}{WS_PATH} "
        f"({TRACK_COUNT} tracks @ {TICK_HZ:g} Hz, "
        f"road {TOTAL_LENGTH:.0f} m)",
        flush=True,
    )
    web.run_app(app, host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
