let nbaTeams = [];

const playerCount = 10;
const rounds = 3;
const pollIntervalMs = 15000;
const mode = new URLSearchParams(window.location.search).get("mode") === "display" ? "display" : "streamer";

const playersRoot = document.querySelector("#players");
const teamsRoot = document.querySelector("#teams");
const pickLabel = document.querySelector("#pick-label");
const currentPlayerLabel = document.querySelector("#current-player-label");
const teamsLeftLabel = document.querySelector("#teams-left-label");
const resetButton = document.querySelector("#reset");
const undoButton = document.querySelector("#undo");

let state = createDefaultState();
let isSaving = false;
let saveQueue = Promise.resolve();
let pendingSaveCount = 0;
let playersInitialized = false;
let teamsInitialized = false;

document.body.classList.add(`${mode}-mode`);

function createDefaultParticipants() {
  return Array.from({ length: playerCount }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Spot ${index + 1}`,
    teams: [],
  }));
}

function createDefaultState() {
  return {
    participants: createDefaultParticipants(),
    currentPick: 0,
  };
}

function sanitizeState(candidate) {
  const defaults = createDefaultParticipants();
  const participants = defaults.map((player, index) => {
    const incoming = Array.isArray(candidate?.participants) ? candidate.participants[index] : null;
    return {
      id: player.id,
      name: typeof incoming?.name === "string" && incoming.name.trim() ? incoming.name.trim() : player.name,
      teams: Array.isArray(incoming?.teams) ? incoming.teams.filter((teamId) => typeof teamId === "string").slice(0, rounds) : [],
    };
  });

  const currentPick = Number.isInteger(candidate?.currentPick) ? candidate.currentPick : 0;
  return {
    participants,
    currentPick: Math.max(0, Math.min(currentPick, nbaTeams.length)),
  };
}

function getDraftOrder() {
  const order = [];
  for (let round = 0; round < rounds; round += 1) {
    const roundOrder = Array.from({ length: playerCount }, (_, index) => index);
    if (round % 2 === 1) {
      roundOrder.reverse();
    }
    order.push(...roundOrder);
  }
  return order;
}

const draftOrder = getDraftOrder();

function getAssignedTeamIds(nextState = state) {
  return new Set(nextState.participants.flatMap((participant) => participant.teams));
}

function getCurrentPlayerIndex(nextState = state) {
  if (nextState.currentPick >= draftOrder.length) {
    return -1;
  }
  return draftOrder[nextState.currentPick];
}

function getPlayerByIndex(index) {
  return state.participants[index] || null;
}

async function fetchState() {
  const response = await fetch(AppSport.buildApiUrl("./api/state", { scope: "draft" }), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Impossible de charger l'etat draft (${response.status})`);
  }
  return sanitizeState(await response.json());
}

async function saveState() {
  const snapshot = sanitizeState(state);
  pendingSaveCount += 1;
  isSaving = true;
  renderToolbar();

  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      const response = await fetch(AppSport.buildApiUrl("./api/state", { scope: "draft" }), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });

      if (!response.ok) {
        throw new Error(`Impossible de sauvegarder l'etat draft (${response.status})`);
      }

      const savedState = sanitizeState(await response.json());
      if (JSON.stringify(savedState) !== JSON.stringify(state)) {
        applyIncomingState(savedState);
      }
    })
    .finally(() => {
      pendingSaveCount -= 1;
      if (pendingSaveCount === 0) {
        isSaving = false;
        renderToolbar();
      }
    });

  return saveQueue;
}

function buildPlayerCard(player, index) {
  const card = document.createElement("article");
  card.className = "player-card";
  card.dataset.playerId = player.id;

  const activeClass = getCurrentPlayerIndex() === index ? " player-card--active" : "";
  card.className += activeClass;

  const nameField = mode === "streamer"
    ? `<input class="player-card__name" data-player-name="${player.id}" value="${player.name}" maxlength="24" />`
    : `<input class="player-card__name" value="${player.name}" readonly />`;

  card.innerHTML = `
    <span class="player-card__spot">Spot ${index + 1}</span>
    ${nameField}
    <div class="player-card__teams" data-player-teams="${player.id}"></div>
  `;

  if (mode === "streamer") {
    const input = card.querySelector(`[data-player-name="${player.id}"]`);
    input.addEventListener("change", (event) => {
      const nextName = event.target.value.trim() || `Spot ${index + 1}`;
      state.participants[index].name = nextName;
      renderToolbar();
      void saveState();
    });
  }

  return card;
}

function buildTeamTile(team) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "team-tile";
  button.dataset.teamId = team.id;
  button.innerHTML = `<img src="${team.logo}" alt="${team.label}" loading="eager" />`;
  if (mode === "streamer") {
    button.addEventListener("click", () => assignTeam(team.id));
  } else {
    button.disabled = true;
  }
  return button;
}

function renderPlayerTeams(player) {
  const root = playersRoot.querySelector(`[data-player-teams="${player.id}"]`);
  if (!root) {
    return;
  }

  root.replaceChildren();
  for (let slotIndex = 0; slotIndex < rounds; slotIndex += 1) {
    const slot = document.createElement("div");
    slot.className = "player-card__slot";
    const teamId = player.teams[slotIndex];
    if (teamId) {
      const team = nbaTeams.find((entry) => entry.id === teamId);
      if (team) {
        slot.innerHTML = `<img src="${team.logo}" alt="${team.label}" />`;
      }
    }
    root.appendChild(slot);
  }
}

function updatePlayerCard(index) {
  const player = getPlayerByIndex(index);
  if (!player) {
    return;
  }

  const card = playersRoot.querySelector(`[data-player-id="${player.id}"]`);
  if (!card) {
    return;
  }

  card.classList.toggle("player-card--active", getCurrentPlayerIndex() === index);
  const input = card.querySelector(".player-card__name");
  if (input && input.value !== player.name) {
    input.value = player.name;
  }
  renderPlayerTeams(player);
}

