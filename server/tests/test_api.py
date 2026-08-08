"""The HTTP surface, driven through the real app with no hardware present.

Every device is absent on a laptop, which is the interesting case: the server
has to come up, report honestly what is missing, and still stop the motors.
"""

import pytest
from fastapi.testclient import TestClient

from pipepatrol import config
from pipepatrol.app import app, create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    with TestClient(app) as client:
        yield client


class TestHealth:
    def test_identifies_itself(self, client):
        body = client.get("/api/health").json()
        assert body["service"] == "pipepatrol"
        assert "version" in body

    def test_reports_what_is_not_wired(self, client):
        body = client.get("/api/health").json()
        assert "battery" in body["unavailable"]
        assert "motor_current" in body["unavailable"]

    def test_reports_absent_hardware_as_absent(self, client):
        capabilities = client.get("/api/health").json()["capabilities"]
        assert capabilities["motors"] is False  # no gpiozero on a laptop
        # The detector depends on whether an exported model is present, which
        # differs between a fresh clone and a machine that has run the export.
        # Asserting either way would make this test fail for one of them.
        assert isinstance(capabilities["detector"], bool)


class TestStop:
    def test_works_without_a_websocket(self, client):
        body = client.post("/api/stop").json()
        assert body["ok"] is True
        assert body["drive"]["moving"] is False


class TestTelemetry:
    def test_envelope_labels_unavailable_readings(self, client):
        body = client.get("/api/telemetry").json()
        assert body["power"]["battery"]["quality"] == "unavailable"
        assert body["power"]["battery"]["percent"] is None

    def test_motion_is_labelled_estimated(self, client):
        body = client.get("/api/telemetry").json()
        assert body["motion"]["quality"] == "estimated"

    def test_alert_names_the_missing_camera(self, client):
        body = client.get("/api/telemetry").json()
        assert body["alert"] is not None


class TestNorth:
    def test_refused_when_there_is_no_imu_to_anchor_to(self, client):
        """No sensor on a laptop. A reference against nothing would read as set
        and mean nothing."""
        response = client.post("/api/north", json={"facing_deg": 0.0})

        assert response.status_code == 409
        assert client.get("/api/telemetry").json()["orientation"]["north_set"] is False

    def test_a_bearing_outside_a_circle_is_rejected(self, client):
        assert client.post("/api/north", json={"facing_deg": 360.0}).status_code == 422
        assert client.post("/api/north", json={"facing_deg": -1.0}).status_code == 422

    def test_clearing_is_harmless_when_it_was_never_set(self, client):
        assert client.request("DELETE", "/api/north").status_code == 200

    def test_the_heading_is_null_until_north_is_set(self, client):
        orientation = client.get("/api/telemetry").json()["orientation"]

        assert orientation["heading_deg"] is None
        assert orientation["north_set"] is False
        assert orientation["north_stale"] is False


class TestLed:
    def test_clamps_out_of_range_requests(self, client):
        assert client.post("/api/led", json={"level": 5.0}).status_code == 422
        assert client.post("/api/led", json={"level": 0.5}).status_code == 200


class TestPreflight:
    """The sweep, and the one probe in it that moves the robot."""

    def test_sweep_leaves_the_motors_alone_unless_asked(self, client):
        probes = client.post("/api/preflight").json()["probes"]
        assert "storage" in probes
        assert "motors" not in probes

    def test_sweep_includes_the_motors_when_asked(self, client):
        probes = client.post("/api/preflight", json={"motors": True}).json()["probes"]
        assert "motors" in probes

    def test_a_run_in_progress_refuses_the_motors_but_not_the_sweep(self, client):
        client.post("/api/runs", json={"name": "a"})

        probes = client.post("/api/preflight", json={"motors": True}).json()["probes"]
        # Refused, and reported as not-run rather than as a failure: the console
        # leaves a `ran: false` row showing whatever telemetry says.
        assert probes["motors"]["ran"] is False
        assert probes["storage"]["ran"] is True

    def test_the_motor_route_is_a_conflict_during_a_run(self, client):
        client.post("/api/runs", json={"name": "a"})
        assert client.post("/api/preflight/motors").status_code == 409


