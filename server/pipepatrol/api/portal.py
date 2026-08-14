"""What a phone or laptop sees the instant it joins the robot's WiFi.

Every OS probes a known URL on joining to work out whether the network has
internet. On the robot's network those names resolve to the robot (hotspot.sh
installs the wildcard DNS) and port 80 lands here (portal-redirect.sh), so the
probe reaches this router instead of the internet. Answering it with anything
other than the expected 204 makes the OS decide it is behind a captive portal
and open its sign-in window, which is how the console appears without anyone
typing an address.

WHY THIS IS A LANDING PAGE AND NOT THE CONSOLE ITSELF

The window the OS opens is not a browser. It is a stripped-down web view --
Apple calls it the Captive Network Assistant -- with no extensions, a cramped
frame, storage that is thrown away when it closes, and, on several platforms,
no WebRTC and no Gamepad API. That is the console's video feed and the
controller: the two things the operator actually needs.

So the probe gets a small page whose only job is to hand off to the real
browser. Serving the console into that window would look like it worked and
then fail at the part that matters.

The handoff cannot be automatic. Nothing the robot sends can reach out and
launch an application on the client -- that is the client's decision, and every
OS deliberately makes it a tap. What this page can do is make the tap obvious
and make it land in the right place, which it does.
"""

from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse

from pipepatrol import config

router = APIRouter()

# Where the console actually is, as the client must type it. Not derived from
# the request: the request arrived at some name belonging to Apple or Google,
# and that is exactly the name we are steering away from.
AP_ADDRESS = "192.168.4.1"
CONSOLE_URL = f"http://{AP_ADDRESS}:{config.PORT}"

# The probe URLs, per platform. Matching on path is deliberate -- the hostname
# has already been rewritten by the wildcard DNS, so by the time a request gets
# here the only thing left that identifies it as a probe is the path it asked
# for.
PROBE_PATHS = (
    "/generate_204",            # Android
    "/gen_204",                 # Android, older
    "/hotspot-detect.html",     # iOS, macOS
    "/library/test/success.html",  # iOS, macOS
    "/connecttest.txt",         # Windows
    "/ncsi.txt",                # Windows
    "/canonical.html",          # Firefox
    "/success.txt",             # Firefox, NetworkManager
)

# What each platform wants to hear when the network is fine. Answering with the
# right one is the ONLY thing that makes the sign-in window go away and stay
# away -- an OS that does not get its expected reply keeps probing on a timer
# and keeps reopening the window over whatever the operator is doing.
#
# The bodies are exact. Apple checks for this HTML specifically, and Windows
# compares the text byte for byte; close enough does not count.
_SUCCESS = {
    "/generate_204": (204, "", "text/plain"),
    "/gen_204": (204, "", "text/plain"),
    "/hotspot-detect.html": (
        200, "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>", "text/html",
    ),
    "/library/test/success.html": (
        200, "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>", "text/html",
    ),
    "/connecttest.txt": (200, "Microsoft Connect Test", "text/plain"),
    "/ncsi.txt": (200, "Microsoft NCSI", "text/plain"),
    "/canonical.html": (200, "success\n", "text/html"),
    "/success.txt": (200, "success\n", "text/plain"),
}

# Clients that have already been shown the welcome page. Keyed by address, which
# on this network is a DHCP lease the robot handed out itself.
#
# Deliberately in memory and deliberately not persisted: forgetting everything
# when the robot restarts is the behaviour you want, because a robot that just
# came up is one whose console somebody probably does want opened again.
_GREETED: set[str] = set()


def _client_address(request: Request) -> str:
    return request.client.host if request.client else "?"


def _is_console_host(request: Request) -> bool:
    """Did this request ask for the robot, or for somewhere on the internet?

    Everything resolves to the robot here, so the Host header is the only way
    to tell "the operator opened the console" from "the OS is checking whether
    this network has internet". Only the second should get the landing page --
    otherwise the console's own requests would be answered with it.
    """
    host = request.headers.get("host", "").split(":")[0].lower()
    return host in {AP_ADDRESS, "localhost", "127.0.0.1", "pipepatrol", "pipepatrol.local"}


@router.get("/generate_204")
@router.get("/gen_204")
@router.get("/hotspot-detect.html")
@router.get("/library/test/success.html")
@router.get("/connecttest.txt")
@router.get("/ncsi.txt")
@router.get("/canonical.html")
@router.get("/success.txt")
async def captive_probe(request: Request):
    """Answer a connectivity probe in the way that opens the sign-in window.

    A 302 rather than the landing page inline: the probe expects a 204 or a
    specific body, and a redirect is the response every platform agrees means
    "portal". Returning HTML with a 200 works on some and is silently accepted
    as success on others, which loses the auto-open entirely.
    """
    if _is_console_host(request):
        # Somebody typed one of these paths at the robot itself. Not a probe.
        return RedirectResponse(CONSOLE_URL, status_code=302)

    # Already shown the welcome page: tell this client the network is fine, so
    # the OS stops probing and the window stays closed. Without this the portal
    # reopens every couple of minutes for as long as the robot is joined, which
    # is worse than never having opened it.
    if _client_address(request) in _GREETED:
        status, body, media_type = _SUCCESS[request.url.path]
        return Response(content=body, status_code=status, media_type=media_type)

    return RedirectResponse(f"http://{AP_ADDRESS}/welcome", status_code=302)


@router.get("/welcome", response_class=HTMLResponse)
async def welcome(request: Request):
    """The one screen the operator sees before the console.

    Deliberately plain: this renders in a web view with no fonts to speak of
    and no guarantee that anything clever survives. A heading, the state of the
    robot, and one thing to tap.
    """
    # Seeing this page is what counts as having been greeted. Marked here rather
    # than when the probe was answered, because a probe the operator never saw
    # the result of is not a greeting -- the window has to have actually opened.
    _GREETED.add(_client_address(request))
    return HTMLResponse(_WELCOME_HTML, headers={"Cache-Control": "no-store"})


_WELCOME_HTML = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PipePatrol</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0b0b0c; color: #f4f4f5;
    -webkit-text-size-adjust: 100%;
  }}
  main {{ max-width: 22rem; padding: 2rem 1.5rem; text-align: center; }}
  h1 {{ font-size: 1.5rem; margin: 0 0 .25rem; letter-spacing: -.02em; }}
  .state {{ color: #8fcf8f; font-size: .875rem; margin: 0 0 2rem; }}
  a.open {{
    display: block; padding: .9rem 1rem; border-radius: .5rem;
    background: #f4f4f5; color: #0b0b0c;
    font-weight: 600; text-decoration: none;
  }}
  .addr {{
    margin-top: 1.5rem; font-size: .8125rem; color: #a1a1aa;
  }}
  code {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
</style>
</head>
<body>
<main>
  <h1>PipePatrol</h1>
  <p class="state">Robot is up and ready to drive.</p>

  <!-- target=_blank is the whole point of this page. The captive window has no
       WebRTC and no Gamepad API on several platforms, so staying inside it means
       no video and no controller. Asking for a new context is what makes the OS
       hand the page to the real default browser instead. -->
  <a class="open" href="{CONSOLE_URL}" target="_blank" rel="noopener">Open the console</a>

  <p class="addr">
    If this window will not drive the robot, open a normal browser and go to<br>
    <code>{AP_ADDRESS}:{config.PORT}</code>
  </p>
</main>
</body>
</html>
"""
