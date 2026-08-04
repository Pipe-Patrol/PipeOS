"""PipeOS control server.

Layers, outermost first:

    api/          HTTP and WebSocket. Knows about the robot, not about GPIO.
    robot.py      Owns every subsystem and the two loops that drive them.
    estimation/   Numbers derived from other numbers. All of it labelled.
    perception/   Where a defect model plugs in. No model ships yet.
    runs/         Recording and storage, on the Pi.
    hardware/     Motors, camera, IMU, lights, host vitals.

The direction of dependency is one-way down that list. hardware/ imports
nothing above it, which is what lets the safety tests run on a laptop.
"""

__version__ = "1.0.0"