class TestRuns:
    def test_start_list_and_end(self, client):
        started = client.post("/api/runs", json={"name": "MH12"}).json()["run"]
        assert started["name"] == "MH12"

        listing = client.get("/api/runs").json()
        assert listing["active_run_id"] == started["id"]

        ended = client.post(f"/api/runs/{started['id']}/end").json()["run"]
        assert ended["ended_at"] is not None

    def test_ending_a_run_that_is_not_active_is_a_conflict(self, client):
        run = client.post("/api/runs", json={"name": "a"}).json()["run"]
        client.post(f"/api/runs/{run['id']}/end")
        assert client.post(f"/api/runs/{run['id']}/end").status_code == 409

    def test_defect_is_stamped_with_chainage_and_its_uncertainty(self, client):
        run = client.post("/api/runs", json={"name": "a"}).json()["run"]

        defect = client.post(
            f"/api/runs/{run['id']}/defects",
            json={"code": "RB", "severity": 4, "with_snapshot": False},
        ).json()["defect"]

        assert defect["code"] == "RB"
        assert defect["chainage_m"] is not None
        assert defect["chainage_uncertainty_m"] is not None

    def test_the_motors_are_armed_only_while_a_run_is_open(self, client):
        assert client.get("/api/telemetry").json()["drive"]["armed"] is False

        run = client.post("/api/runs", json={"name": "a"}).json()["run"]
        assert client.get("/api/telemetry").json()["drive"]["armed"] is True

        client.post(f"/api/runs/{run['id']}/end")
        assert client.get("/api/telemetry").json()["drive"]["armed"] is False

    def test_an_entry_point_survives_the_round_trip(self, client):
        run = client.post(
            "/api/runs",
            json={
                "name": "MH12",
                "origin": {"lat": 51.5072, "lon": -0.1276, "bearing_deg": 217.5},
            },
        ).json()["run"]

        assert run["origin"] == {
            "lat": 51.5072,
            "lon": -0.1276,
            "bearing_deg": 217.5,
        }
        assert client.get(f"/api/runs/{run['id']}").json()["origin"] == run["origin"]

    def test_a_run_without_an_entry_point_is_still_valid(self, client):
        """Nobody is forced to place the robot on a map to start driving."""
        run = client.post("/api/runs", json={"name": "a"}).json()["run"]
        assert run["origin"] is None

    @pytest.mark.parametrize(
        "origin",
        [
            {"lat": 91.0, "lon": 0.0},
            {"lat": 0.0, "lon": -181.0},
            {"lat": 0.0, "lon": 0.0, "bearing_deg": 360.0},
        ],
    )
    def test_an_impossible_entry_point_is_refused(self, client, origin):
        response = client.post("/api/runs", json={"name": "a", "origin": origin})
        assert response.status_code == 422

    def test_severity_outside_one_to_five_is_rejected(self, client):
        run = client.post("/api/runs", json={"name": "a"}).json()["run"]
        response = client.post(
            f"/api/runs/{run['id']}/defects", json={"code": "RB", "severity": 9}
        )
        assert response.status_code == 422

    def test_missing_run_is_a_404(self, client):
        assert client.get("/api/runs/nosuchrun").status_code == 404

    def test_active_run_cannot_be_deleted(self, client):
        run = client.post("/api/runs", json={"name": "a"}).json()["run"]
        assert client.delete(f"/api/runs/{run['id']}").status_code == 409

    def test_export_formats(self, client):
        run = client.post("/api/runs", json={"name": "a"}).json()["run"]
        client.post(f"/api/runs/{run['id']}/end")

        assert client.get(f"/api/runs/{run['id']}/export.json").status_code == 200
        assert client.get(f"/api/runs/{run['id']}/export.csv").status_code == 200
        assert client.get(f"/api/runs/{run['id']}/export.zip").status_code == 200
        assert client.get(f"/api/runs/{run['id']}/export.pdf").status_code == 400

    def test_snapshot_path_cannot_escape_the_run_directory(self, client):
        run = client.post("/api/runs", json={"name": "a"}).json()["run"]
        response = client.get(f"/api/runs/{run['id']}/snapshots/..%2F..%2Frun.json")
        assert response.status_code in (400, 404)


class TestMedia:
    def test_camera_reports_unavailable_rather_than_erroring(self, client):
        assert client.get("/api/camera").status_code == 503

    def test_snapshot_without_a_run_is_a_conflict(self, client):
        assert client.post("/api/snapshot").status_code == 409

    def test_tuning_is_accepted_and_echoed(self, client):
        body = client.post(
            "/api/camera/tuning", json={"brightness": 0.2, "dehaze": True}
        ).json()
        assert body["tuning"]["brightness"] == 0.2
        assert body["tuning"]["dehaze"] is True

    def test_tuning_out_of_range_is_rejected(self, client):
        assert (
            client.post("/api/camera/tuning", json={"brightness": 4.0}).status_code
            == 422
        )


class TestConsoleCaching:
    """A deploy must be visible on the next page load, not the one after.

    index.html names the hashed bundle. Served without a Cache-Control header it
    is subject to the browser's freshness heuristic, which serves the cached copy
    without asking -- the console then shows the previous deploy until something
    forces a reload.
    """

    @pytest.fixture
    def console(self, tmp_path, monkeypatch):
        dist = tmp_path / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text("<!doctype html><title>PipeOS</title>")
        (dist / "assets" / "index-abc123.js").write_text("console.log(1)")
        (dist / "favicon.svg").write_text("<svg/>")
        monkeypatch.setattr(config, "WEB_DIST", dist)
        monkeypatch.setattr(config, "DATA_DIR", tmp_path)
        with TestClient(create_app()) as client:
            yield client

    def test_index_revalidates(self, console):
        assert console.get("/").headers["cache-control"] == "no-cache"

    def test_client_side_routes_revalidate(self, console):
        assert console.get("/runs/abc123").headers["cache-control"] == "no-cache"

    def test_unhashed_files_revalidate(self, console):
        assert console.get("/favicon.svg").headers["cache-control"] == "no-cache"

    def test_hashed_assets_are_kept(self, console):
        cache_control = console.get("/assets/index-abc123.js").headers["cache-control"]
        assert "immutable" in cache_control
        assert "max-age=31536000" in cache_control
