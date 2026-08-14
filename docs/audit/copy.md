# Console copy

307 strings across 50 files.

## components/live/FinishRunPrompt.tsx

- `82` Shutting down powers the Pi off safely.
- `55` Distance
- `58` Elapsed
- `59` Defects
- `60` Snapshots
- `43` Run finished, still running
- `43` Finish this run?
- `47` The run is closed and saved. The robot is still powered on — do not flip the switch.
- `48` The run in progress
- `72` Try shutting down again
- `72` Finish & shut down

## components/live/NoRunOverlay.tsx

- `11` No run started
- `12` Create new run

## components/live/RegionDrawer.tsx

- `90` Drag a box around the defect · Esc to cancel

## components/live/runsetup/CheckRow.tsx

- `15` Pass
- `21` Warning
- `27` Failed
- `33` Not fitted

## components/live/runsetup/checks.ts

- `55` Robot link
- `93` Motors
- `105` Battery
- `122` Camera
- `130` Lights
- `139` IMU
- `147` Accelerometer
- `156` North reference
- `166` ML model
- `184` CPU temperature
- `199` Air temperature
- `216` Storage
- `19` Test failed

## components/live/runsetup/ControllerSetup.tsx

- `30` pad.throttle
- `67` Controller
- `90` Controller setup
- `19` Plug the controller in over USB and press any button on it
- `24` Push the left stick forward, or press up on the D-pad
- `29` Pull the same stick back towards you
- `34` Press the A button
- `82` Test again
- `82` Set up
- `136` None of this moves the robot. The motors stay locked until the run has started.
- `137` No controller has been detected yet.

## components/live/runsetup/ControlsSection.tsx

- `17` all shortcuts
- `6` Drive
- `11` Capture
- `16` Help

## components/live/runsetup/DetectionSettings.tsx

- `70` Detection
- `70` Run the model over the video feed for the duration of this run.
- `82` Mode
- `102` Sample
- `103` How often the model looks at the feed. Checking every frame is the most thorough, but it also works the processor hardest, so one frame in five is usually enough to keep up with the robot.
- `121` Confidence
- `122` Anything the model is less certain of than this is ignored. Lowering it will catch more genuine defects, but it will also flag more things that turn out to be nothing.
- `131` Minimum confidence
- `140` Classes
- `29` Manual
- `30` The operator will move the robot and flag defects manually.
- `34` Assisted
- `35` The robot will move, return, and flag defects on its own.

## components/live/runsetup/PreflightSection.tsx

- `150` Run again
- `41` the probes could not be run
- `91` The robot drove forward and back, so the motors are working.
- `97` the motor test could not be run
- `143` One check
- `145` one warning
- `147` one check was
- `148` Everything passed.

## components/live/runsetup/RunSetupPanel.tsx

- `98` New run
- `101` Simulated faults
- `119` Name
- `128` Created
- `188` This run cannot be started
- `108` Close
- `117` Information
- `135` Configuration
- `138` Record video
- `139` Video is saved onto the robot SD card.
- `153` Positioning
- `163` Preflight check
- `172` Controls
- `176` Safety check
- `89` Confirm the safety check at the bottom of this panel to continue.

## components/live/runsetup/SafetySection.tsx

- `34` I have checked all of the above, and assume responsibility.
- `3` The housing is intact, with no cracks or damage
- `4` The pipe and the area around it are safe to work in
- `5` The tether is secure and the robot is clear to go in
- `6` Weather and the risk of a surge have been checked
- `7` Traffic management and site access are in place

## components/live/runsetup/SurgeRisk.tsx

- `30` Surge risk
- `33` Place the entry point first
- `35` Checking
- `37` Unavailable

## components/live/runsetup/useWeather.ts

- `80` could not reach the service

## components/live/ShortcutOverlay.tsx

- `12` Shortcuts

## components/live/VideoFeed.tsx

- `188` no camera feed
- `191` Link lost — frame is not live

## components/live/ZoomControl.tsx

- `21` Zoom in
- `33` Zoom out

## components/map/EntryPointPicker.tsx

- `111` Entry point
- `122` The map could not load, but you can still type the coordinates below.
- `145` Clear
- `156` Latitude
- `161` Longitude
- `63` This browser cannot look up your location.
- `81` This browser would not share your location, so you will need to type the coordinates in below.
- `82` Your location could not be found, so you will need to type the coordinates in below.
- `113` Click the map to move the pin
- `113` Optional, click the map to place a pin

## components/map/GeoTraceMap.tsx

- `115` No map tiles — offline. The track is still drawn to scale.
- `122` estimated track · entry point placed by hand

## components/map/PathMap.tsx

- `28` no track yet — start driving
- `45` Estimated path travelled

## components/overlay/DetectionBoxes.tsx

- `48` Classified, but not localised — no box available

## components/overlay/DirectionArrow.tsx

- `50` Locked
- `58` Shift
- `61` to lock throttle

## components/overlay/TelemetryOverlay.tsx

- `17` Distance
- `26` Run
- `30` Air
- `38` Humidity

## components/panel/DefectPanel.tsx

- `107` Observation
- `131` Severity
- `152` Location on frame
- `178` Redraw box
- `185` Clear
- `195` Click here to draw box
- `202` Note
- `97` Defects
- `98` No run in progress
- `104` Log a defect
- `159` The frame this defect is filed against
- `208` Optional
- `213` GPS coordinates
- `215` Clock position
- `219` Distance from entry
- `220` Time logged
- `222` Temperature
- `225` Humidity
- `89` could not save

## components/panel/GalleryPanel.tsx

- `45` Open the full run
- `17` Camera roll
- `19` No run in progress
- `21` Nothing captured yet

