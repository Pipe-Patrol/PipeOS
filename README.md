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

- **Live video**: low-latency MJPEG feed from the robot's camera.
- **Real-time telemetry**: orientation, motion, temperature, humidity.
- **Defect detection**: on-board ML flags cracks, roots, and other defects.
- **Map and flags**: robot path on a map with auto RTH and defect flagging.
- **Runs & reports**: snapshots, defect logs, and video recorded to the Pi.
- **Driving**: keyboard or gamepad.

## 1. Get the code

Install [Git](https://git-scm.com/install/windows) and [Github CLI](https://cli.github.com/) if you have not yet, and authenticate with ```gh auth login```.

```bash
gh repo clone Pipe-Patrol/PipeOS
```

## 2. Install it on the robot

Builds the console and sets everything up on the Pi over ssh.
Wait at least 20 seconds after turning on the rover before running the deploy command below.

The password for the Raspberry Pi is ```pipe```.

```bash
cd PipeOS
./deploy.sh pipepatrol@pipepatrol.local
```

Name not resolving? Use the Pi's IP instead:

```bash
./deploy.sh pipepatrol@10.83.0.112
```

Run this once to set the Pi up, and again whenever the code changes. It needs
ssh access to the Pi and the Pi's apt packages: see
[docs/HARDWARE.md](docs/HARDWARE.md).

### The defect model

**The model does not run on the Pi.** It ran there once and cost seconds per
frame with the cores pinned and the board overheating, so it now runs on your
computer: the robot posts camera frames over the network and gets boxes back.
The deploy actively keeps it off the Pi — it deletes any graph a previous deploy
left behind and uninstalls `onnxruntime` from the robot's venv.

Once per trained checkpoint, export it (this needs PyTorch, which running the
model does not):

```bash
python3 -m venv /tmp/export
/tmp/export/bin/pip install rfdetr onnx onnxruntime
/tmp/export/bin/python server/deploy/export-model.py ~/Downloads/checkpoint_best_total.pth
```

Then, on your computer, install what serves it and start it:

```bash
cd server
.venv/bin/pip install -r requirements-detect.txt
.venv/bin/python detect-host.py
```

Leave that running whenever you want detection. `./deploy.sh` works out this
machine's address and points the robot at it, then checks **from the Pi** that
it can actually be reached — so a laptop on the wrong network is caught during
the deploy rather than mid-inspection. Change the address later without
redeploying in **Settings → Detection host**.

**Two models, one button.** `rfdetr-onnx` is the exported graph — quick, no
torch, and the one that has been down a pipe. `rfdetr-torch` is the newer
checkpoint under torch, with an optional clean-pipe bank that flags conditions
outside the seven classes as `UNKNOWN`; it is not QC'd yet. Switch between them
in **Settings → Detection host → Model**. Installing one is copying its `.pth`
into `server/model/` — no restart, no redeploy — and the button switches your
laptop, not the robot.

Without a reachable host the robot still drives, records and logs defects by
hand; it just detects nothing. See [MODEL.md](MODEL.md) for the class list and
the details.

### If coming from a newly flashed SD card

If you just reflashed your microSD card, complete the setup steps below before continuing; otherwise, skip directly to step 3. Make sure you have ran the deploy command first.

First, ssh into the Raspberry Pi in a new terminal using ```ssh pipepatrol@pipepatrol.local```.

Turning on the **camera**:
```
sudo apt install -y python3-opencv
sudo systemctl restart pipepatrol
```

Turning on the **IMU and cliamte**:
```
sudo apt install -y python3-opencv
sudo raspi-config nonint do_i2c 0
```

If you want to stop entering the password multiple times during deployment, open a new terminal, and run ```ssh-copy-id pipepatrol@pipepatrol.local```.

Once finished, open a new terminal, and repeat the first code block in this step (Step 2).


## 3. Drive the robot

Open this on any device on the same network: laptop, phone, iPad:

```
http://pipepatrol.local:8000
```

Confirm the robot, press **Continue**, and you are in.

**IMPORTANT**: When finished, always shut down the Pi in the GUI (settings > shutdown) or terminal before turning the robot off. Otherwise, the SD card will become corrupted, and reflashing will be required on the next start.

This is a prototype's rule, and it is optional — see below.

---

## 4. Optional: make it an appliance

One command turns the robot into something you power on, join, and use — no
SSH, no shutdown ritual, and it survives having its plug pulled. Fit a USB
stick first; that is where recordings go.

```bash
./deploy.sh --appliance
```

Then: switch on, join the `PipePatrol` network, and the console opens by
itself. Switch off when you are done. Deploying afterwards is still just
`./deploy.sh` — it takes the card lock off and puts it back for you.

See **[docs/APPLIANCE.md](docs/APPLIANCE.md)**.

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

Press **T twice** on any screen to boot a simulated robot in the browser — four
seeded runs, working telemetry, no hardware. Press **T then E** to step through
every error message, and **T then C** / **T then M** to inject an air spike or a
detection.

### Run the model on your computer

The simulator fakes telemetry but not the model. To see real detections without
a Pi, run the actual server locally — your machine is where the model runs
anyway, so this is the same graph the robot would be getting answers from:

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements-detect.txt
.venv/bin/python -m pipepatrol        # http://localhost:8000
```

Then open the console at `http://localhost:5173`, and enter `localhost:8000` as
the robot address. Press **D twice** for demo day mode, load a pipe video or
some stills, and the frames go to your machine's copy of the model.

Your laptop has no camera on a pipe and no motors, so the live feed and driving
are unavailable — this is for exercising the model and the detection UI.

To serve the model *to a robot* rather than exercise it locally, run
`detect-host.py` instead — same model, none of the robot subsystems, port 8600.

### Tests

```bash
cd server && .venv/bin/python -m pytest    # safety, watchdog, odometry, camera
cd web && npm run check                    # typecheck, lint, unit tests
```

Run them before you power the motors.

### Troubleshooting

If the robot has been working previously, but cannot connect anymore after rebooting or turning the switch on, it is probably since it was not shut down properly. In this case, you will have to reflash the SD card (RPi5, 64-bit, pipepatrol, USG-Mobility).

```bash
ping pipepatrol.local                                               # is the Pi on the network?
ssh pipepatrol@pipepatrol.local                                     # can you reach the Pi at all?
./deploy.sh pipepatrol@10.83.0.112                                  # name won't resolve? deploy by IP
ssh pipepatrol@pipepatrol.local hostname -I                         # what is the Pi's IP right now?
ssh pipepatrol@pipepatrol.local 'systemctl status pipepatrol'       # is the server running?
ssh pipepatrol@pipepatrol.local 'sudo systemctl restart pipepatrol' # bounce the server
ssh pipepatrol@pipepatrol.local 'journalctl -u pipepatrol -f'       # watch the logs live
journalctl -u pipepatrol | grep -i "DISABLED\|unavailable        
```
No detections? The model is on your computer, so check that end first:

```bash
curl -s localhost:8600/api/health                                   # is detect-host.py running?
curl -s http://pipepatrol.local:8000/api/detector-host              # what is the robot pointed at, and does it work?
ssh pipepatrol@pipepatrol.local 'curl -s http://<your-ip>:8600/api/health'   # can the robot reach you?
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
│   │   ├── perception/      defect detection: local model, and the remote client
│   │   ├── runs/            run storage, recording, export
│   │   ├── app.py           app wiring + CORS
│   │   ├── config.py        every environment knob
│   │   ├── robot.py         owns all subsystems + the control loops
│   │   └── telemetry.py     the telemetry envelope
│   ├── tests/               safety, odometry, hazards, runs, api, camera
│   ├── deploy/              systemd unit
│   └── detect-host.py       serves the model from your computer, for the robot
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
can be found in the preflight check.

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
