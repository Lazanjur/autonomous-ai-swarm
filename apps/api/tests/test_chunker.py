from app.services.rag.chunker import chunk_text, estimate_tokens


def test_chunker_returns_multiple_overlapping_chunks():
    text = " ".join(["autonomous"] * 600)
    chunks = chunk_text(text, chunk_size=250, overlap=40)

    assert len(chunks) > 1
    assert chunks[0] != chunks[1]
    assert estimate_tokens(chunks[0]) > 0
