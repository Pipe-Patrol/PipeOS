# PipeOS

![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Raspberry Pi](https://img.shields.io/badge/Raspberry_Pi-A22846?style=flat-square&logo=raspberrypi&logoColor=white)

### **UMD Cyber-Physical Systems Engineering, Jumpstart Summer Program 2026**

The OS (operator console and control server) for the PipePatrol pipe inspection
robot by team PipePatrol.

### Features

- **Live video** — low-latency MJPEG feed from the robot's camera.
- **Real-time telemetry** — orientation, motion, temperature, humidity.
- **Defect detection** — on-board ML flags cracks, roots, and other defects.
- **Map and flags** — robot path on a map with auto RTH and defect flagging.
- **Runs & reports** — snapshots, defect logs, and video recorded to the Pi.
- **Driving** — keyboard or gamepad.

## 1. Get the code

```bash
gh repo clone Pipe-Patrol/PipeOS
cd PipeOS
```

## 2. Install it on the robot

Builds the console and sets everything up on the Pi over ssh.

```bash
./deploy.sh pipepatrol@pipepatrol.local
```

Name not resolving? Use the Pi's IP instead:

```bash
./deploy.sh pipepatrol@10.83.0.112
```

Run this once to set the Pi up, and again whenever the code changes. It needs
ssh access to the Pi and the Pi's apt packages — see
[docs/HARDWARE.md](docs/HARDWARE.md).

## 3. Drive the robot

Open this on any device on the same network — laptop, phone, iPad:

```
http://pipepatrol.local:8000
```

Confirm the robot, press **Continue**, and you are in.

---


### Get new changes onto the robot

```bash
cd ~/PipeOS
git pull
./deploy.sh pipepatrol@pipepatrol.local
```

### Work on the console (on your computer, no Pi needed)

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

### Tests

```bash
cd server && .venv/bin/python -m pytest    # safety, watchdog, odometry, camera
cd web && npm run check                    # typecheck, lint, unit tests
```

Run them before you power the motors.

### Troubleshooting

```bash
ping pipepatrol.local                                               # is the Pi on the network?
ssh pipepatrol@pipepatrol.local                                     # can you reach the Pi at all?
./deploy.sh pipepatrol@10.83.0.112                                  # name won't resolve? deploy by IP
ssh pipepatrol@pipepatrol.local hostname -I                         # what is the Pi's IP right now?
ssh pipepatrol@pipepatrol.local 'systemctl status pipepatrol'       # is the server running?
ssh pipepatrol@pipepatrol.local 'sudo systemctl restart pipepatrol' # bounce the server
ssh pipepatrol@pipepatrol.local 'journalctl -u pipepatrol -f'       # watch the logs live
```
```bash
ssh pipepatrol@pipepatrol.local 'journalctl -u pipepatrol -b | grep -i camera'
curl -s http://pipepatrol.local:8000/api/telemetry | python3 -m json.tool | grep -A8 '"camera"'
```

### Project structure

```
PipeOS/
├── server/                  FastAPI control server (runs on the Pi)
│   ├── pipepatrol/
│   │   ├── api/             REST + WebSocket endpoints
│   │   ├── estimation/      odometry, optical flow, obstacle estimates
│   │   ├── hardware/        drive, camera, IMU, lights, host stats
│   │   ├── perception/      defect detector
│   │   ├── runs/            run storage, recording, export
│   │   ├── app.py           app wiring + CORS
│   │   ├── config.py        every environment knob
│   │   ├── robot.py         owns all subsystems + the control loops
│   │   └── telemetry.py     the telemetry envelope
│   ├── tests/               safety, odometry, hazards, runs, api, camera
│   └── deploy/              systemd unit
├── web/                     React + TypeScript operator console
│   └── src/
│       ├── components/      live overlay, map, panels, shell, primitives
│       ├── constants/       defect types, run-state presentation
│       ├── input/           keyboard + gamepad driving
│       ├── lib/             formatting, local save, small hooks
│       ├── robot/           client, discovery, provider, types
│       ├── routes/          connect, live, runs, settings
│       └── App.tsx
├── docs/                    HARDWARE.md, DECISIONS.md
├── deploy.sh                one-command Pi deploy
└── README.md
```

### Safety Disclaimer

Use this code at your own risk. There are built-in safety features, but assume
all of them can fail. Please supervise every run. Further information and details
can be found in [docs/DECISIONS.md](docs/DECISIONS.md).

### Team

Andrew Zhao · Newton Yang · Arav Assija · Leah Wang

### License

[MIT](LICENSE) © 2026 Andrew Zhao, Newton Yang, Arav Assija, Leah Wang.

PipeOS's own code is MIT-licensed. Sewer-ML and any third-party datasets or
model weights remain under their respective licenses.

### Acknowledgments

Built for the **University of Maryland** Cyber-Physical Systems Engineering
2026 Jumpstart Summer Program. Thanks to UMD for the program, the mentorship,
and the lab.

Defect detection draws on **Sewer-ML**, the multi-label sewer defect
classification dataset and benchmark by Joakim Bruslund Haurum and Thomas B.
Moeslund of the Visual Analysis and Perception (VAP) Laboratory at Aalborg
University (CVPR 2021). Credit and thanks to the Sewer-ML team.

- Project page: <https://vap.aau.dk/sewer-ml/>
- Paper: <https://arxiv.org/abs/2103.10895>
