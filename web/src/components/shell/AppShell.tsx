import { Navigate, Outlet } from 'react-router-dom'

import { BudgetStrip } from '@/components/shell/BudgetStrip'
import { ConnectionBanner } from '@/components/shell/ConnectionBanner'
import { Connecting } from '@/components/shell/Connecting'
import { SidebarNav } from '@/components/shell/SidebarNav'
import { StatusBar } from '@/components/shell/StatusBar'
import { useRobot } from '@/robot/RobotProvider'

/**
 * The persistent frame every route renders inside.
 *
 * Ordering here is a safety decision, not a layout preference. The banner sits
 * above the status bar so that a lost link is the topmost thing on screen, and
 * the budget strip sits directly under the status bar so charge and distance
 * out are read in the same glance as run state. Everything an operator needs to
 * decide "keep going or turn around" lives in the top 120 px and never scrolls
 * away.
 *
 * The connection guard lives here rather than in each route, so there is one
 * place that decides whether there is a robot to render at all.
 */
export function AppShell() {
  const { client, telemetry, connecting } = useRobot()

  if (!client) {
    // Only fall through to the picker once an attempt has finished failing.
    // Bouncing while one is in flight is what made connecting look broken.
    return connecting ? <Connecting /> : <Navigate to="/connect" replace />
  }

  return (
    <div className="flex h-full">
      <SidebarNav />

      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <StatusBar />
        {telemetry && <BudgetStrip power={telemetry.power} motion={telemetry.motion} />}

        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
