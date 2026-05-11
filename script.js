let teams = [];

const teamsRoot = document.querySelector("#teams");
const remainingCount = document.querySelector("#remaining-count");
const resetButton = document.querySelector("#reset");
const undoButton = document.querySelector("#undo");
const searchParams = new URLSearchParams(window.location.search);
const mode = searchParams.get("mode") === "display" ? "display" : "streamer";
const pollIntervalMs = 15000;

let state = { removed: [] };
let isSaving = false;
let boardInitialized = false;
let saveQueue = Promise.resolve();
let pendingSaveCount = 0;

if (searchParams.get("preview") === "1") {
  document.body.classList.add("preview-mode");
}

document.body.classList.add(`${mode}-mode`);

function sanitizeState(candidate) {
  return {
    removed: Array.isArray(candidate?.removed) ? candidate.removed.filter((id) => typeof id === "string") : [],
  };
}

function isMasked(teamId) {
  return state.removed.includes(teamId);
}

async function fetchState() {
  const response = await fetch(AppSport.buildApiUrl("./api/state"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Impossible de charger l'etat (${response.status})`);
  }

  const data = await response.json();
  return sanitizeState(data);
}

async function saveState() {
  const snapshot = sanitizeState(state);

  pendingSaveCount += 1;
  isSaving = true;
  renderControls();

  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      const response = await fetch(AppSport.buildApiUrl("./api/state"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(snapshot),
      });

      if (!response.ok) {
        throw new Error(`Impossible de sauvegarder l'etat (${response.status})`);
      }

      const data = await response.json();
      const savedState = sanitizeState(data);
      if (JSON.stringify(savedState.removed) !== JSON.stringify(state.removed)) {
        const previousState = state;
        state = savedState;
        if (boardInitialized) {
          applyStateDiff(previousState, savedState);
        }
      }
    })
    .finally(() => {
      pendingSaveCount -= 1;
      if (pendingSaveCount === 0) {
        isSaving = false;
        renderControls();
      }
    });

  return saveQueue;
}

function removeTeam(teamId) {
  if (mode !== "streamer" || state.removed.includes(teamId)) {
    return;
  }

  state.removed.unshift(teamId);
  updateTile(teamId);
  renderControls();
  void saveState();
}

function restoreTeam(teamId) {
  if (mode !== "streamer" || !state.removed.includes(teamId)) {
    return;
  }

  state.removed = state.removed.filter((id) => id !== teamId);
  updateTile(teamId);
  renderControls();
  void saveState();
}

function toggleTeam(teamId) {
  if (isMasked(teamId)) {
    restoreTeam(teamId);
    return;
  }

  removeTeam(teamId);
}

function undoLastRemoved() {
  if (mode !== "streamer" || state.removed.length === 0) {
    return;
  }

  const restoredTeamId = state.removed[0];
  state.removed.shift();
  updateTile(restoredTeamId);
  renderControls();
  void saveState();
}

function resetBoard() {
  if (mode !== "streamer") {
    return;
  }

  const teamIdsToRestore = [...state.removed];
  state.removed = [];
  teamIdsToRestore.forEach((teamId) => updateTile(teamId));
  renderControls();
  void saveState();
}

function buildTile(team) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "team-tile";
  button.dataset.teamId = team.id;
  button.disabled = mode !== "streamer";
  button.setAttribute("aria-label", `Masquer ${team.label}`);
  button.innerHTML = `
    <span class="team-tile__inner">
      <img src="${team.logo}" alt="${team.label}" loading="eager" />
    </span>
  `;

  if (mode === "streamer") {
    button.addEventListener("click", () => toggleTeam(team.id));
  }

  return button;
}

function updateTile(teamId) {
  const tile = teamsRoot.querySelector(`[data-team-id="${teamId}"]`);
  if (!tile) {
    return;
  }

  const masked = isMasked(teamId);
  tile.classList.toggle("team-tile--masked", masked);
  tile.setAttribute("aria-label", masked ? "Reafficher l'equipe" : "Masquer l'equipe");
}

