const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow;
const FRONTEND_PORT = 15100;

// ─── Serve the React frontend via a local HTTP server ───────────────────────
function startFrontendServer() {
  const distDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'frontend-dist')
    : path.join(__dirname, '..', 'frontend-dist');

  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  };

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html'); // SPA fallback
      }

      const ext = path.extname(filePath);
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(data);
        }
      });
    });

    server.listen(FRONTEND_PORT, '127.0.0.1', () => {
      console.log(`Frontend serving on http://127.0.0.1:${FRONTEND_PORT}`);
      resolve(server);
    });
  });
}

// ─── LinkedIn browser helpers (stealth browser on user's own IP) ────────────
async function launchLinkedInBrowser(li_at, proxyUrl) {
  const { chromium } = require('playwright-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  chromium.use(StealthPlugin());

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  if (proxyUrl) {
    const parsed = new URL(proxyUrl);
    launchOptions.proxy = { server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}` };
    if (parsed.username) {
      launchOptions.proxy.username = decodeURIComponent(parsed.username);
      launchOptions.proxy.password = decodeURIComponent(parsed.password || '');
    }
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    ...(launchOptions.proxy ? { proxy: launchOptions.proxy } : {}),
  });

  await context.addCookies([
    { name: 'li_at', value: li_at, domain: '.linkedin.com', path: '/', httpOnly: true, secure: true },
  ]);

  const page = await context.newPage();
  return { browser, context, page };
}

// ─── IPC: Validate LinkedIn token ───────────────────────────────────────────
ipcMain.handle('linkedin:validate', async (_event, { li_at, proxy_url }) => {
  let browser;
  try {
    const session = await launchLinkedInBrowser(li_at, proxy_url || null);
    browser = session.browser;
    const { context, page } = session;

    await page.goto('https://www.linkedin.com/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get JSESSIONID
    const cookies = await context.cookies('https://www.linkedin.com');
    const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
    const jsessionid = jsessionCookie ? jsessionCookie.value.replace(/"/g, '') : null;

    // Fetch profile from inside the browser
    const profile = await page.evaluate(async () => {
      try {
        const resp = await fetch('/voyager/api/me', {
          headers: { 'Accept': 'application/vnd.linkedin.normalized+json+2.1' }
        });
        if (!resp.ok) return null;
        return await resp.json();
      } catch { return null; }
    });

    await browser.close();

    if (!profile) return { valid: false, error: 'Invalid or expired token' };

    const firstName = profile.miniProfile?.firstName || profile.plainId || '';
    const lastName = profile.miniProfile?.lastName || '';

    return {
      valid: true,
      jsessionid: jsessionid || 'ajax:0',
      profileName: `${firstName} ${lastName}`.trim() || 'Connected',
      profileId: profile.miniProfile?.entityUrn || profile.plainId || '',
    };
  } catch (err) {
    console.error('LinkedIn validate error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return { valid: false, error: 'Failed to connect to LinkedIn: ' + err.message };
  }
});

// ─── IPC: Post to LinkedIn ──────────────────────────────────────────────────
ipcMain.handle('linkedin:post', async (_event, { li_at, jsessionid, proxy_url, content, imageB64, imageMimeType }) => {
  let browser;
  try {
    const session = await launchLinkedInBrowser(li_at, proxy_url || null);
    browser = session.browser;
    const { context, page } = session;

    await context.addCookies([
      { name: 'JSESSIONID', value: `"${jsessionid}"`, domain: '.linkedin.com', path: '/', secure: true },
    ]);

    await page.goto('https://www.linkedin.com/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const result = await page.evaluate(async ({ content, hasImage, imageB64, imageMimeType }) => {
      const csrf = document.cookie.match(/JSESSIONID="?([^";]+)"?/)?.[1] || 'ajax:0';
      const headers = {
        'csrf-token': csrf,
        'Accept': 'application/vnd.linkedin.normalized+json+2.1',
        'x-restli-protocol-version': '2.0.0',
        'Content-Type': 'application/json',
      };

      // Get personUrn
      let personUrn = '';
      try {
        const meResp = await fetch('/voyager/api/me', {
          headers: { 'Accept': 'application/vnd.linkedin.normalized+json+2.1' }
        });
        if (meResp.ok) {
          const me = await meResp.json();
          const urn = me.miniProfile?.entityUrn || '';
          const match = urn.match(/urn:li:(?:fs_miniProfile|member):(.+)/);
          personUrn = match ? `urn:li:person:${match[1]}` : '';
        }
      } catch {}

      if (!personUrn) return { success: false, error: 'Could not resolve LinkedIn profile' };

      let imageUrn = null;

      if (hasImage && imageB64) {
        const regResp = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
          method: 'POST', headers,
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
              owner: personUrn,
              serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }]
            }
          })
        });
        if (regResp.ok) {
          const regData = await regResp.json();
          const uploadUrl = regData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
          imageUrn = regData.value?.asset;
          if (uploadUrl && imageUrn) {
            const binary = atob(imageB64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            await fetch(uploadUrl, {
              method: 'PUT',
              headers: { ...headers, 'Content-Type': imageMimeType },
              body: bytes.buffer,
            });
          }
        }
      }

      const postResp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST', headers,
        body: JSON.stringify({
          author: personUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text: content },
              shareMediaCategory: imageUrn ? 'IMAGE' : 'NONE',
              ...(imageUrn ? { media: [{ status: 'READY', media: imageUrn }] } : {})
            }
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
        })
      });

      if (!postResp.ok) {
        const errText = await postResp.text();
        return { success: false, error: `LinkedIn API error (${postResp.status})` };
      }

      const postData = await postResp.json();
      return { success: true, id: postData.id };
    }, {
      content,
      hasImage: !!imageB64,
      imageB64: imageB64 || null,
      imageMimeType: imageMimeType || 'image/jpeg',
    });

    await browser.close();
    return result;
  } catch (err) {
    console.error('LinkedIn post error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return { success: false, error: 'Failed to post: ' + err.message };
  }
});

// ─── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Playwright browser path
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(app.getPath('userData'), 'browsers');

  // Install Chromium on first launch
  const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!fs.existsSync(browsersDir) || fs.readdirSync(browsersDir).length === 0) {
    console.log('First launch: installing Chromium browser...');
    try {
      const { execSync } = require('child_process');
      execSync('npx playwright install chromium', {
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
        stdio: 'inherit',
      });
    } catch (err) {
      console.error('Failed to install Chromium:', err.message);
    }
  }

  await startFrontendServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Content Engine',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${FRONTEND_PORT}`);

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => app.quit());
