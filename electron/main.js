const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow, splashWindow;
let FRONTEND_PORT = 15100;

// ─── Path helpers ───────────────────────────────────────────────────────────
function getFrontendDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'frontend-dist');
  }
  return path.join(__dirname, '..', 'frontend-dist');
}

// ─── Splash screen for first-launch setup ───────────────────────────────────
function showSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function updateSplash(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('setup-status', msg);
  }
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}


// ─── Find an available port ─────────────────────────────────────────────────
function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    tester.listen(startPort, '127.0.0.1', () => {
      tester.close(() => resolve(startPort));
    });
  });
}

// ─── Serve React frontend ───────────────────────────────────────────────────
async function startFrontendServer() {
  const distDir = getFrontendDir();

  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  };

  FRONTEND_PORT = await findAvailablePort(FRONTEND_PORT);

  const server = http.createServer((req, res) => {
    // Strip /ce/ prefix — vite builds with base: '/ce/' for the web server
    let urlPath = req.url.split('?')[0];
    if (urlPath.startsWith('/ce/')) urlPath = urlPath.slice(3);
    let filePath = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
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

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(FRONTEND_PORT, '127.0.0.1', () => {
      console.log(`Frontend serving on http://127.0.0.1:${FRONTEND_PORT}`);
      resolve(server);
    });
  });
}

// ─── LinkedIn API helpers ───────────────────────────────────────────────────
// Uses Electron's net.request (Chromium network stack) — real Chrome TLS fingerprint,
// indistinguishable from a normal Chrome browser to LinkedIn's bot detection.
function linkedInRequest(method, url, { li_at, jsessionid, body, contentType }) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method, url, redirect: 'follow' });

    // Set headers — cookie header carries auth, csrf-token prevents CSRF check
    request.setHeader('cookie', `li_at=${li_at}; JSESSIONID="${jsessionid}"`);
    request.setHeader('csrf-token', jsessionid);
    request.setHeader('accept', 'application/vnd.linkedin.normalized+json+2.1');
    request.setHeader('x-restli-protocol-version', '2.0.0');
    request.setHeader('x-li-lang', 'en_US');
    request.setHeader('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    request.setHeader('x-li-track', JSON.stringify({
      clientVersion: '1.13.8920', mpVersion: '1.13.8920', osName: 'web',
      timezoneOffset: -5.5, timezone: 'Asia/Kolkata', deviceFormFactor: 'DESKTOP',
      mpName: 'voyager-web', displayDensity: 1, displayWidth: 1920, displayHeight: 1080
    }));

    if (body) {
      request.setHeader('content-type', contentType || 'application/json');
    }

    console.log(`[linkedin] ${method} ${url}`);

    request.on('response', (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        const pathname = new URL(url).pathname;
        console.log(`[linkedin] ${method} ${pathname} -> ${response.statusCode} (${raw.length} bytes)`);

        let data;
        try { data = JSON.parse(raw); }
        catch { data = raw; }

        resolve({ status: response.statusCode, data });
      });
    });

    request.on('error', (err) => {
      console.error(`[linkedin] ${method} ${url} error:`, err.message);
      reject(err);
    });

    if (body) {
      request.write(typeof body === 'string' ? body : body);
    }
    request.end();
  });
}

// ─── Extract person URN from Voyager /me response ───────────────────────────
function extractPersonUrn(data) {
  // Deep search: stringify and find URN pattern directly
  const str = JSON.stringify(data);
  // Look for fs_miniProfile URN (most reliable)
  const miniMatch = str.match(/urn:li:fs_miniProfile:([A-Za-z0-9_-]+)/);
  if (miniMatch) return `urn:li:person:${miniMatch[1]}`;
  // Look for member URN
  const memberMatch = str.match(/urn:li:member:([A-Za-z0-9_-]+)/);
  if (memberMatch) return `urn:li:person:${memberMatch[1]}`;
  // Try nested paths: data.data.miniProfile, data.miniProfile, etc.
  const profile = data.data || data;
  if (profile.miniProfile?.entityUrn) {
    const m = profile.miniProfile.entityUrn.match(/urn:li:(?:fs_miniProfile|member):(.+)/);
    if (m) return `urn:li:person:${m[1]}`;
  }
  if (profile.miniProfile?.objectUrn) {
    const m = profile.miniProfile.objectUrn.match(/urn:li:member:(.+)/);
    if (m) return `urn:li:person:${m[1]}`;
  }
  // Fallback: plainId
  const plainId = profile.plainId || data.plainId;
  if (plainId) return `urn:li:person:${plainId}`;
  return null;
}

