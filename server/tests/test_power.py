"""The shutdown endpoint.

Two properties matter more than the rest, and both are about not lying to an
operator who is about to touch the power switch:

  * a refusal must leave the robot completely untouched, so nothing is lost by
    the button not working
  * nothing may be reported as a successful shutdown unless a halt was actually
    scheduled

Nothing in here ever runs a real poweroff. The command is resolved through
`power.poweroff_command` and scheduled through `power._spawn_poweroff`, and both
are patched out.
"""

import pytest
from fastapi.testclient import TestClient

from pipepatrol import config
from pipepatrol.api import power
from pipepatrol.app import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def scheduled(monkeypatch):
    """Records the halt instead of scheduling it."""
    calls = []
    monkeypatch.setattr(power, "_schedule_poweroff", calls.append)
    return calls


@pytest.fixture
def permitted(monkeypatch):
    monkeypatch.setattr(power, "poweroff_command", lambda: ("true",))


@pytest.fixture
def forbidden(monkeypatch):
    monkeypatch.setattr(power, "poweroff_command", lambda: None)


class TestRefusal:
    def test_says_so_rather_than_failing_silently(self, client, forbidden):
        response = client.post("/api/shutdown")
        assert response.status_code == 503
        assert response.json()["ok"] is False

    def test_explains_how_to_fix_it(self, client, forbidden):
        assert "deploy.sh" in client.post("/api/shutdown").json()["error"]

    def test_leaves_the_robot_driveable(self, client, forbidden):
        client.post("/api/shutdown")
        # A refused shutdown must cost the operator nothing. If close() had run,
        # the robot would be a brick with a live network stack.
        assert app.state.robot._closed is False
        assert client.get("/api/telemetry").status_code == 200


class TestHalt:
    def test_reports_success_only_with_a_halt_scheduled(
        self, client, permitted, scheduled
    ):
        body = client.post("/api/shutdown").json()
        assert body["ok"] is True
        assert scheduled == [("true",)]

    def test_releases_the_hardware_before_powering_off(
        self, client, permitted, scheduled
    ):
        client.post("/api/shutdown")
        assert app.state.robot._closed is True

    def test_stops_the_motors(self, client, permitted, scheduled):
        client.post("/api/shutdown")
        assert app.state.robot.drive.status()["moving"] is False

    def test_closes_the_active_run_instead_of_orphaning_it(
        self, client, permitted, scheduled
    ):
        run = client.post("/api/runs", json={"name": "shutdown test"}).json()["run"]
        client.post("/api/shutdown")

        # The whole point of the button: a run ended this way is finished, where
        # a run ended by the power switch was always marked interrupted.
        stored = app.state.robot.store.get(run["id"])
        assert stored.ended_at is not None
        assert stored.interrupted is False


class TestCommandResolution:
    def test_no_sudo_and_no_systemctl_means_no_shutdown(self, monkeypatch):
        monkeypatch.setattr(power.shutil, "which", lambda _name: None)
        assert power.poweroff_command() is None

    def test_never_returns_a_command_the_probe_rejected(self, monkeypatch):
        monkeypatch.setattr(power.shutil, "which", lambda name: f"/usr/bin/{name}")
        monkeypatch.setattr(power, "_succeeds", lambda _command: False)
        assert power.poweroff_command() is None

    def test_prefers_sudo_when_the_rule_is_installed(self, monkeypatch):
        monkeypatch.setattr(power.shutil, "which", lambda name: f"/sbin/{name}")
        monkeypatch.setattr(power, "_succeeds", lambda command: command[0] == "sudo")
        assert power.poweroff_command() == ("sudo", "-n", "/sbin/poweroff")

    def test_probes_without_halting_anything(self, monkeypatch):
        """`sudo -n -l CMD` asks whether CMD is allowed; it does not run it."""
        seen = []
        monkeypatch.setattr(power.shutil, "which", lambda name: f"/sbin/{name}")
        monkeypatch.setattr(
            power, "_succeeds", lambda command: seen.append(command) or False
        )
        power.poweroff_command()
        assert seen  # the probe ran at all
        for command in seen:
            assert command[:3] == ("sudo", "-n", "-l") or "--dry-run" in command
