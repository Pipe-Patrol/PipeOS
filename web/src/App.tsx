import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/shell/AppShell'
import { TempTestBridge } from '@/dev/TempTestBridge'
import { ConnectRoute } from '@/routes/ConnectRoute'
import { LiveRoute } from '@/routes/LiveRoute'
import { RunDetailRoute } from '@/routes/RunDetailRoute'
import { RunsRoute } from '@/routes/RunsRoute'
import { SettingsRoute } from '@/routes/SettingsRoute'
import { ReturnHomeProvider } from '@/robot/ReturnHomeProvider'
import { RobotProvider } from '@/robot/RobotProvider'

/**
 * Real URL routing, not tab state.
 *
 * A supervisor sent a link to a specific run needs a URL that means something,
 * and an operator who reloads mid-inspection needs to land back where they
 * were. Tabs held in component state can do neither.
 *
 * RobotProvider sits above the router deliberately: navigating to the run list
 * must not drop the link to a robot forty metres into a pipe. The picker is
 * outside AppShell because it is the one screen that renders without one.
 *
 * ReturnHomeProvider sits with it, and for the same reason: the budget that
 * decides whether the robot can still get out must not reset because somebody
 * went to look at a photo. It also has to be above both the shell — which draws
 * the budget bar — and the driving screen, which draws the map and the banner,
 * so that all three are quoting one answer rather than three of their own.
 */
export default function App() {
  return (
    <RobotProvider>
      <ReturnHomeProvider>
        <BrowserRouter>
          {import.meta.env.DEV && <TempTestBridge />}
          <Routes>
            <Route path="/connect" element={<ConnectRoute />} />

            <Route element={<AppShell />}>
              <Route path="/live" element={<LiveRoute />} />
              <Route path="/runs" element={<RunsRoute />} />
              <Route path="/runs/:runId" element={<RunDetailRoute />} />
              <Route path="/settings" element={<SettingsRoute />} />
            </Route>

            {/* The picker is the front door. Anything unrecognised lands there
                rather than on a driving screen with no robot behind it. */}
            <Route path="*" element={<Navigate to="/connect" replace />} />
          </Routes>
        </BrowserRouter>
      </ReturnHomeProvider>
    </RobotProvider>
  )
}