// ─── IPC: Validate LinkedIn token ───────────────────────────────────────────
ipcMain.handle('linkedin:validate', async (_event, { li_at, jsessionid }) => {
  try {
    const csrf = jsessionid || 'ajax:0';
    const res = await linkedInRequest('GET', 'https://www.linkedin.com/voyager/api/me', { li_at, jsessionid: csrf });
    console.log('[linkedin] validate status:', res.status);
    const isString = typeof res.data === 'string';
    console.log('[linkedin] response type:', isString ? 'string' : 'json', isString ? res.data.substring(0, 200) : JSON.stringify(Object.keys(res.data || {})));
    if (res.status !== 200) return { valid: false, error: `Invalid or expired token (HTTP ${res.status})` };
    if (isString) return { valid: false, error: 'LinkedIn returned non-JSON response. Token may be expired.' };
    const raw = res.data;
    const profile = raw.data || raw; // handle normalized wrapper
    const mini = profile.miniProfile || {};
    console.log('[linkedin] miniProfile:', JSON.stringify(mini));
    const personUrn = extractPersonUrn(raw);
    console.log('[linkedin] extracted personUrn:', personUrn);
    const firstName = mini.firstName || profile.plainId || '';
    const lastName = mini.lastName || '';
    return {
      valid: true,
      jsessionid: csrf,
      profileName: `${firstName} ${lastName}`.trim() || 'Connected',
      profileId: mini.entityUrn || profile.plainId || personUrn || '',
      personUrn: personUrn || '',
    };
  } catch (err) {
    console.error('LinkedIn validate error:', err.message);
    return { valid: false, error: 'Failed to connect to LinkedIn: ' + err.message };
  }
});

// ─── IPC: Post to LinkedIn ──────────────────────────────────────────────────
ipcMain.handle('linkedin:post', async (_event, { li_at, jsessionid, content, imageB64, imageMimeType }) => {
  try {
    // Get profile URN
    const meRes = await linkedInRequest('GET', 'https://www.linkedin.com/voyager/api/me', { li_at, jsessionid });
    if (meRes.status !== 200) return { success: false, error: 'Could not resolve LinkedIn profile' };
    console.log('[linkedin] /me for post, keys:', JSON.stringify(Object.keys(meRes.data)));
    const personUrn = extractPersonUrn(meRes.data);
    if (!personUrn) {
      const snippet = typeof meRes.data === 'string' ? meRes.data.substring(0, 200) : JSON.stringify(meRes.data).substring(0, 200);
      return { success: false, error: `Could not resolve profile URN (status ${meRes.status}). Response: ${snippet}` };
    }

    // Upload image if present
    let imageUrn = null;
    if (imageB64) {
      const regRes = await linkedInRequest('POST', 'https://api.linkedin.com/v2/assets?action=registerUpload', {
        li_at, jsessionid,
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: personUrn,
            serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }]
          }
        }),
      });
      if (regRes.status >= 200 && regRes.status < 300) {
        const uploadUrl = regRes.data.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
        imageUrn = regRes.data.value?.asset;
        if (uploadUrl && imageUrn) {
          const imgBuffer = Buffer.from(imageB64, 'base64');
          await linkedInRequest('PUT', uploadUrl, {
            li_at, jsessionid,
            body: imgBuffer,
            contentType: imageMimeType || 'image/jpeg',
          });
        }
      }
    }

    // Create post
    const postRes = await linkedInRequest('POST', 'https://api.linkedin.com/v2/ugcPosts', {
      li_at, jsessionid,
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
      }),
    });

    if (postRes.status >= 200 && postRes.status < 300) {
      return { success: true, id: postRes.data.id || '' };
    }
    return { success: false, error: `LinkedIn API error (${postRes.status})` };
  } catch (err) {
    console.error('LinkedIn post error:', err.message);
    return { success: false, error: 'Failed to post: ' + err.message };
  }
});

// ─── Create main app window ─────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Content Engine',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${FRONTEND_PORT}`);

  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Start frontend server
  await startFrontendServer();

  // Show main window
  createMainWindow();

  // ─── Auto-updater ──────────────────────────────────────────────────────────
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', { status: 'downloading', version: info.version });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart the app.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.log('Auto-update error:', err.message);
  });

  autoUpdater.checkForUpdates().catch(() => {});
});

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (mainWindow === null) createMainWindow();
});
