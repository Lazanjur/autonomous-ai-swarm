import os

os.environ["AUTO_CREATE_TABLES"] = "false"
os.environ["TRUSTED_HOSTS"] = "localhost,127.0.0.1,api,testserver"

from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint():
    client = TestClient(app, base_url="http://localhost")
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
