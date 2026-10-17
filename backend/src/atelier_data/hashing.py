"""Salted SHA256 helpers (Python hashlib, lowercase hex)."""
import hashlib


def sha_hex(salt: str, value: str) -> str:
    return hashlib.sha256((salt + value).encode("utf-8")).hexdigest()


def hex16(salt: str, value: str) -> str:
    return sha_hex(salt, value)[:16]


def bucket(salt: str, value: str, mod: int) -> int:
    return int(sha_hex(salt, value)[:8], 16) % mod
