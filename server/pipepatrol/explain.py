"""Findings, in words an engineer can argue with.

A rule fires and says "possible soil infiltration at 34.2 m, confidence 0.61".
That is a number, not a finding. Someone still has to work out what it means
and what to do about it. This writes that out, with the evidence it rests on,
so the reasoning can be disagreed with rather than merely distrusted.

WHAT IT NEVER SEES. Not the frame. Not the camera. Only values the system
already computed: which rule fired, at what chainage, and the label, confidence
and clock position of every observation supporting it. That is the whole
safeguard. A writer with no access to the image cannot invent a condition that
is not in the table it was handed.

TEMPLATE FIRST, ALWAYS. The template runs every time and needs no network. If a
model is configured and reachable, its wording replaces the template; if it is
not, or the request fails, the report is still complete. A console on a robot
down a pipe cannot depend on the venue wifi, and a demo that shows nothing
because a request timed out is worse than one that shows plainer prose.
"""

import json
import logging
import os

log = logging.getLogger(__name__)

# Set to enable the model path. Absent, everything falls back to templates and
# nothing else changes.
API_KEY_ENV = "PIPEPATROL_ANTHROPIC_KEY"
MODEL = os.environ.get("PIPEPATROL_EXPLAIN_MODEL", "claude-sonnet-5")

# A pass with many findings would otherwise mean many sequential requests.
MAX_MODEL_CALLS = 8


# --------------------------------------------------------------------------
# Reference the writer is given, so its wording stays anchored
# --------------------------------------------------------------------------

LABEL_MEANING = {
    "CR": "Crack. A fracture in the pipe wall with no material displaced. "
          "Structural, and a path for water in or out.",
    "FR": "Fracture. A crack with visible movement of the pipe material.",
    "BR": "Broken pipe. Wall material displaced or missing.",
    "HO": "Hole. An opening through the full wall thickness.",
    "DEF": "Deformation. The bore is no longer its original shape, which "
           "usually means load from outside.",
    "JD": "Joint displacement. Adjacent sections no longer aligned, leaving a "
          "gap in the wall at the joint.",
    "SD": "Surface damage. The inner wall has degraded, exposing aggregate or "
          "reinforcement.",
    "RO": "Roots. Vegetation entering through a joint or fracture, seeking "
          "moisture. Accounts for soil-like material at the same location.",
    "DE": "Deposits. Settled material resting in the invert. Can be sediment "
          "washed in from outside, or debris carried by flow.",
    "EN": "Encrustation. Mineral or corrosion product built up on the wall.",
    "IN": "Infiltration. Water entering through the pipe wall.",
    "OB": "Obstacle. Foreign material or an object restricting the bore.",
    "UNKNOWN": "A condition the detector has no class for. It was flagged as "
               "unlike healthy pipe, but cannot be characterised.",
}

ACTIONS = {
    "possible soil infiltration, external void":
        "Excavation candidate. Confirm the ground condition above the pipe "
        "before scheduling a liner, since a void would have to be filled "
        "first.",
    "active ingress through a wall breach":
        "Prioritise. Water moving through the wall is an active path, not a "
        "static defect, and it carries fines out of the surrounding ground.",
    "localized damage cluster":
        "Inspect this length directly. Several conditions in one short stretch "
        "points at a single local cause worth identifying.",
    "possible ground movement":
        "Check for surface activity above this point, such as recent "
        "excavation, heavy loading, or settlement.",
    "unrecognised condition adjacent to a known defect":
        "Human review required. The detector has no class for this and cannot "
        "characterise it.",
}

