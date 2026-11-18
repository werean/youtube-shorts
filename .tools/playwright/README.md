# Playwright screenshot helper (local tooling)

Not part of the app runtime. Uses the Playwright Node API against **system Chrome** (`channel: "chrome"`) by default — no bundled browser download required.

## Setup (already done on this machine)

```powershell
cd C:\Users\lucas\code\youtube-shorts\.tools\playwright
bun install
```

Optional bundled Chromium (slow / flaky on this PC after zip download):

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\browsers"
bun run install:browsers
# then: $env:PLAYWRIGHT_CHANNEL = ""
```

## Capture

```powershell
cd C:\Users\lucas\code\youtube-shorts\.tools\playwright
$env:PLAYWRIGHT_CHANNEL = "chrome"   # default in screenshot.mjs if unset
bun run shot -- "http://localhost:5173/" "C:\path\to\out.png"
```

Args: `node screenshot.mjs [url] [out.png]`
