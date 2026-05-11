const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

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
// - Au demarrage : check + popup si update dispo.
// - L'utilisateur accepte : download silencieux + popup pour redemarrer quand pret.
// - En dev (non-packaged) : on ne fait rien (electron-updater plante sans signature/manifest).
function setupAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false; // on demande avant de download
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
      autoUpdater.downloadUpdate().catch((err) => {
        dialog.showErrorBox("Erreur de telechargement", String(err?.message || err));
      });
    }
  });

  autoUpdater.on("update-downloaded", async (info) => {
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
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    // Pas de popup pour ne pas embeter l'utilisateur si GitHub est down/offline.
    console.error("autoUpdater error:", err?.message || err);
  });

  // Check tout de suite, puis toutes les 6h tant que l'app tourne
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
