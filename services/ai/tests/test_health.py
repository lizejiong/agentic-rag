from starlette.testclient import TestClient

from rag_ai.main import app


def test_health_endpoints_report_live_and_ready() -> None:
    client = TestClient(app)

    live_response = client.get("/health/live")
    ready_response = client.get("/health/ready")

    assert live_response.status_code == 200
    assert live_response.json() == {"status": "live"}
    assert ready_response.status_code == 200
    assert ready_response.json() == {"status": "ready"}
