const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const staticDir = process.env.BREAK_STATIC_DIR || __dirname;
const dataDir = process.env.BREAK_DATA_DIR || __dirname;
const rootDir = staticDir; // alias pour le service des fichiers statiques
const sessionsDir = path.join(dataDir, "sessions");
const historyDir = path.join(dataDir, "history");
const userLogosDir = path.join(dataDir, "logos");
const customSportsFile = path.join(dataDir, "sports-custom.json");
const HISTORY_MAX = 100;
const BUILTIN_SPORT_IDS = new Set(["nba", "nfl", "ucc"]);
const activeSessionsFile = path.join(dataDir, "active-sessions.json");
const configFiles = {
  // Configs read-only (sports/modes embarques avec l'app)
  sports: path.join(staticDir, "sports.json"),
  modes: path.join(staticDir, "modes.json"),
  // tier-templates est editable par l'admin -> vit dans dataDir, avec fallback static au premier run
  tierTemplates: path.join(dataDir, "tier-templates.json"),
};
const tierTemplatesSeed = path.join(staticDir, "tier-templates.json");
const legacyDefaultStateFiles = {
  wheel: path.join(dataDir, "state.json"),
  draft: path.join(dataDir, "draft-state.json"),
  tier: path.join(dataDir, "tier-state.json"),
};
const clients = {
  wheel: new Map(),
  draft: new Map(),
  tier: new Map(),
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function getScope(url) {
  const scope = url.searchParams.get("scope");
  if (scope === "draft" || scope === "tier") {
    return scope;
  }
  return "wheel";
}

function sanitizeSessionId(rawValue) {
  const normalized = String(rawValue || "default")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "default";
}

function hasExplicitSession(url) {
  return url.searchParams.has("session");
}

function createDefaultDraftState() {
  return {
    participants: Array.from({ length: 10 }, (_, index) => ({
      id: `player-${index + 1}`,
      name: `Spot ${index + 1}`,
      teams: [],
    })),
    currentPick: 0,
    recapVisible: false,
  };
}

function createDefaultTierState() {
  return {
    templateId: "nba-standard",
    started: false,
    recapVisible: false,
    participants: Array.from({ length: 10 }, (_, index) => ({
      id: `player-${index + 1}`,
      name: `Spot ${index + 1}`,
      slotNumber: null,
      teams: { 1: null, 2: null, 3: null },
    })),
    history: [],
  };
}

function getDefaultState(scope) {
  if (scope === "draft") {
    return createDefaultDraftState();
  }
  if (scope === "tier") {
    return createDefaultTierState();
  }
  return { removed: [] };
}

function getStateFile(scope, sessionId) {
  if (sessionId === "default") {
    return legacyDefaultStateFiles[scope];
  }
  return path.join(sessionsDir, `${sessionId}-${scope}.json`);
}

function getScopedClients(scope, sessionId) {
  const clientMap = clients[scope];
  if (!clientMap.has(sessionId)) {
    clientMap.set(sessionId, new Set());
  }
  return clientMap.get(sessionId);
}

function broadcastState(scope, sessionId, state) {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of getScopedClients(scope, sessionId)) {
    client.write(payload);
  }
}

function broadcastEvent(scope, sessionId, eventName, payload) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of getScopedClients(scope, sessionId)) {
    client.write(message);
  }
}

