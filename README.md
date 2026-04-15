# Content Engine Desktop

Electron desktop app for Content Engine. All app features (research, ideation, content production) use the remote server API. LinkedIn posting runs locally on your machine via a stealth browser — no proxy needed, no session invalidation.

## Setup (Windows/Mac/Linux)

### 1. Install Node.js
Download and install Node.js 18+ from https://nodejs.org

### 2. Download & Run

```bash
git clone https://github.com/shreyashfr/content-engine-desktop.git
cd content-engine-desktop
npm install
npx playwright install chromium
npm start
```

That's it. The app opens as a desktop window.

## How LinkedIn Posting Works

1. Go to **Post Content** in the app
2. Enter your LinkedIn `li_at` cookie (from browser DevTools → Application → Cookies → linkedin.com)
3. Click **Save & Connect** — the app validates your token using a stealth browser running on YOUR machine
4. Select an approved post and click **Post to LinkedIn** — posted from your local IP, not a server

No proxy needed. No session invalidation. Your LinkedIn session stays safe.
