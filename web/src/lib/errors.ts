/**
 * Turning a thrown value into something an operator can act on.
 *
 * `RobotClient.request` rejects with the response body as text, and the server
 * refuses in JSON. Without this the console shows a raw `{"ok":false,...}` to
 * someone standing over an open manhole.
 */
export function readError(caught: unknown, fallback = 'unknown error'): string {
  const message = caught instanceof Error ? caught.message : fallback
  try {
    const parsed: unknown = JSON.parse(message)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return String((parsed as { error: unknown }).error)
    }
  } catch {
    // Not JSON — a network failure, or a proxy answering instead of the robot.
    // The raw message beats "something went wrong".
  }
  return message
}
