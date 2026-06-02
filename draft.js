let nbaTeams = [];
let sport = null;

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
const showRecapButton = document.querySelector("#show-recap");
const hideRecapButton = document.querySelector("#hide-recap");
const clearParticipantsButton = document.querySelector("#clear-participants");

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
    recapVisible: false,
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
    recapVisible: candidate?.recapVisible === true,
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

function renderPlayerTeams(player, freshSlotIndex = -1) {
  const root = playersRoot.querySelector(`[data-player-teams="${player.id}"]`);
  if (!root) {
    return;
  }

  // Reconstruit seulement si le nombre/contenu a change, sinon on garde le DOM
  // pour eviter de relancer l'animation de tous les slots existants.
  const existing = root.children;
  const sameLength = existing.length === rounds;
  let sameContent = sameLength;
  if (sameLength) {
    for (let i = 0; i < rounds; i += 1) {
      const dom = existing[i]?.dataset?.teamId || "";
      const next = player.teams[i] || "";
      if (dom !== next) { sameContent = false; break; }
    }
  }
  if (sameContent && freshSlotIndex < 0) return;

  root.replaceChildren();
  for (let slotIndex = 0; slotIndex < rounds; slotIndex += 1) {
    const slot = document.createElement("div");
    slot.className = "player-card__slot";
    const teamId = player.teams[slotIndex];
    slot.dataset.teamId = teamId || "";
    if (teamId) {
      const team = nbaTeams.find((entry) => entry.id === teamId);
      if (team) {
        slot.innerHTML = `<img src="${team.logo}" alt="${team.label}" />`;
        if (slotIndex === freshSlotIndex) {
          slot.classList.add("player-card__slot--fresh");
        }
      }
    }
    root.appendChild(slot);
  }
}

function updatePlayerCard(index, freshSlotIndex = -1) {
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
  renderPlayerTeams(player, freshSlotIndex);
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
  const isComplete = state.currentPick >= draftOrder.length;
  if (showRecapButton) {
    showRecapButton.hidden = mode !== "streamer" || !isComplete || state.recapVisible;
    showRecapButton.disabled = mode !== "streamer" || isSaving;
  }
  if (hideRecapButton) {
    hideRecapButton.hidden = mode !== "streamer" || !state.recapVisible;
    hideRecapButton.disabled = mode !== "streamer" || isSaving;
  }
  if (clearParticipantsButton) {
    clearParticipantsButton.hidden = mode !== "streamer";
    clearParticipantsButton.disabled = mode !== "streamer" || isSaving;
  }
}

function updateRecap() {
  const overlay = document.querySelector("#recap");
  if (!overlay) return;
  const isComplete = state.currentPick >= draftOrder.length;
  const visible = state.recapVisible && isComplete && mode === "display";
  document.body.classList.toggle("recap-on", visible);
  if (!visible) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  const titleEl = overlay.querySelector("#recap-title");
  if (titleEl) titleEl.textContent = (sport?.label || "").toUpperCase() + " — Draft";
  const grid = overlay.querySelector("#recap-grid");
  grid.replaceChildren();
  state.participants.forEach((player, index) => {
    const card = document.createElement("article");
    card.className = "recap-card";
    card.style.animationDelay = `${120 + index * 60}ms`;
    const teamsHtml = Array.from({ length: rounds }, (_, slotIdx) => {
      const teamId = player.teams[slotIdx];
      const team = teamId ? nbaTeams.find((t) => t.id === teamId) : null;
      if (team) {
        return `<div class="recap-card__team"><img src="${team.logo}" alt="${team.label}" /></div>`;
      }
      return `<div class="recap-card__team recap-card__team--empty"></div>`;
    }).join("");
    card.innerHTML = `
      <div class="recap-card__head">
        <span class="recap-card__spot">Spot ${index + 1}</span>
      </div>
      <div class="recap-card__player">${player.name}</div>
      <div class="recap-card__teams" style="margin-top:10px">${teamsHtml}</div>
    `;
    grid.appendChild(card);
  });
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
  updateRecap();
}

function clearParticipants() {
  if (mode !== "streamer" || isSaving) return;
  if (state.currentPick > 0) {
    if (!window.confirm("La draft est en cours. Vider tous les noms quand meme ?")) return;
  }
  state.participants.forEach((player, index) => {
    player.name = `Spot ${index + 1}`;
  });
  render(true);
  void saveState();
}

function showRecap() {
  if (mode !== "streamer" || isSaving) return;
  if (state.currentPick < draftOrder.length) return;
  state.recapVisible = true;
  render(false);
  void saveState();
}

function hideRecap() {
  if (mode !== "streamer" || isSaving) return;
  state.recapVisible = false;
  render(false);
  void saveState();
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
  // Detecte pour chaque player si un nouveau slot a ete attribue (next.teams.length > prev.teams.length)
  // -> on passe cet index a updatePlayerCard pour declencher l'animation flip.
  previousState.participants.forEach((_, index) => updatePlayerCard(index));
  let freshPick = null;
  nextState.participants.forEach((p, index) => {
    const prev = previousState.participants[index];
    const prevLen = prev?.teams?.length || 0;
    const nextLen = p.teams.length;
    const freshSlot = (nextLen > prevLen) ? nextLen - 1 : -1;
    updatePlayerCard(index, freshSlot);
    if (freshSlot >= 0 && !freshPick) {
      freshPick = { player: p, slotIndex: freshSlot, teamId: p.teams[freshSlot] };
    }
  });
  renderToolbar();
  updateRecap();

  // En mode display, declenche le cinematic plein ecran quand un nouveau pick arrive
  if (mode === "display" && freshPick && freshPick.teamId) {
    const team = nbaTeams.find((t) => t.id === freshPick.teamId);
    if (team) {
      const pickNumber = nextState.currentPick; // 1-indexed (le pick qu'on vient de faire)
      void playCinematic({
        eyebrow: `Pick ${pickNumber} — Round ${freshPick.slotIndex + 1}`,
        logo: team.logo,
        label: team.label,
        player: freshPick.player.name,
      });
    }
  }
}

// Animation cinematique plein ecran. Voir tokens.css pour le style.
function playCinematic({ eyebrow = "", logo = "", label = "", player = "", duration = 3500 } = {}) {
  return new Promise((resolve) => {
    const overlay = document.querySelector("#cinematic");
    if (!overlay) { resolve(); return; }
    const eyebrowEl = overlay.querySelector("#cinematic-eyebrow");
    const logoEl = overlay.querySelector("#cinematic-logo");
    const labelEl = overlay.querySelector("#cinematic-label");
    const playerEl = overlay.querySelector("#cinematic-player");

    eyebrowEl.textContent = eyebrow;
    labelEl.textContent = label;
    playerEl.textContent = player;
    if (logo) {
      logoEl.src = logo;
      logoEl.alt = label;
      logoEl.hidden = false;
    } else {
      logoEl.hidden = true;
      logoEl.removeAttribute("src");
    }

    overlay.removeAttribute("data-state");
    overlay.hidden = true;
    void overlay.offsetWidth;
    overlay.hidden = false;

    setTimeout(() => {
      overlay.dataset.state = "leaving";
      setTimeout(() => {
        overlay.hidden = true;
        overlay.removeAttribute("data-state");
        resolve();
      }, 400);
    }, duration - 400);
  });
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
showRecapButton?.addEventListener("click", showRecap);
hideRecapButton?.addEventListener("click", hideRecap);
clearParticipantsButton?.addEventListener("click", clearParticipants);
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
    sport = await AppSport.loadSport();
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
