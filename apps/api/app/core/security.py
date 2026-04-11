from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from app.core.config import get_settings

settings = get_settings()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    iterations = 600_000
    resolved_salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), resolved_salt, iterations)
    salt_b64 = base64.b64encode(resolved_salt).decode("utf-8")
    digest_b64 = base64.b64encode(derived).decode("utf-8")
    return f"pbkdf2_sha256${iterations}${salt_b64}${digest_b64}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iteration_text, salt_b64, digest_b64 = encoded.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False

    iterations = int(iteration_text)
    salt = base64.b64decode(salt_b64.encode("utf-8"))
    expected = base64.b64decode(digest_b64.encode("utf-8"))
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected)


def create_session_token() -> tuple[str, str, datetime]:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = utc_now() + timedelta(hours=settings.session_ttl_hours)
    return token, token_hash, expires_at


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
