/**
 * The whole footprint of temporary testing inside the app: two words.
 *
 * Type `test` as both the device name and the address on the connect screen and
 * Continue boots an in-browser simulated robot instead of looking for a real
 * one. Everything it does lives in /temptest, loaded on demand. Delete that
 * folder and the import below fails; Continue reports it and nothing else
 * changes.
 *
 * WHY NOT A KEY GESTURE. This used to be a double-tap of T, gated to
 * `import.meta.env.DEV && port === 5173`. Both halves failed quietly on anyone
 * else's laptop -- Vite picks 5174 when 5173 is busy, and the gesture then did
 * nothing at all, with no way to tell that from a broken build. A field you
 * type into is discoverable, tells you when it has not worked, and cannot be
 * silently disabled by a port number.
 *
 * `__TEMPTEST_URL__` is injected by web/vite.config.ts and points at the
 * dev-served simulator module. In a production build it is dead code the build
 * strips, so the simulator never reaches the Pi.
 */
declare const __TEMPTEST_URL__: string

interface TempTestModule {
  activate: () => void
}

/** Typed into both fields. Compared case-insensitively and trimmed. */
const TEST_WORD = 'test'

/**
 * Dev server only. Not a second gate on top of the words -- the simulator is
 * served over Vite's /@fs, so there is nothing to import in a build, and this
 * only decides whether to say so or to try the address for real.
 */
export const TEST_MODE_AVAILABLE = import.meta.env.DEV

/** Does what the operator typed ask for the simulator? */
export function wantsTestMode(name: string, address: string): boolean {
  if (!TEST_MODE_AVAILABLE) return false
  return (
    name.trim().toLowerCase() === TEST_WORD && address.trim().toLowerCase() === TEST_WORD
  )
}

/**
 * Boot the simulated robot. Resolves once it is answering, so the caller can
 * connect straight after.
 *
 * Throws with a readable reason rather than returning false: the connect screen
 * already has somewhere to put a failure, and "the temptest folder is missing"
 * is exactly the sentence somebody who just cloned the repo needs.
 */
export async function activateTestMode(): Promise<void> {
  let mod: TempTestModule
  try {
    mod = (await import(/* @vite-ignore */ __TEMPTEST_URL__)) as TempTestModule
  } catch (error) {
    // The URL goes in the message, not just the console. "It says the folder is
    // missing" is unactionable when the folder is plainly there; the path it
    // actually asked for is the thing that tells you whether the checkout is
    // short a folder or the dev server would not serve it.
    console.warn('[temptest] could not load the simulator from', __TEMPTEST_URL__, error)
    throw new Error(`Test mode could not load the simulator from ${__TEMPTEST_URL__}`, {
      cause: error,
    })
  }
  mod.activate()
}
