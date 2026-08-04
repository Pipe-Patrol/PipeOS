"""How a route reaches the robot.

Exactly one path: `request.app.state.robot`. Routers never import a global and
never construct hardware, so a test can stand up the app around a fake.
"""

from fastapi import Request


def get_robot(request: Request):
    return request.app.state.robot
