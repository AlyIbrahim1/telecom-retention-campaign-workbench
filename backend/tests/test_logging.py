from backend.app.core.logging import redact


def test_recursive_redaction_preserves_safe_metadata():
    value = {
        "method": "GET",
        "password": "hidden",
        "nested": [{"openai_api_key": "hidden", "status": 200}],
    }

    assert redact(value) == {
        "method": "GET",
        "password": "[REDACTED]",
        "nested": [{"openai_api_key": "[REDACTED]", "status": 200}],
    }
