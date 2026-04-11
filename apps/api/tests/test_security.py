from app.core.security import create_session_token, hash_password, hash_session_token, verify_password


def test_password_hash_round_trip():
    password = "DemoPass123!"
    encoded = hash_password(password)

    assert verify_password(password, encoded) is True
    assert verify_password("wrong-password", encoded) is False


def test_session_token_hash_is_deterministic():
    token, token_hash, _ = create_session_token()

    assert token
    assert token_hash == hash_session_token(token)
