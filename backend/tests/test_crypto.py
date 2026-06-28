import pytest
from cryptography.fernet import InvalidToken

from app.services.crypto import (
    encrypt_value,
    decrypt_value,
    mask_value,
    InvalidEncryptedValue,
)


def test_roundtrip():
    secret = "sk-cp-VeRySeCrEt"
    token = encrypt_value(secret)
    assert token != secret
    assert decrypt_value(token) == secret


def test_decrypt_garbage_raises():
    with pytest.raises(InvalidEncryptedValue):
        decrypt_value("not-a-fernet-token")


def test_mask_short():
    assert mask_value("") == ""
    assert mask_value("abc") == "***"


def test_mask_long_shows_prefix_and_suffix():
    masked = mask_value("sk-cp-VeRySeCrEt")
    assert masked.startswith("sk-c")
    assert masked.endswith("***")
    assert "VeRySeCrEt" not in masked
