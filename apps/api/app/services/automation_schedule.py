from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models.entities import utc_now

WEEKDAY_INDEX = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}


@dataclass
class ScheduleDefinition:
    kind: str
    hour: int | None = None
    minute: int = 0
    weekdays: tuple[int, ...] = ()
    timezone: str = "UTC"


def parse_schedule(schedule: str, timezone_name: str = "UTC") -> ScheduleDefinition:
    _resolve_zone(timezone_name)
    raw = (schedule or "").strip().lower()
    if raw.startswith("hourly@"):
        minute = int(raw.split("@", 1)[1])
        if minute < 0 or minute > 59:
            raise ValueError("Hourly schedule minute must be between 0 and 59.")
        return ScheduleDefinition(kind="hourly", minute=minute, timezone=timezone_name)

    if raw.startswith("daily@"):
        hour, minute = _parse_clock(raw.split("@", 1)[1])
        return ScheduleDefinition(kind="daily", hour=hour, minute=minute, timezone=timezone_name)

    if raw.startswith("weekdays@"):
        hour, minute = _parse_clock(raw.split("@", 1)[1])
        return ScheduleDefinition(
            kind="weekly",
            hour=hour,
            minute=minute,
            weekdays=(0, 1, 2, 3, 4),
            timezone=timezone_name,
        )

    if raw.startswith("weekly:"):
        weekdays_raw, clock_raw = raw.split("@", 1)
        weekday_tokens = weekdays_raw.split(":", 1)[1].split(",")
        weekdays = tuple(WEEKDAY_INDEX[token.strip()] for token in weekday_tokens if token.strip() in WEEKDAY_INDEX)
        if not weekdays:
            raise ValueError("Weekly schedules require at least one weekday token like `mon`.")
        hour, minute = _parse_clock(clock_raw)
        return ScheduleDefinition(
            kind="weekly",
            hour=hour,
            minute=minute,
            weekdays=weekdays,
            timezone=timezone_name,
        )

    raise ValueError(
        "Unsupported schedule format. Use `hourly@15`, `daily@08:00`, `weekdays@08:00`, or `weekly:mon,wed@08:00`."
    )


def summarize_schedule(schedule: str, timezone_name: str = "UTC") -> str:
    definition = parse_schedule(schedule, timezone_name)
    if definition.kind == "hourly":
        return f"Every hour at minute {definition.minute:02d} ({definition.timezone})"
    if definition.kind == "daily":
        return f"Daily at {definition.hour:02d}:{definition.minute:02d} ({definition.timezone})"
    weekday_names = ", ".join(_weekday_name(index) for index in definition.weekdays)
    return f"{weekday_names} at {definition.hour:02d}:{definition.minute:02d} ({definition.timezone})"


def next_occurrence(
    schedule: str,
    timezone_name: str = "UTC",
    *,
    after: datetime | None = None,
) -> datetime:
    definition = parse_schedule(schedule, timezone_name)
    zone = _resolve_zone(definition.timezone)
    current = (after or utc_now()).astimezone(zone)

    if definition.kind == "hourly":
        candidate = current.replace(minute=definition.minute, second=0, microsecond=0)
        if candidate <= current:
            candidate = candidate + timedelta(hours=1)
        return candidate.astimezone(_resolve_zone("UTC"))

    candidate = current.replace(
        hour=definition.hour or 0,
        minute=definition.minute,
        second=0,
        microsecond=0,
    )
    for day_offset in range(0, 14):
        day_candidate = candidate + timedelta(days=day_offset)
        if day_candidate <= current:
            continue
        if definition.kind == "daily":
            return day_candidate.astimezone(_resolve_zone("UTC"))
        if day_candidate.weekday() in definition.weekdays:
            return day_candidate.astimezone(_resolve_zone("UTC"))
    raise ValueError("Could not determine the next automation occurrence.")


def _parse_clock(value: str) -> tuple[int, int]:
    parts = value.split(":")
    if len(parts) != 2:
        raise ValueError("Clock values must use HH:MM format.")
    hour = int(parts[0])
    minute = int(parts[1])
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise ValueError("Clock values must stay within 00:00-23:59.")
    return hour, minute


def _weekday_name(index: int) -> str:
    for key, value in WEEKDAY_INDEX.items():
        if value == index:
            return key.title()
    return str(index)


def _resolve_zone(timezone_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timezone `{timezone_name}`.") from exc
