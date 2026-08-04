"""Numbers the robot does not measure, derived from ones it does.

Everything produced here is an estimate. The telemetry envelope labels it as
such and the console renders it differently from a sensor reading. See
docs/DECISIONS.md for why each estimator was built the way it was.
"""

from pipepatrol.estimation.flow import OpticalFlow
from pipepatrol.estimation.obstacle import Hazards
from pipepatrol.estimation.odometry import Odometry

__all__ = ["Hazards", "OpticalFlow", "Odometry"]
