const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

// Logs auto-update visibles dans ~/Library/Logs/Break Overlay/main.log (Mac)
// ou %APPDATA%/Break Overlay/logs/main.log (Windows)
log.transports.file.level = "info";
autoUpdater.logger = log;

let mainWindow = null;
let serverModule = null;

// Determine ou stocker les fichiers d'etat (sera ecrit/relu en runtime).
// En dev : dans le repo a cote des autres fichiers.
// En prod (packaged) : dans userData (~/Library/Application Support/Break Overlay sur Mac,
//                       %APPDATA%/Break Overlay sur Windows).
function getDataDir() {
  return app.isPackaged ? app.getPath("userData") : __dirname;
}

// Au premier lancement packaged, on copie les fichiers d'etat initiaux depuis extraResources.
function ensureStateFiles() {
  if (!app.isPackaged) return;
  const dataDir = getDataDir();
  const seedDir = process.resourcesPath; // contient les fichiers depuis extraResources
  const files = ["state.json", "draft-state.json", "tier-state.json", "active-sessions.json"];
  for (const file of files) {
    const dest = path.join(dataDir, file);
    if (!fs.existsSync(dest)) {
      const src = path.join(seedDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }
  }
  const sessionsDir = path.join(dataDir, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
}

async function startServer() {
  process.env.BREAK_DATA_DIR = getDataDir();
  process.env.BREAK_STATIC_DIR = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar")
    : __dirname;
  serverModule = require("./server.js");
  // server.listen() est asynchrone, on laisse un peu de temps.
  await new Promise((r) => setTimeout(r, 400));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#0b1320",
    title: "Break Overlay",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
    },
  });

  mainWindow.loadURL("http://127.0.0.1:4173/admin.html");

  // Liens externes (target=_blank) -> ouvrir dans le navigateur par defaut.
  // Sauf les liens vers notre propre serveur, qu'on ouvre dans une nouvelle fenetre native.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:4173/")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 860,
          backgroundColor: "#0b1320",
          autoHideMenuBar: true,
        },
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Verifie les mises a jour via GitHub Releases.
// - Windows : flux complet (download + install automatique au redemarrage).
// - Mac : check manuel (popup qui ouvre la page de release GitHub, l'utilisateur
//         telecharge le .dmg et le glisse dans /Applications). Pas de auto-install
//         car l'app n'est pas signee Apple Developer.
// - Dev (non-packaged) : on ne fait rien.

const RELEASE_PAGE_BASE = "https://github.com/fyrex-FR/clim/releases/latest";

async function checkUpdatesManualMac() {
  try {
    // On lit le manifeste latest-mac.yml pour comparer les versions.
    const res = await fetch("https://github.com/fyrex-FR/clim/releases/latest/download/latest-mac.yml");
    if (!res.ok) {
      log.warn("Mac update check: HTTP", res.status);
      return;
    }
    const text = await res.text();
    const versionMatch = text.match(/^version:\s*([\d.]+)/m);
    if (!versionMatch) return;
    const remoteVersion = versionMatch[1];
    const currentVersion = app.getVersion();
    if (remoteVersion === currentVersion) {
      log.info(`Mac update check: already on latest ${currentVersion}`);
      return;
    }
    // Comparaison naive (ok pour semver simple x.y.z)
    if (remoteVersion < currentVersion) {
      log.info(`Mac update check: remote ${remoteVersion} < current ${currentVersion}, skip`);
      return;
    }
    log.info(`Mac update available: ${currentVersion} -> ${remoteVersion}`);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Mise a jour disponible",
      message: `Une nouvelle version (${remoteVersion}) est disponible.`,
      detail: "Sur Mac, l'installation se fait manuellement : telecharge le .dmg, ouvre-le et glisse l'app dans /Applications pour remplacer l'ancienne.",
      buttons: ["Ouvrir la page de telechargement", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      shell.openExternal(RELEASE_PAGE_BASE);
    }
  } catch (err) {
    log.error("Mac update check failed:", err?.message || err);
  }
}

// Affiche une barre de progression d'update en haut de toutes les fenetres ouvertes.
// On injecte du JS dans chaque webContents (admin + display ouvertes en plus).
function injectUpdateProgress(percent) {
  const js = `(() => {
    let bar = document.getElementById('__update_progress__');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = '__update_progress__';
      bar.className = 'update-progress';
      bar.innerHTML =
        '<span class="update-progress__label">Telechargement de la mise a jour</span>' +
        '<span class="update-progress__track"><span class="update-progress__fill"></span></span>' +
        '<span class="update-progress__percent">0%</span>';
      document.body.appendChild(bar);
    }
    const fill = bar.querySelector('.update-progress__fill');
    const pct = bar.querySelector('.update-progress__percent');
    if (fill) fill.style.width = ${percent} + '%';
    if (pct) pct.textContent = ${percent} + '%';
  })();`;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.executeJavaScript(js).catch(() => {});
  }
}

function clearUpdateProgress() {
  const js = `(() => {
    const bar = document.getElementById('__update_progress__');
    if (bar) bar.remove();
  })();`;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.executeJavaScript(js).catch(() => {});
  }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;

  if (process.platform === "darwin") {
    // Mac : check manuel
    checkUpdatesManualMac();
    setInterval(checkUpdatesManualMac, 6 * 60 * 60 * 1000);
    return;
  }

  // Windows (et Linux le cas echeant) : flux electron-updater natif
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Mise a jour disponible",
      message: `Une nouvelle version (${info.version}) est disponible.`,
      detail: "Voulez-vous la telecharger maintenant ? L'installation aura lieu au prochain demarrage de l'app.",
      buttons: ["Telecharger", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      injectUpdateProgress(0);
      autoUpdater.downloadUpdate().catch((err) => {
        clearUpdateProgress();
        dialog.showErrorBox("Erreur de telechargement", String(err?.message || err));
      });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.min(100, Math.round(progress?.percent || 0));
    injectUpdateProgress(percent);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    clearUpdateProgress();
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Mise a jour prete",
      message: `La version ${info.version} est telechargee.`,
      detail: "Redemarrer maintenant pour installer ? (sinon l'install se fera a la prochaine fermeture)",
      buttons: ["Redemarrer maintenant", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      try {
        log.info("Calling quitAndInstall...");
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        log.error("quitAndInstall threw:", err);
        dialog.showErrorBox("Erreur installation", String(err?.message || err));
      }
    }
  });

  autoUpdater.on("error", (err) => {
    clearUpdateProgress();
    log.error("autoUpdater error:", err?.message || err);
  });

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  ensureStateFiles();
  await startServer();
  createMainWindow();
  setupAutoUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