function sanitizeState(scope, candidate) {
  if (scope === "draft") {
    const defaultState = createDefaultDraftState();
    const participants = defaultState.participants.map((player, index) => {
      const incoming = Array.isArray(candidate?.participants) ? candidate.participants[index] : null;
      return {
        id: player.id,
        name: typeof incoming?.name === "string" && incoming.name.trim() ? incoming.name.trim() : player.name,
        teams: Array.isArray(incoming?.teams) ? incoming.teams.filter((id) => typeof id === "string").slice(0, 3) : [],
      };
    });

    const currentPick = Number.isInteger(candidate?.currentPick) ? candidate.currentPick : 0;
    return {
      participants,
      currentPick: Math.max(0, Math.min(currentPick, 30)),
      recapVisible: candidate?.recapVisible === true,
    };
  }

  if (scope === "tier") {
    const defaultState = createDefaultTierState();
    const participants = defaultState.participants.map((player, index) => {
      const incoming = Array.isArray(candidate?.participants) ? candidate.participants[index] : null;
      const slotNumber = Number.isInteger(incoming?.slotNumber) ? incoming.slotNumber : null;
      return {
        id: player.id,
        name: typeof incoming?.name === "string" && incoming.name.trim() ? incoming.name.trim() : player.name,
        slotNumber: slotNumber && slotNumber >= 1 && slotNumber <= 10 ? slotNumber : null,
        teams: {
          1: typeof incoming?.teams?.[1] === "string" ? incoming.teams[1] : null,
          2: typeof incoming?.teams?.[2] === "string" ? incoming.teams[2] : null,
          3: typeof incoming?.teams?.[3] === "string" ? incoming.teams[3] : null,
        },
      };
    });

    const history = Array.isArray(candidate?.history)
      ? candidate.history.filter((entry) => entry && typeof entry === "object" && typeof entry.type === "string").slice(-80)
      : [];

    return {
      templateId:
        typeof candidate?.templateId === "string" && candidate.templateId.trim()
          ? candidate.templateId.trim()
          : defaultState.templateId,
      started: candidate?.started === true,
      recapVisible: candidate?.recapVisible === true,
      participants,
      history,
    };
  }

  return {
    removed: Array.isArray(candidate?.removed) ? candidate.removed.filter((id) => typeof id === "string") : [],
  };
}

async function ensureSessionDir() {
  await fsp.mkdir(sessionsDir, { recursive: true });
}