function applyStateDiff(previousState, nextState) {
  const previousRemoved = new Set(previousState.removed);
  const nextRemoved = new Set(nextState.removed);
  const changedTeamIds = new Set();

  previousRemoved.forEach((teamId) => {
    if (!nextRemoved.has(teamId)) {
      changedTeamIds.add(teamId);
    }
  });

  nextRemoved.forEach((teamId) => {
    if (!previousRemoved.has(teamId)) {
      changedTeamIds.add(teamId);
    }
  });

  changedTeamIds.forEach((teamId) => updateTile(teamId));
}

function renderControls() {
  if (remainingCount) {
    remainingCount.textContent = String(teams.length - state.removed.length);
  }

  if (undoButton) {
    undoButton.disabled = mode !== "streamer" || state.removed.length === 0 || isSaving;
  }

  if (resetButton) {
    resetButton.disabled = mode !== "streamer" || isSaving;
  }
}

function computeRowSizes(total) {
  // Répartit les équipes en rangées de ~8 max, équilibrées.
  // 30 -> [8,8,7,7], 32 -> [8,8,8,8], 33 -> [9,8,8,8] ou [8,8,8,8,1] ?
  // On vise 4 rangées, sinon 5. Toujours équilibré à ±1.
  if (total <= 0) return [];
  const rowCount = total <= 32 ? 4 : 5;
  const base = Math.floor(total / rowCount);
  const remainder = total % rowCount;
  return Array.from({ length: rowCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

function renderBoard() {
  teamsRoot.replaceChildren();
  const rowSizes = computeRowSizes(teams.length);
  const maxRow = Math.max(...rowSizes, 1);
  let startIndex = 0;

  rowSizes.forEach((size) => {
    const row = document.createElement("div");
    row.className = "teams__row" + (size < maxRow ? " teams__row--short" : "");
    row.dataset.size = String(size);
    row.style.setProperty("--row-size", String(size));
    row.style.setProperty("--row-max", String(maxRow));
    const rowTeams = teams.slice(startIndex, startIndex + size);

    rowTeams.forEach((team) => row.appendChild(buildTile(team)));
    teamsRoot.appendChild(row);
    startIndex += size;
  });

  teams.forEach((team) => updateTile(team.id));
  boardInitialized = true;
}

function render(force = false) {
  if (force || !boardInitialized) {
    renderBoard();
  }

  renderControls();
}

async function syncState() {
  try {
    const nextState = await fetchState();
    if (JSON.stringify(nextState.removed) === JSON.stringify(state.removed)) {
      return;
    }

    const previousState = state;
    state = nextState;
    if (!boardInitialized) {
      render(true);
      return;
    }

    applyStateDiff(previousState, nextState);
    renderControls();
  } catch (error) {
    console.error(error);
  }
}

function connectStateStream() {
  const stateStream = new EventSource(AppSport.buildApiUrl("./api/state/stream"));

  stateStream.onmessage = (event) => {
    try {
      const nextState = sanitizeState(JSON.parse(event.data));
      if (JSON.stringify(nextState.removed) === JSON.stringify(state.removed)) {
        return;
      }

      const previousState = state;
      state = nextState;
      if (!boardInitialized) {
        render(true);
        return;
      }

      applyStateDiff(previousState, nextState);
      renderControls();
    } catch {
      // Ignore invalid stream payloads.
    }
  };

  stateStream.onerror = () => {
    stateStream.close();
    window.setTimeout(connectStateStream, 1500);
  };
}

if (undoButton) {
  undoButton.addEventListener("click", undoLastRemoved);
}

if (resetButton) {
  resetButton.addEventListener("click", resetBoard);
}

window.addEventListener("keydown", (event) => {
  if (mode !== "streamer") {
    return;
  }

  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "r") {
    resetBoard();
  }

  if (key === "z" || key === "u") {
    undoLastRemoved();
  }
});

void (async () => {
  try {
    const sport = await AppSport.loadSport();
    teams = sport.teams;
    document.title = `${sport.label} Break Overlay`;
  } catch (error) {
    console.error("Impossible de charger les equipes:", error);
  }

  try {
    state = await fetchState();
  } catch (error) {
    console.error(error);
  }

  render(true);
  document.body.classList.add("app-ready");
  connectStateStream();
  window.setInterval(() => {
    void syncState();
  }, pollIntervalMs);
})();