SYSTEM = (
    "You write pipe inspection assessments. You are given structured findings "
    "from an automated inspection. Use ONLY the values provided. Never invent a "
    "condition, measurement, or observation that is not in the input. Do not "
    "name or speculate about any defect type that does not appear in the "
    "supporting observations; if the evidence does not identify a mechanism, "
    "say the mechanism is undetermined. Where the evidence supports an "
    "inference about conditions outside the pipe, say it is a possible cause "
    "requiring confirmation, never a confirmed finding. Do not use em dashes. "
    "Reply with JSON only, no code fences, using exactly these keys: "
    "finding, evidence, assessment, recommended_action, confidence_note."
)


# --------------------------------------------------------------------------

def _evidence_line(observation):
    label = observation.get("label") or "UNKNOWN"
    parts = [f"{label} at {observation['chainage_m']:.1f} m"]
    if observation.get("clock_position"):
        parts.append(f"{int(observation['clock_position'])} o'clock")
    parts.append(f"{observation['confidence']:.0%} confidence")
    return ", ".join(parts)


def from_template(finding):
    """The floor. No network, no key, no failure mode."""
    evidence = finding["evidence"]
    rule = finding["rule"].split(" (")[0]
    qualifier = finding["rule"][len(rule):].strip(" ()")

    note = (f"Rule confidence {finding['confidence']:.0%}, from "
            f"{len(evidence)} supporting observation"
            f"{'s' if len(evidence) != 1 else ''}.")
    if qualifier:
        note += f" {qualifier.capitalize()}."
    note += (" This is an inference from what the camera can see inside the "
             "pipe, not a confirmed condition outside it.")

    return {
        "finding": f"{rule.capitalize()} at {finding['chainage_m']:.1f} m.",
        "evidence": "; ".join(_evidence_line(o) for o in evidence) + ".",
        "assessment": finding.get("mechanism", ""),
        "recommended_action": ACTIONS.get(rule, "Flag for human review."),
        "confidence_note": note,
        "source": "template",
    }


def build_prompt(finding):
    """Everything the writer is allowed to know, and nothing else."""
    lines = [
        f"RULE FIRED: {finding['rule']}",
        f"LOCATION: {finding['chainage_m']:.1f} m along the pipe",
        f"RULE CONFIDENCE: {finding['confidence']}",
        "",
        "WHAT THIS RULE MEANS:",
        finding.get("mechanism", "No context on file."),
        "",
        "SUPPORTING OBSERVATIONS:",
    ]
    seen = set()
    for o in finding["evidence"]:
        label = o.get("label") or "UNKNOWN"
        seen.add(label)
        lines.append("  - " + _evidence_line(o))

    lines += ["", "WHAT THOSE LABELS MEAN:"]
    for label in sorted(seen):
        lines.append(f"  - {label}: {LABEL_MEANING.get(label, 'no definition on file')}")

    lines += ["", "Write the assessment. Keep each field to one or two sentences."]
    return "\n".join(lines)


def _call_model(prompt):
    """Swap this for a different provider and nothing else changes."""
    from anthropic import Anthropic

    client = Anthropic(api_key=os.environ[API_KEY_ENV])
    message = client.messages.create(
        model=MODEL,
        max_tokens=600,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    text = message.content[0].text.strip()
    text = text.replace("```json", "").replace("```", "").strip()
    return json.loads(text)


def explain(findings, use_model=True):
    """Write up whatever fired.

    Nothing here is tied to a particular pass. A combination that has never
    occurred before is described the same way as a familiar one, which matters
    when the conditions in the pipe are whatever someone put there.
    """
    enabled = use_model and os.environ.get(API_KEY_ENV)
    written = []

    for index, finding in enumerate(findings):
        result = from_template(finding)

        if enabled and index < MAX_MODEL_CALLS:
            try:
                better = _call_model(build_prompt(finding))
                better["source"] = "model"
                result = better
            except Exception as exc:  # noqa: BLE001 - a writer fault is not a run fault
                log.warning("explanation fell back to template: %s", exc)

        written.append({
            "rule": finding["rule"],
            "chainage_m": finding["chainage_m"],
            "confidence": finding["confidence"],
            **result,
        })

    return written
