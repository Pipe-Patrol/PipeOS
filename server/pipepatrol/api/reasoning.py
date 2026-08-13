"""Findings across a pass, and the write-up of them.

Separate from `runs` because it answers a different question. `runs` reports
what was recorded; this reports what the recording implies, which is a claim
rather than an observation and deserves its own surface.

`GET /api/reasoning/findings` reads whatever the detector has logged for the
current pass. It is deliberately not live-per-frame: a rule compares conditions
at different chainages and cannot say anything until the pass has them all, so
the console should call this when the run ends rather than polling it.

Explanations cost a request each when a writer is configured, so they are off
unless asked for. Without a key the endpoint still answers, using the template
path, and the console cannot tell the difference structurally.
"""

from fastapi import APIRouter, Depends, Query

from pipepatrol import explain as explain_module
from pipepatrol import reasoning
from pipepatrol.api.deps import get_robot

router = APIRouter(prefix="/api/reasoning")


@router.get("/findings")
async def get_findings(
    robot=Depends(get_robot),
    explain: bool = Query(False, description="write each finding up in prose"),
):
    observations = robot.detections.observations()
    result = reasoning.analyse(observations)

    if explain and result["findings"]:
        result["written"] = explain_module.explain(result["findings"])

    return result


@router.get("/observations")
async def get_observations(robot=Depends(get_robot)):
    """The raw log the findings were drawn from.

    Every detection of the pass, not the six-second overlay window. The console
    shows this as the run's observation table, and it is also what makes a
    finding checkable: each one names the observations behind it, and they are
    all in here.
    """
    observations = robot.detections.observations()
    condensed = reasoning.condense(observations)
    return {
        "observations": [o.as_dict() for o in observations],
        "distinct": [o.as_dict() for o in condensed],
    }


@router.post("/reset")
async def reset_observations(robot=Depends(get_robot)):
    """Start a fresh pass. The overlay is untouched; only the log clears."""
    robot.detections.clear_observations()
    return {"cleared": True}
