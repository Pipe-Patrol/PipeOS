"""The defect model, running on a machine that is not the robot.

WHY. A Pi 5 running RF-DETR is seconds per frame with three of its four cores
saturated, and it gets hot doing it -- hot enough that a long inspection is a
thermal problem before it is an accuracy one. The graph is 121 MB and
onnxruntime's aarch64 wheel is tens more, all of it on an SD card. So the model
does not live here any more: the robot posts the JPEG it already encoded for the
video stream to a laptop, and the laptop answers with boxes.

WHAT IT COSTS THE PI. One HTTP POST of a frame that was encoded anyway. No
tensor work, no ONNX runtime, no model file. That is the whole point.

THE PROTOCOL IS THE ROBOT'S OWN. The laptop serves the same `POST /api/detect`
the robot serves for demo day -- raw JPEG in, `{"ok": true, "detections": [...]}`
out. One shape to understand, and `server/detect-host.py` is a thin wrapper
around the same RfDetrDetector that used to run here.

AVAILABLE MEANS CONFIGURED, NOT REACHABLE. DetectionService only starts its
sampling loop for an available backend, so a laptop that is asleep at boot must
not latch detection off for the rest of the run. A configured host is available;
whether it answered last time is reported through `error`, which the console
shows. Come back in range and detections resume on their own.
"""

import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from pipepatrol.perception.detector import Detection

log = logging.getLogger(__name__)

# Generous. A laptop is fast, but the first inference after it wakes pays for
# page faults and a cold graph, and a timeout there would read as a broken host
# rather than a slow one.
DEFAULT_TIMEOUT_S = 15.0

# Not 8000. The laptop running this is usually also running the console's dev
# server and, on demo day, a full local robot server on 8000.
DEFAULT_PORT = 8600


def normalise_url(url):
    """`10.0.0.4`, `10.0.0.4:8600`, `http://10.0.0.4:8600` all mean the same.

    Operators type a host into a settings field, not a URL. Accepting only the
    fully-qualified form turns a working address into a silent no-detections.
    """
    url = (url or "").strip().rstrip("/")
    if not url:
        return ""
    if "://" not in url:
        url = f"http://{url}"
    parsed = urllib.parse.urlsplit(url)
    if parsed.port is None:
        url = urllib.parse.urlunsplit(
            parsed._replace(netloc=f"{parsed.hostname}:{DEFAULT_PORT}")
        )
    return url.rstrip("/")


class RemoteDetector:
    """Posts frames to a detection host and turns its answer into Detections.

    Same contract as RfDetrDetector -- `name`, `available`, `error`,
    `infer(jpeg, min_confidence=None)` -- so DetectionService, the run recorder,
    the map flags and the console cannot tell which one is behind them.
    """

    name = "remote"

    def __init__(self, url, timeout=DEFAULT_TIMEOUT_S):
        self.url = normalise_url(url)
        self.timeout = timeout
        self.available = bool(self.url)
        self.error = None if self.url else "no detection host configured"
        if self.url:
            log.info("defect model: remote at %s", self.url)

    def infer(self, jpeg, min_confidence=None):
        if not self.available:
            return []

        endpoint = f"{self.url}/api/detect"
        if min_confidence is not None:
            endpoint = f"{endpoint}?min={float(min_confidence)}"

        request = urllib.request.Request(
            endpoint,
            data=jpeg,
            headers={"Content-Type": "image/jpeg"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            # The host is there and refused. Its own message is more useful than
            # the status code -- it is the one that knows about the model.
            body = _short_body(exc)
            self.error = f"detection host {self.url}: HTTP {exc.code} {body}".strip()
            log.warning("%s", self.error)
            return []
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.error = f"cannot reach detection host {self.url}: {exc}"
            log.warning("%s", self.error)
            return []
        except json.JSONDecodeError as exc:
            self.error = f"detection host {self.url} sent malformed JSON: {exc}"
            log.warning("%s", self.error)
            return []

        self.error = None
        return _parse(payload)

    def models(self):
        """The host's catalogue, or None if it cannot be asked.

        The console's model buttons are drawn from this. It goes through the
        robot rather than the console talking to the host directly, so there
        stays exactly one address an operator has to know -- the robot's.
        """
        return self._json("GET", "/api/models")

    def select_model(self, model_id):
        """Tell the host to load a different model. Returns its answer, or None."""
        return self._json("POST", "/api/model", json.dumps({"id": model_id}).encode())

    def _json(self, method, path, body=None):
        if not self.available:
            return None

        request = urllib.request.Request(
            f"{self.url}{path}",
            data=body,
            headers={"Content-Type": "application/json"} if body else {},
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            # A refusal carries the reason -- "no checkpoint at ..." -- and that
            # is the useful half, so it is parsed rather than discarded.
            try:
                return json.loads(exc.read())
            except Exception:  # noqa: BLE001 - diagnostics must not raise
                self.error = f"detection host {self.url}: HTTP {exc.code}"
                return None
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            self.error = f"cannot reach detection host {self.url}: {exc}"
            log.warning("%s", self.error)
            return None

    def status(self):
        return {
            "backend": self.name,
            "available": self.available,
            "error": self.error,
            "host": self.url,
        }


def _parse(payload):
    """Detections out of a response, skipping anything malformed.

    Lenient on purpose. A host one version ahead may send fields this does not
    know, and a single unparseable entry must not discard the rest of the frame.
    """
    if not isinstance(payload, dict):
        return []

    found = []
    for entry in payload.get("detections") or []:
        try:
            label = entry["label"]
            confidence = float(entry["confidence"])
        except (TypeError, KeyError, ValueError):
            continue
        if not label:
            continue

        box = entry.get("box")
        if box is not None:
            try:
                box = [float(v) for v in box]
            except (TypeError, ValueError):
                box = None
            if box is not None and len(box) != 4:
                box = None

        # The timestamp is deliberately not taken from the response. It is the
        # moment the *robot* saw the frame that decides when a detection ages
        # off the overlay, and the two machines' clocks need not agree.
        found.append(Detection(label=label, confidence=confidence, box=box))

    return found


def _short_body(exc):
    try:
        body = exc.read().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001 - diagnostics must not raise
        return ""
    return body[:200]
