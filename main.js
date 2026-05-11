const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

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

app.whenReady().then(async () => {
  ensureStateFiles();
  await startServer();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