function updateTeamTile(teamId) {
  const tile = teamsRoot.querySelector(`[data-team-id="${teamId}"]`);
  if (!tile) {
    return;
  }
  const taken = getAssignedTeamIds().has(teamId);
  tile.classList.toggle("team-tile--taken", taken);
  tile.disabled = mode !== "streamer" || taken || state.currentPick >= draftOrder.length || isSaving;
}

function renderToolbar() {
  const currentPlayerIndex = getCurrentPlayerIndex();
  const currentPlayer = currentPlayerIndex >= 0 ? getPlayerByIndex(currentPlayerIndex) : null;

  pickLabel.textContent = state.currentPick >= draftOrder.length ? "Draft terminee" : `Pick ${state.currentPick + 1}/30`;
  currentPlayerLabel.textContent = currentPlayer ? currentPlayer.name : "Toutes les equipes sont prises";
  teamsLeftLabel.textContent = `${nbaTeams.length - getAssignedTeamIds().size} restantes`;
  undoButton.disabled = mode !== "streamer" || state.currentPick === 0 || isSaving;
  resetButton.disabled = mode !== "streamer" || isSaving;
}

function renderPlayers(force = false) {
  if (!force && playersInitialized) {
    return;
  }

  playersRoot.replaceChildren();
  state.participants.forEach((player, index) => {
    playersRoot.appendChild(buildPlayerCard(player, index));
  });
  state.participants.forEach((player) => renderPlayerTeams(player));
  playersInitialized = true;
}

function renderTeams(force = false) {
  if (!force && teamsInitialized) {
    return;
  }

  teamsRoot.replaceChildren();
  nbaTeams.forEach((team) => {
    teamsRoot.appendChild(buildTeamTile(team));
  });
  nbaTeams.forEach((team) => updateTeamTile(team.id));
  teamsInitialized = true;
}

function render(force = false) {
  renderPlayers(force);
  renderTeams(force);
  state.participants.forEach((_, index) => updatePlayerCard(index));
  nbaTeams.forEach((team) => updateTeamTile(team.id));
  renderToolbar();
}

function assignTeam(teamId) {
  if (mode !== "streamer" || isSaving || getAssignedTeamIds().has(teamId)) {
    return;
  }

  const playerIndex = getCurrentPlayerIndex();
  if (playerIndex < 0) {
    return;
  }

  const previousState = structuredClone(state);
  state.participants[playerIndex].teams.push(teamId);
  state.currentPick += 1;
  applyStateDiff(previousState, state);
  void saveState();
}

function undoPick() {
  if (mode !== "streamer" || isSaving || state.currentPick === 0) {
    return;
  }

  const previousState = structuredClone(state);
  const lastPickIndex = state.currentPick - 1;
  const playerIndex = draftOrder[lastPickIndex];
  state.participants[playerIndex].teams.pop();
  state.currentPick = lastPickIndex;
  applyStateDiff(previousState, state);
  void saveState();
}

function resetDraft() {
  if (mode !== "streamer" || isSaving) {
    return;
  }

  const previousState = structuredClone(state);
  state = createDefaultState();
  state.participants = previousState.participants.map((player, index) => ({
    ...state.participants[index],
    name: player.name,
  }));
  applyStateDiff(previousState, state);
  void saveState();
}

function applyStateDiff(previousState, nextState) {
  const previousAssigned = getAssignedTeamIds(previousState);
  const nextAssigned = getAssignedTeamIds(nextState);
  const changedTeams = new Set();

  previousAssigned.forEach((teamId) => {
    if (!nextAssigned.has(teamId)) {
      changedTeams.add(teamId);
    }
  });

  nextAssigned.forEach((teamId) => {
    if (!previousAssigned.has(teamId)) {
      changedTeams.add(teamId);
    }
  });

  changedTeams.forEach((teamId) => updateTeamTile(teamId));
  previousState.participants.forEach((_, index) => updatePlayerCard(index));
  nextState.participants.forEach((_, index) => updatePlayerCard(index));
  renderToolbar();
}

function applyIncomingState(nextState) {
  const previousState = structuredClone(state);
  state = sanitizeState(nextState);
  if (!playersInitialized || !teamsInitialized) {
    render(true);
    return;
  }
  applyStateDiff(previousState, state);
}

async function syncState() {
  try {
    const nextState = await fetchState();
    if (JSON.stringify(nextState) === JSON.stringify(state)) {
      return;
    }
    applyIncomingState(nextState);
  } catch (error) {
    console.error(error);
  }
}

function connectStateStream() {
  const stateStream = new EventSource(AppSport.buildApiUrl("./api/state/stream", { scope: "draft" }));
  stateStream.onmessage = (event) => {
    try {
      const nextState = sanitizeState(JSON.parse(event.data));
      if (JSON.stringify(nextState) === JSON.stringify(state)) {
        return;
      }
      applyIncomingState(nextState);
    } catch {
      // Ignore invalid payloads.
    }
  };

  stateStream.onerror = () => {
    stateStream.close();
    window.setTimeout(connectStateStream, 1500);
  };
}

undoButton.addEventListener("click", undoPick);
resetButton.addEventListener("click", resetDraft);

window.addEventListener("keydown", (event) => {
  if (mode !== "streamer") {
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "r") {
    resetDraft();
  }
  if (key === "z" || key === "u") {
    undoPick();
  }
});

void (async () => {
  try {
    const sport = await AppSport.loadSport();
    nbaTeams = sport.teams;
    document.title = `${sport.label} Draft Break`;
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
