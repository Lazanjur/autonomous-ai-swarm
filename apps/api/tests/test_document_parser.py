import json

from app.services.rag.parser import DocumentParserService


def test_parse_plain_text_upload():
    parser = DocumentParserService()

    parsed = parser.parse_bytes("notes.txt", "text/plain", b"alpha\nbeta")

    assert parsed.source_type == "text"
    assert "alpha" in parsed.content_text


def test_parse_json_upload():
    parser = DocumentParserService()
    payload = json.dumps({"region": "EU", "priority": 1}).encode("utf-8")

    parsed = parser.parse_bytes("brief.json", "application/json", payload)

    assert parsed.source_type == "json"
    assert '"region": "EU"' in parsed.content_text


def test_parse_csv_upload():
    parser = DocumentParserService()
    payload = b"name,revenue\nnorth,10\nsouth,12\n"

    parsed = parser.parse_bytes("metrics.csv", "text/csv", payload)

    assert parsed.source_type == "csv"
    assert parsed.metadata["row_count"] == 2
    assert "name,revenue" in parsed.content_text
