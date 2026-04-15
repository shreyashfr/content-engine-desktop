# Content Engine Desktop

Electron desktop app for Content Engine. All app features (research, ideation, content production) use the remote server API. LinkedIn posting runs locally on your machine via a stealth browser — no proxy needed, no session invalidation.

## Setup (Windows/Mac/Linux)

### 1. Install Node.js
Download and install Node.js 18+ from https://nodejs.org

### 2. Download & Install

```bash
# Clone the repo
git clone https://github.com/shreyashfr/content-engine-desktop.git
cd content-engine-desktop

# Install dependencies
npm install

# Install Playwright browser (one-time)
npx playwright install chromium
```

### 3. Build the frontend

You need the `content-engine` React app repo cloned as a sibling folder:

```bash
# Clone the frontend repo next to this folder
cd ..
git clone https://github.com/shreyashfr/content-engine.git
cd content-engine
npm install
cd ../content-engine-desktop

# Build the frontend for Electron
npm run build:frontend
```

### 4. Run the app

```bash
npm start
```

To run with DevTools open:
```bash
npm run dev
```

## How LinkedIn Posting Works

1. Go to **Post Content** in the app
2. Enter your LinkedIn `li_at` cookie (from browser DevTools → Application → Cookies → linkedin.com)
3. Click **Save & Connect** — the app validates your token using a stealth browser running on YOUR machine
4. Select an approved post and click **Post to LinkedIn** — posted from your local IP, not a server

No proxy needed. No session invalidation. Your LinkedIn session stays safe.
