"""Direct hardware access. Nothing in here knows the web layer exists.

Every module tolerates its device being absent: a missing camera, a wedged I2C
bus, or unavailable GPIO all degrade to a reported state rather than an
exception. The server must stay up and stay stoppable no matter what is unplugged.
"""

from pipepatrol.hardware import host
from pipepatrol.hardware.camera import Camera
from pipepatrol.hardware.climate import Climate
from pipepatrol.hardware.drive import Drive
from pipepatrol.hardware.imu import IMU
from pipepatrol.hardware.lights import Lights

__all__ = ["Camera", "Climate", "Drive", "IMU", "Lights", "host"]