async function ensureActiveSessionsFile() {
  try {
    await fsp.access(activeSessionsFile, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(activeSessionsFile, JSON.stringify({ wheel: "default", draft: "default", tier: "default" }, null, 2) + "\n");
  }
}

async function readActiveSessions() {
  await ensureActiveSessionsFile();
  const content = await fsp.readFile(activeSessionsFile, "utf8");
  const parsed = JSON.parse(content);
  return {
    wheel: sanitizeSessionId(parsed?.wheel),
    draft: sanitizeSessionId(parsed?.draft),
    tier: sanitizeSessionId(parsed?.tier),
  };
}

async function writeActiveSessions(nextValue) {
  const normalized = {
    wheel: sanitizeSessionId(nextValue?.wheel),
    draft: sanitizeSessionId(nextValue?.draft),
    tier: sanitizeSessionId(nextValue?.tier),
  };
  await fsp.writeFile(activeSessionsFile, JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
}

async function resolveSessionId(url, scope) {
  if (hasExplicitSession(url)) {
    return sanitizeSessionId(url.searchParams.get("session"));
  }
  const activeSessions = await readActiveSessions();
  return activeSessions[scope];
}

async function listSessions(scope) {
  await ensureSessionDir();
  const entries = await fsp.readdir(sessionsDir, { withFileTypes: true });
  const suffix = `-${scope}.json`;
  const scopedSessions = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name.slice(0, -suffix.length))
    .sort();
  return ["default", ...scopedSessions];
}

async function deleteSession(scope, sessionId) {
  const normalizedSessionId = sanitizeSessionId(sessionId);
  if (normalizedSessionId === "default") {
    const error = new Error("Cannot delete default session");
    error.code = "SESSION_DEFAULT";
    throw error;
  }

  const activeSessions = await readActiveSessions();
  if (activeSessions[scope] === normalizedSessionId) {
    const error = new Error("Cannot delete active session");
    error.code = "SESSION_ACTIVE";
    throw error;
  }

  const stateFile = getStateFile(scope, normalizedSessionId);
  try {
    await fsp.unlink(stateFile);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const scopedClients = getScopedClients(scope, normalizedSessionId);
  for (const client of scopedClients) {
    client.end();
  }
  scopedClients.clear();
  return true;
}

async function ensureStateFile(scope, sessionId) {
  const stateFile = getStateFile(scope, sessionId);
  try {
    await fsp.access(stateFile, fs.constants.F_OK);
  } catch {
    if (sessionId !== "default") {
      await ensureSessionDir();
    }
    await fsp.writeFile(stateFile, JSON.stringify(getDefaultState(scope), null, 2) + "\n");
  }
}

async function readState(scope, sessionId) {
  const stateFile = getStateFile(scope, sessionId);
  await ensureStateFile(scope, sessionId);
  const content = await fsp.readFile(stateFile, "utf8");
  return sanitizeState(scope, JSON.parse(content));
}

function isStateComplete(scope, state) {
  if (scope === "tier") {
    return state.participants.every((p) =>
      p.slotNumber && p.teams && p.teams[1] && p.teams[2] && p.teams[3]
    );
  }
  if (scope === "draft") {
    return Number(state.currentPick) >= 30;
  }
  return false;
}

async function ensureHistoryDir() {
  await fsp.mkdir(historyDir, { recursive: true });
}

async function maybeSnapshotHistory(scope, sessionId, state) {
  if (!isStateComplete(scope, state)) return;
  // Le sport est encode dans sessionId (sport-nfl, sport-ucc, sinon "default" = nba)
  const sportId = sessionId.startsWith("sport-") ? sessionId.slice("sport-".length) : "nba";
  // Signature stable pour eviter de re-snapshotter le meme break a chaque save
  const signature = JSON.stringify({ scope, sportId, participants: state.participants });
  await ensureHistoryDir();
  const existing = await fsp.readdir(historyDir).catch(() => []);
  // Si un fichier recent (<24h) a la meme signature, on skip
  for (const f of existing) {
    if (!f.startsWith(`${sportId}-${scope}-`)) continue;
    try {
      const content = await fsp.readFile(path.join(historyDir, f), "utf8");
      const parsed = JSON.parse(content);
      if (parsed.signature === signature) return;
    } catch { /* ignore */ }
  }
  // Nouveau snapshot
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const id = `${sportId}-${scope}-${stamp}`;
  const payload = {
    id,
    scope,
    sportId,
    sessionId,
    createdAt: new Date().toISOString(),
    signature,
    state,
  };
  await fsp.writeFile(path.join(historyDir, `${id}.json`), JSON.stringify(payload, null, 2) + "\n");
  // GC : garde les HISTORY_MAX plus recents
  const all = (await fsp.readdir(historyDir)).filter((f) => f.endsWith(".json")).sort();
  if (all.length > HISTORY_MAX) {
    const toDrop = all.slice(0, all.length - HISTORY_MAX);
    await Promise.all(toDrop.map((f) => fsp.unlink(path.join(historyDir, f)).catch(() => {})));
  }
}

async function writeState(scope, sessionId, nextState) {
  const stateFile = getStateFile(scope, sessionId);
  const cleanState = sanitizeState(scope, nextState);
  if (sessionId !== "default") {
    await ensureSessionDir();
  }
  await fsp.writeFile(stateFile, JSON.stringify(cleanState, null, 2) + "\n");
  broadcastState(scope, sessionId, cleanState);
  // Snapshot historique si l'etat vient d'atteindre la completion
  void maybeSnapshotHistory(scope, sessionId, cleanState);
  return cleanState;
}

async function readConfig(name) {
  const configPath = configFiles[name];
  // Au premier run packaged, tier-templates.json n'existe pas encore dans dataDir : on seed depuis static.
  if (name === "tierTemplates") {
    try {
      await fsp.access(configPath, fs.constants.F_OK);
    } catch {
      try {
        await fsp.copyFile(tierTemplatesSeed, configPath);
      } catch {
        // pas de seed -> on retombe sur un objet vide
        return {};
      }
    }
  }
  const content = await fsp.readFile(configPath, "utf8");
  const parsed = JSON.parse(content);
  if (name === "sports") {
    // Merge avec les sports custom de l'utilisateur (priorite au built-in pour les IDs reserves)
    const custom = await readCustomSports();
    for (const [id, sport] of Object.entries(custom)) {
      if (BUILTIN_SPORT_IDS.has(id)) continue; // protege les built-in
      parsed[id] = sport;
    }
  }
  return parsed;
}

async function readCustomSports() {
  try {
    const content = await fsp.readFile(customSportsFile, "utf8");
    return JSON.parse(content) || {};
  } catch {
    return {};
  }
}

async function writeCustomSports(sports) {
  await fsp.writeFile(customSportsFile, JSON.stringify(sports, null, 2) + "\n");
}

function isValidSportId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,29}$/.test(id);
}

function sanitizeSportPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.toLowerCase().trim() : "";
  if (!isValidSportId(id)) return null;
  if (BUILTIN_SPORT_IDS.has(id)) return null; // ne pas autoriser l'override des built-in
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : id.toUpperCase();
  const teams = Array.isArray(raw.teams) ? raw.teams : [];
  const cleanTeams = teams
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const teamId = typeof t.id === "string" ? t.id.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") : "";
      if (!teamId) return null;
      const teamLabel = typeof t.label === "string" && t.label.trim() ? t.label.trim() : teamId;
      const logo = typeof t.logo === "string" ? t.logo.trim() : "";
      return { id: teamId, label: teamLabel, logo };
    })
    .filter(Boolean);
  // dedup teams par id
  const seen = new Set();
  const dedup = [];
  for (const t of cleanTeams) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    dedup.push(t);
  }
  return { id, label, teams: dedup };
}

async function serveFile(response, pathname) {
  const resolvedPath = path.normalize(path.join(rootDir, pathname));
  if (!resolvedPath.startsWith(rootDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  let filePath = resolvedPath;
  try {
    const stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[extension] || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

async function serveUserLogo(response, relativePath) {
  // Securite : pas de "..", pas de chemins absolus
  if (!relativePath || relativePath.includes("..") || relativePath.startsWith("/")) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  const decoded = decodeURIComponent(relativePath);
  const resolved = path.normalize(path.join(userLogosDir, decoded));
  if (!resolved.startsWith(userLogosDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  try {
    const stats = await fsp.stat(resolved);
    if (!stats.isFile()) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
  } catch {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const extension = path.extname(resolved).toLowerCase();
  const contentType = contentTypes[extension] || "image/png";
  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
  fs.createReadStream(resolved).pipe(response);
}

async function readRequestBody(request, { asBuffer = false } = {}) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  return asBuffer ? buf : buf.toString("utf8");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  const scope = getScope(url);
  const sessionId = await resolveSessionId(url, scope);

  if (request.method === "GET" && url.pathname === "/api/active-sessions") {
    try {
      sendJson(response, 200, await readActiveSessions());
    } catch {
      sendJson(response, 500, { error: "Unable to read active sessions" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/active-sessions") {
    try {
      const body = await readRequestBody(request);
      const nextValue = JSON.parse(body);
      const savedValue = await writeActiveSessions(nextValue);
      sendJson(response, 200, savedValue);
    } catch {
      sendJson(response, 400, { error: "Invalid active sessions payload" });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    try {
      sendJson(response, 200, { scope, sessions: await listSessions(scope) });
    } catch {
      sendJson(response, 500, { error: "Unable to list sessions" });
    }
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/api/sessions") {
    try {
      const requestedSessionId = sanitizeSessionId(url.searchParams.get("session"));
      const deleted = await deleteSession(scope, requestedSessionId);
      sendJson(response, 200, { scope, session: requestedSessionId, deleted });
    } catch (error) {
      if (error.code === "SESSION_DEFAULT") {
        sendJson(response, 400, { error: "Default session cannot be deleted" });
        return;
      }
      if (error.code === "SESSION_ACTIVE") {
        sendJson(response, 400, { error: "Active session cannot be deleted" });
        return;
      }
      sendJson(response, 500, { error: "Unable to delete session" });
    }
    return;
  }

  // === History API ===
  if (request.method === "GET" && url.pathname === "/api/history") {
    try {
      await ensureHistoryDir();
      const files = (await fsp.readdir(historyDir)).filter((f) => f.endsWith(".json"));
      const entries = await Promise.all(files.map(async (f) => {
        try {
          const content = await fsp.readFile(path.join(historyDir, f), "utf8");
          const parsed = JSON.parse(content);
          return {
            id: parsed.id,
            scope: parsed.scope,
            sportId: parsed.sportId,
            createdAt: parsed.createdAt,
          };
        } catch { return null; }
      }));
      sendJson(response, 200, entries.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch {
      sendJson(response, 500, { error: "Unable to read history" });
    }
    return;
  }

  const historyDetailMatch = url.pathname.match(/^\/api\/history\/([a-zA-Z0-9_.-]+)$/);
  if (historyDetailMatch) {
    const id = historyDetailMatch[1];
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      sendJson(response, 400, { error: "Invalid id" });
      return;
    }
    const file = path.join(historyDir, `${id}.json`);
    if (request.method === "GET") {
      try {
        const content = await fsp.readFile(file, "utf8");
        sendJson(response, 200, JSON.parse(content));
      } catch {
        sendJson(response, 404, { error: "Not found" });
      }
      return;
    }
    if (request.method === "DELETE") {
      try {
        await fsp.unlink(file);
        sendJson(response, 200, { ok: true });
      } catch {
        sendJson(response, 404, { error: "Not found" });
      }
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/config/sports") {
    try {
      sendJson(response, 200, await readConfig("sports"));
    } catch {
      sendJson(response, 500, { error: "Unable to read sports config" });
    }
    return;
  }

  // Cree ou met a jour un sport custom (body = { id, label, teams: [...] })
  if (request.method === "POST" && url.pathname === "/api/config/sports") {
    try {
      const body = await readRequestBody(request);
      const parsed = JSON.parse(body.toString("utf8"));
      const clean = sanitizeSportPayload(parsed);
      if (!clean) {
        sendJson(response, 400, { error: "Invalid sport payload" });
        return;
      }
      const custom = await readCustomSports();
      custom[clean.id] = { label: clean.label, teams: clean.teams };
      await writeCustomSports(custom);
      sendJson(response, 200, { ok: true, sport: custom[clean.id] });
    } catch (err) {
      sendJson(response, 400, { error: String(err?.message || err) });
    }
    return;
  }

  // Supprime un sport custom + ses logos
  const sportDeleteMatch = url.pathname.match(/^\/api\/config\/sports\/([a-z0-9-]+)$/);
  if (sportDeleteMatch && request.method === "DELETE") {
    const id = sportDeleteMatch[1];
    if (BUILTIN_SPORT_IDS.has(id)) {
      sendJson(response, 403, { error: "Cannot delete built-in sport" });
      return;
    }
    try {
      const custom = await readCustomSports();
      delete custom[id];
      await writeCustomSports(custom);
      // supprime le dossier de logos
      await fsp.rm(path.join(userLogosDir, id), { recursive: true, force: true }).catch(() => {});
      sendJson(response, 200, { ok: true });
    } catch (err) {
      sendJson(response, 500, { error: String(err?.message || err) });
    }
    return;
  }

  // Upload d'un logo : POST /api/config/sports/:id/logos?filename=xxx.png  (body = bytes du fichier)
  // Retourne { url: "./user-logos/<id>/<filename>" }
  const sportLogoMatch = url.pathname.match(/^\/api\/config\/sports\/([a-z0-9-]+)\/logos$/);
  if (sportLogoMatch && request.method === "POST") {
    const id = sportLogoMatch[1];
    if (BUILTIN_SPORT_IDS.has(id)) {
      sendJson(response, 403, { error: "Cannot upload to built-in sport" });
      return;
    }
    try {
      const rawFilename = url.searchParams.get("filename") || "";
      const safeFilename = rawFilename
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!safeFilename || !/\.(png|jpg|jpeg|webp|gif|svg|bmp|tiff?|avif|heic|heif)$/i.test(safeFilename)) {
        sendJson(response, 400, { error: `Invalid filename: "${rawFilename}" -> "${safeFilename}"` });
        return;
      }
      const body = await readRequestBody(request, { asBuffer: true });
      if (!body || body.length === 0 || body.length > 15 * 1024 * 1024) {
        sendJson(response, 400, { error: `Invalid file (empty or > 15MB, got ${body?.length || 0} bytes)` });
        return;
      }
      const sportLogoDir = path.join(userLogosDir, id);
      await fsp.mkdir(sportLogoDir, { recursive: true });
      const dest = path.join(sportLogoDir, safeFilename);
      await fsp.writeFile(dest, body);
      sendJson(response, 200, { ok: true, url: `./user-logos/${id}/${safeFilename}` });
    } catch (err) {
      sendJson(response, 500, { error: String(err?.message || err) });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config/modes") {
    try {
      sendJson(response, 200, await readConfig("modes"));
    } catch {
      sendJson(response, 500, { error: "Unable to read modes config" });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config/tier-templates") {
    try {
      sendJson(response, 200, await readConfig("tierTemplates"));
    } catch {
      sendJson(response, 500, { error: "Unable to read tier templates" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/tier-templates") {
    try {
      const body = await readRequestBody(request);
      const nextTemplates = JSON.parse(body);
      await fsp.writeFile(configFiles.tierTemplates, JSON.stringify(nextTemplates, null, 2) + "\n");
      sendJson(response, 200, nextTemplates);
    } catch {
      sendJson(response, 400, { error: "Invalid tier templates payload" });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state/stream") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    response.write("\n");

    try {
      const state = await readState(scope, sessionId);
      response.write(`data: ${JSON.stringify(state)}\n\n`);
    } catch {
      response.write(`data: ${JSON.stringify(getDefaultState(scope))}\n\n`);
    }

    const scopedClients = getScopedClients(scope, sessionId);
    scopedClients.add(response);
    request.on("close", () => {
      scopedClients.delete(response);
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tier-animation") {
    try {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body);
      broadcastEvent(scope, sessionId, "tier-animation", payload);
      sendJson(response, 200, { ok: true });
    } catch {
      sendJson(response, 400, { error: "Invalid tier animation payload" });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    try {
      const state = await readState(scope, sessionId);
      sendJson(response, 200, state);
    } catch {
      sendJson(response, 500, { error: "Unable to read state" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/state") {
    try {
      const body = await readRequestBody(request);
      const nextState = JSON.parse(body);
      const savedState = await writeState(scope, sessionId, nextState);
      sendJson(response, 200, savedState);
    } catch {
      sendJson(response, 400, { error: "Invalid state payload" });
    }
    return;
  }

  if (request.method === "GET") {
    const pathname = url.pathname === "/" ? "/admin.html" : url.pathname;
    // Route speciale pour servir les logos utilisateur depuis userData/logos
    if (pathname.startsWith("/user-logos/")) {
      await serveUserLogo(response, pathname.slice("/user-logos/".length));
      return;
    }
    await serveFile(response, pathname);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(port, host, async () => {
  await ensureSessionDir();
  await ensureActiveSessionsFile();
  await Promise.all([
    ensureStateFile("wheel", "default"),
    ensureStateFile("draft", "default"),
    ensureStateFile("tier", "default"),
  ]);
  console.log(`NBA overlay server running on http://${host}:${port}`);
});
