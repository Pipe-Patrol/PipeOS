"""Getting a run out of the robot.

Three formats, no PDF. A PDF report wants standards-compliant defect coding
(PACP, MSCC) and that only becomes possible once a model is producing codes --
until then it would be a nicely typeset guess. JSON and CSV carry everything
that is actually known, including the uncertainty on every chainage, which a
report template would quietly drop.
"""

import csv
import io
import json
import zipfile

DEFECT_COLUMNS = [
    "id",
    "at",
    "code",
    "severity",
    "clock_position",
    "chainage_m",
    "chainage_uncertainty_m",
    "note",
    "snapshot_id",
    "detection_id",
]


def to_json(run):
    return json.dumps(run.as_dict(), indent=2).encode()


def to_csv(run):
    """Defects, one per row.

    Chainage carries its uncertainty in the next column deliberately: a bare
    distance in a spreadsheet reads as surveyed, and this one is not.
    """
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=DEFECT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for defect in run.defects:
        writer.writerow(defect.as_dict())
    return buffer.getvalue().encode()


def to_zip(run, store):
    """Everything: metadata, defects, and every snapshot image."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("run.json", to_json(run))
        archive.writestr("defects.csv", to_csv(run))
        for snapshot in run.snapshots:
            path = store.snapshot_path(run.id, snapshot.file)
            if path.is_file():
                archive.write(path, f"snapshots/{snapshot.file}")
    buffer.seek(0)
    return buffer.read()


def filename_for(run, extension):
    """A filename that sorts by date and survives a filesystem."""
    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in run.name).strip()
    safe = safe.replace(" ", "-") or run.id
    return f"{safe}.{extension}"