## components/panel/LightsPanel.tsx

- `14` Lights
- `16` Brightness

## components/panel/ToolPalette.tsx

- `88` Lights
- `95` Image
- `101` Snapshot
- `114` Defect
- `117` Camera roll
- `105` Stop recording

## components/panel/TuningPanel.tsx

- `63` Dehaze
- `73` Reset
- `20` Image
- `23` Brightness
- `33` Contrast
- `44` Sharpness

## components/primitives/Popover.tsx

- `46` Close

## components/primitives/Readout.tsx

- `63` No sensor fitted — see docs/HARDWARE.md

## components/settings/NorthReference.tsx

- `98` Set
- `107` Clear
- `86` Robot is facing
- `91` Bearing the robot is currently facing, in degrees
- `122` North
- `18` North reference
- `28` There is no IMU fitted, so the robot has no sense of which way it is turning and a bearing cannot be anchored to anything.
- `30` The IMU has restarted, which means the reference you set earlier no longer lines up with anything. Point the robot north again and press Set.
- `32` Every heading shown is now a compass bearing, and this run will take the direction it went in from the reading above.
- `33` Point the robot north and press Set, or type in the bearing it is facing if you already know it. Without a north reference the track cannot be placed on a map.
- `44` could not set north
- `56` could not clear it
- `71` The IMU has restarted, so this needs setting again
- `74` Not set, so this run will have no map behind its track
- `81` Not set

## components/shell/BudgetStrip.tsx

- `14` Charge
- `18` Out
- `15` no sensor

## components/shell/ConnectionBanner.tsx

- `13` Motors are stopped
- `12` Link lost — reconnecting
- `12` No telemetry

## components/shell/ShutdownDialog.tsx

- `41` Shut down the robot
- `44` This will power down the Pi safely. All motors will be stopped, and any runs currently in progress will be stopped. Wait for the green LED on the Pi to stop blinking before you turn the robot off so the SD card will finish writing.
- `57` Cancel
- `60` Just disconnect
- `77` Powering off
- `78` The run is closed and everything is written to the card.
- `81` Wait for the green LED on the Pi to stop blinking, then it is safe to flip the switch.
- `85` Reload this page after the robot is powered up again.
- `64` Shutting down…
- `64` Shut down

## components/shell/SidebarNav.tsx

- `4` Live
- `5` Runs
- `6` Settings

## components/shell/StatusBar.tsx

- `47` Battery
- `56` Link
- `69` CPU temp
- `76` Free
- `83` Elapsed
- `34` No run started

## constants/defects.ts

- `6` Structural
- `10` Crack
- `11` Fracture
- `12` Broken pipe
- `13` Hole
- `14` Deformation
- `15` Joint displacement
- `16` Surface damage
- `18` Roots
- `18` Service
- `19` Deposits
- `20` Encrustation
- `21` Infiltration
- `22` Obstacle

## constants/run-state.ts

- `14` Idle
- `22` Run
- `28` Recording
- `34` Warning
- `40` Fault

## input/shortcuts.ts

- `7` Driving
- `11` Drive forward
- `12` Drive back
- `13` Lock the throttle · Shift again to release
- `15` Take a snapshot
- `15` Capture
- `17` Log a defect
- `18` Start or stop recording
- `20` Lights
- `20` View
- `21` Map
- `22` Camera roll
- `23` Zoom the image
- `24` This list
- `25` Close whatever is open

## input/useDriveInput.ts

- `163` 0 ? 'forward' : throttle

## lib/errors.ts

- `2` unknown error

## lib/format.ts

- `82` just now

## robot/client.ts

- `49` not connected
- `180` no telemetry
- `110` could not open socket
- `223` unexpected response from the robot

## robot/discovery.ts

- `65` This device
- `40` not a PipePatrol robot

## robot/RobotProvider.tsx

- `13` Promise
- `19` not connected
- `73` could not connect
- `119` useRobot must be used inside RobotProvider

## robot/useRun.ts

- `18` could not load the run

## routes/ConnectRoute.tsx

- `63` Welcome to PipeOS
- `77` Device name
- `87` Address
- `109` Disconnect current robot
- `127` No address yet
- `130` Checking…
- `143` Can’t reach this address
- `81` Basement crawler
- `91` pipepatrol.local:8000
- `92` Robot address
- `150` Enter your robot’s address to continue.

## routes/LiveRoute.tsx

- `245` Finish run
- `100` could not finish the run
- `159` could not start the run

## routes/RunDetailRoute.tsx

- `21` Loading…
- `44` VIDEO
- `60` Interrupted
- `100` Defects
- `106` Observation
- `107` Severity
- `108` Clock
- `109` Chainage
- `110` Note
- `141` Snapshots
- `20` Run
- `29` Could not load that run
- `68` Distance
- `71` Duration
- `74` Started
- `76` Video
- `102` No defects logged on this run
- `143` Nothing captured on this run
- `80` not recorded

## routes/RunsRoute.tsx

- `36` Loading…
- `42` Run
- `43` ID
- `44` Distance
- `45` Duration
- `46` Defects
- `47` Frames
- `32` Runs
- `38` No runs yet
- `19` could not load runs

## routes/SettingsRoute.tsx

- `26` Shut down
- `32` Robot
- `45` Hardware
- `63` Not fitted
- `78` Shortcuts
- `83` Storage
- `98` Console
- `102` Temperature
- `103` Display only. Readings are recorded in Celsius either way.
- `24` Settings
- `34` Host
- `35` Address
- `36` Version
- `38` Uptime
- `86` Free
- `90` Used
- `93` Camera

