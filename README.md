# Content Engine Desktop

Electron desktop app for Content Engine. LinkedIn posting runs locally on your machine — no proxy needed, no session invalidation.

## Download

Go to [Releases](https://github.com/shreyashfr/content-engine-desktop/releases) and download:
- **Windows**: `Content-Engine-Setup-x.x.x.exe`
- **Mac**: `Content-Engine-x.x.x.dmg`

## First Launch

1. Install and open the app
2. On first launch, it will download a browser engine (~200MB, one-time)
3. A splash screen shows progress — wait for it to finish
4. The app opens automatically

## Building from Source

```bash
git clone https://github.com/shreyashfr/content-engine-desktop.git
cd content-engine-desktop
npm install
npx playwright install chromium
npm start
```

## Creating Installers Locally

```bash
# Windows (run on Windows)
npm run dist:win

# Mac (run on Mac)
npm run dist:mac
```

Output goes to the `dist/` folder.

## Releasing

Push a version tag to trigger automated builds:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions builds Windows `.exe` and Mac `.dmg` automatically and creates a release.
