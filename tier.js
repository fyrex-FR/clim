const searchParams = new URLSearchParams(window.location.search);
const mode = searchParams.get("mode") === "display" ? "display" : "streamer";
const explicitSession = searchParams.get("session") || AppSport.getSessionId();
const scope = "tier";
const pollIntervalMs = 15000;
const tierOrder = [3, 2, 1];

const phaseLabel = document.querySelector("#phase-label");
const nextDrawLabel = document.querySelector("#next-draw-label");
const templateSelect = document.querySelector("#template-select");
const drawNextButton = document.querySelector("#draw-next");
const startDrawButton = document.querySelector("#start-draw");
const showRecapButton = document.querySelector("#show-recap");
const hideRecapButton = document.querySelector("#hide-recap");
const undoButton = document.querySelector("#undo");
const resetButton = document.querySelector("#reset");
const exportCsvButton = document.querySelector("#export-csv");
const clearParticipantsButton = document.querySelector("#clear-participants");
const spotsSummary = document.querySelector("#spots-summary");
const teamsSummary = document.querySelector("#teams-summary");
const slotsGrid = document.querySelector("#slots-grid");
const participantsList = document.querySelector("#participants-list");
const tiersGrid = document.querySelector("#tiers-grid");
const drawStage = document.querySelector("#draw-stage");
const drawStageMeta = document.querySelector("#draw-stage-meta");
const drawStageLabel = document.querySelector("#draw-stage-label");
const drawWheel = document.querySelector("#draw-wheel");
const drawWheelHubMeta = document.querySelector("#draw-wheel-hub-meta");
const drawWheelHubLabel = document.querySelector("#draw-wheel-hub-label");

let sport = null;
let templates = {};
let state = createDefaultState();
let isSaving = false;
let isAnimating = false;
let saveQueue = Promise.resolve();
let pendingSaveCount = 0;
let initialized = false;
let activePulseNodes = new Set();
let pendingIncomingState = null;
let animationQueue = Promise.resolve();
let wheelSignature = "";
let wheelNodes = new Map();

document.body.classList.add(`${mode}-mode`);
if (searchParams.get("preview") === "1") {
  document.body.classList.add("preview-mode");
}

function buildStateUrl() {
  const url = new URL("./api/state", window.location.href);
  url.searchParams.set("scope", scope);
  if (explicitSession) {
    url.searchParams.set("session", explicitSession);
  }
  return url.toString();
}

function buildStreamUrl() {
  const url = new URL("./api/state/stream", window.location.href);
  url.searchParams.set("scope", scope);
  if (explicitSession) {
    url.searchParams.set("session", explicitSession);
  }
  return url.toString();
}

function buildAnimationUrl() {
  const url = new URL("./api/tier-animation", window.location.href);
  url.searchParams.set("scope", scope);
  if (explicitSession) {
    url.searchParams.set("session", explicitSession);
  }
  return url.toString();
}

function createDefaultState() {
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

function sanitizeState(candidate) {
  const defaults = createDefaultState();
  return {
    templateId: typeof candidate?.templateId === "string" && candidate.templateId.trim() ? candidate.templateId.trim() : defaults.templateId,
    started: candidate?.started === true,
    recapVisible: candidate?.recapVisible === true,
    participants: defaults.participants.map((player, index) => {
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
    }),
    history: Array.isArray(candidate?.history) ? candidate.history.filter((entry) => entry && typeof entry.type === "string").slice(-80) : [],
  };
}

function getAssignedSpotCount(nextState = state) {
  return nextState.participants.filter((player) => player.slotNumber !== null).length;
}

function getAssignedTeamIds(nextState = state) {
  return new Set(
    nextState.participants.flatMap((player) => [player.teams[1], player.teams[2], player.teams[3]].filter(Boolean)),
  );
}

function getAssignedTeamCount(nextState = state) {
  return getAssignedTeamIds(nextState).size;
}

function getParticipantById(playerId, nextState = state) {
  return nextState.participants.find((player) => player.id === playerId) || null;
}

function getParticipantBySlot(slotNumber, nextState = state) {
  return nextState.participants.find((player) => player.slotNumber === slotNumber) || null;
}

function getCurrentTemplate() {
  return templates[state.templateId] || null;
}

function getRemainingSpotCandidates(nextState = state) {
  return nextState.participants.filter((player) => player.slotNumber === null);
}

function getDrawPhase(nextState = state) {
  if (!nextState.started) {
    return "waiting";
  }
  if (getAssignedSpotCount(nextState) < 10) {
    return "spots";
  }
  if (getAssignedTeamCount(nextState) < 30) {
    return "teams";
  }
  return "complete";
}

function getNextTeamStep(nextState = state) {
  const assignedTeamCount = getAssignedTeamCount(nextState);
  if (assignedTeamCount >= 30) {
    return null;
  }
  const tier = tierOrder[Math.floor(assignedTeamCount / 10)];
  const slotNumber = (assignedTeamCount % 10) + 1;
  return { tier, slotNumber };
}

function getRemainingTeamIds(nextState = state) {
  const template = templates[nextState.templateId] || null;
  const nextStep = getNextTeamStep(nextState);
  if (!template || !nextStep) {
    return [];
  }
  const assignedTeams = getAssignedTeamIds(nextState);
  return (template.tiers?.[nextStep.tier] || []).filter((teamId) => !assignedTeams.has(teamId));
}

function getTeam(teamId) {
  return sport?.teams?.find((team) => team.id === teamId) || null;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildWheelData(nextState = state) {
  const phase = getDrawPhase(nextState);
  if (phase === "spots") {
    return {
      phase,
      meta: "Tirage des spots",
      label: `Spot ${getAssignedSpotCount(nextState) + 1}`,
      hubMeta: "Spot",
      hubLabel: `${getAssignedSpotCount(nextState) + 1}`,
      items: getRemainingSpotCandidates(nextState).map((player) => ({
        id: player.id,
        label: player.name,
      })),
    };
  }

  if (phase === "teams") {
    const nextStep = getNextTeamStep(nextState);
    if (!nextStep) {
      return null;
    }
    return {
      phase,
      meta: `Tirage tier ${nextStep.tier}`,
      label: `Spot ${nextStep.slotNumber}`,
      hubMeta: `Tier ${nextStep.tier}`,
      hubLabel: `Spot ${nextStep.slotNumber}`,
      items: getRemainingTeamIds(nextState).map((teamId) => {
        const team = getTeam(teamId);
        return team ? {
          id: team.id,
          label: team.label,
          logo: team.logo,
        } : null;
      }).filter(Boolean),
    };
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadConfigs() {
  const [sports, templateMap] = await Promise.all([
    fetchJson("./api/config/sports"),
    fetchJson("./api/config/tier-templates"),
  ]);
  sport = sports[AppSport.id] || sports.nba;
  document.title = `${sport.label} Tier Break`;
  templates = templateMap;
}

async function fetchState() {
  return sanitizeState(await fetchJson(buildStateUrl()));
}

async function saveState() {
  const snapshot = sanitizeState(state);
  pendingSaveCount += 1;
  isSaving = true;
  updateToolbar();

  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      const response = await fetch(buildStateUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!response.ok) {
        throw new Error(`Save failed: ${response.status}`);
      }
      state = sanitizeState(await response.json());
    })
    .finally(() => {
      pendingSaveCount -= 1;
      if (pendingSaveCount === 0) {
        isSaving = false;
        render();
      }
    });

  return saveQueue;
}

function buildParticipantRow(player, index) {
  const row = document.createElement("div");
  row.className = "participant-row";
  row.dataset.playerId = player.id;
  row.innerHTML = `
    <span class="participant-row__spot">${player.slotNumber ? `Spot ${player.slotNumber}` : "A tirer"}</span>
    <input class="participant-row__name" value="${player.name}" ${mode === "display" ? "readonly" : ""} />
  `;
  if (mode === "streamer") {
    row.querySelector(".participant-row__name").addEventListener("change", (event) => {
      state.participants[index].name = event.target.value.trim() || `Spot ${index + 1}`;
      render();
      void saveState();
    });
  }
  return row;
}

function buildSlotCard(slotNumber) {
  const card = document.createElement("article");
  card.className = "slot-card";
  card.dataset.slotNumber = String(slotNumber);
  card.innerHTML = `
    <span class="slot-card__label">Spot ${slotNumber}</span>
    <strong class="slot-card__player">A tirer</strong>
    <div class="slot-card__teams">
      <div class="slot-card__team" data-tier-slot="1"></div>
      <div class="slot-card__team" data-tier-slot="2"></div>
      <div class="slot-card__team" data-tier-slot="3"></div>
    </div>
  `;
  return card;
}

function buildTierColumn(tierNumber) {
  const template = getCurrentTemplate();
  const column = document.createElement("section");
  column.className = "tier-column";
  column.dataset.tierNumber = String(tierNumber);
  column.innerHTML = `
    <div class="tier-column__head">
      <strong>Tier ${tierNumber}</strong>
    </div>
    <div class="tier-column__teams"></div>
  `;

  const teamsRoot = column.querySelector(".tier-column__teams");
  const teamIds = template?.tiers?.[tierNumber] || [];
  teamIds.forEach((teamId) => {
    const team = getTeam(teamId);
    if (!team) {
      return;
    }
    const tile = document.createElement("div");
    tile.className = "team-tile";
    tile.dataset.teamId = team.id;
    tile.innerHTML = `<img src="${team.logo}" alt="${team.label}" />`;
    teamsRoot.appendChild(tile);
  });

  return column;
}

function initializeBoard() {
  if (initialized) {
    return;
  }

  slotsGrid.replaceChildren();
  for (let slotNumber = 1; slotNumber <= 10; slotNumber += 1) {
    slotsGrid.appendChild(buildSlotCard(slotNumber));
  }

  participantsList.replaceChildren();
  state.participants.forEach((player, index) => {
    participantsList.appendChild(buildParticipantRow(player, index));
  });

  renderTemplateSelect();
  renderTierColumns();
  initialized = true;
}

function renderTemplateSelect() {
  templateSelect.replaceChildren();
  Object.values(templates)
    .filter((template) => !template.sport || template.sport === AppSport.id)
    .forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.label;
      option.selected = template.id === state.templateId;
      templateSelect.appendChild(option);
    });
}

function renderTierColumns() {
  tiersGrid.replaceChildren();
  for (const tierNumber of [1, 2, 3]) {
    tiersGrid.appendChild(buildTierColumn(tierNumber));
  }
}

function getRevealParts() {
  if (!drawWheel) return null;
  return {
    card: drawWheel,
    placeholder: drawWheel.querySelector(".draw-reveal__placeholder"),
    content: drawWheel.querySelector(".draw-reveal__content"),
    logo: drawWheel.querySelector(".draw-reveal__logo"),
    label: drawWheel.querySelector(".draw-reveal__label"),
  };
}

function resetReveal() {
  const parts = getRevealParts();
  if (!parts) return;
  parts.card.dataset.state = "idle";
  parts.placeholder.hidden = false;
  parts.content.hidden = true;
  parts.logo.hidden = true;
  parts.logo.removeAttribute("src");
  parts.label.textContent = "";
}

function ensureWheel(data) {
  if (!drawStage || !drawWheel || !data) return;
  const signature = JSON.stringify({
    meta: data.meta,
    label: data.label,
    hubMeta: data.hubMeta,
    hubLabel: data.hubLabel,
    ids: data.items.map((item) => item.id),
  });
  if (signature === wheelSignature) return;
  wheelSignature = signature;
  resetReveal();
}

function setWheelState(_activeId = null, _winnerId = null) {
  // intentionally a no-op: the reveal animation is driven by playReveal()
}

function showRevealWinner(item) {
  const parts = getRevealParts();
  if (!parts || !item) return;
  parts.placeholder.hidden = true;
  parts.content.hidden = false;
  if (item.logo) {
    parts.logo.hidden = false;
    parts.logo.src = item.logo;
    parts.logo.alt = item.label;
  } else {
    parts.logo.hidden = true;
    parts.logo.removeAttribute("src");
  }
  parts.label.textContent = item.label;
  parts.card.dataset.state = "winner";
}

function playReveal(item, { rolling = 1100 } = {}) {
  return new Promise((resolve) => {
    const parts = getRevealParts();
    if (!parts || !item) {
      resolve();
      return;
    }
    parts.placeholder.hidden = false;
    parts.placeholder.textContent = "Tirage en cours...";
    parts.content.hidden = true;
    parts.card.dataset.state = "rolling";
    setTimeout(() => {
      showRevealWinner(item);
      resolve();
    }, rolling);
  });
}

// Animation cinematique plein ecran pour la revelation des equipes en mode display.
// Affiche : eyebrow ("Tier X - Spot Y"), logo flip 3D + glow + particules, nom equipe, pseudo gagnant.
// Reste affichee ~3.5s puis fade-out.
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

    // Force un reflow pour que les animations CSS redemarrent meme si l'overlay etait deja monte
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

function updateRecap() {
  const overlay = document.querySelector("#recap");
  if (!overlay) return;
  const visible = state.recapVisible && getDrawPhase() === "complete" && mode === "display";
  document.body.classList.toggle("recap-on", visible);
  if (!visible) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  const titleEl = overlay.querySelector("#recap-title");
  if (titleEl) titleEl.textContent = (sport?.label || "").toUpperCase() + " — Tier Break";

  const grid = overlay.querySelector("#recap-grid");
  grid.replaceChildren();
  for (let slotNumber = 1; slotNumber <= 10; slotNumber += 1) {
    const player = getParticipantBySlot(slotNumber);
    const card = document.createElement("article");
    card.className = "recap-card";
    card.style.animationDelay = `${120 + slotNumber * 60}ms`;
    const teamsHtml = [1, 2, 3].map((tier) => {
      const teamId = player?.teams?.[tier];
      const team = teamId ? getTeam(teamId) : null;
      if (team) {
        return `<div class="recap-card__team"><img src="${team.logo}" alt="${team.label}" /></div>`;
      }
      return `<div class="recap-card__team recap-card__team--empty"></div>`;
    }).join("");
    card.innerHTML = `
      <div class="recap-card__head">
        <span class="recap-card__spot">Spot ${slotNumber}</span>
      </div>
      <div class="recap-card__player">${player?.name || "—"}</div>
      <div class="recap-card__teams" style="margin-top:10px">${teamsHtml}</div>
    `;
    grid.appendChild(card);
  }
}

function updateDrawStage(data = buildWheelData()) {
  if (!drawStage) {
    return;
  }
  if (mode !== "display" || !data || data.items.length === 0 || getDrawPhase() === "complete") {
    drawStage.hidden = true;
    wheelSignature = "";
    resetReveal();
    return;
  }

  drawStage.hidden = false;
  drawStageMeta.textContent = data.meta;
  drawStageLabel.textContent = data.label;
  drawWheelHubMeta.textContent = data.hubMeta;
  drawWheelHubLabel.textContent = data.hubLabel;
  ensureWheel(data);
  setWheelState();
}

function updateSlots() {
  for (let slotNumber = 1; slotNumber <= 10; slotNumber += 1) {
    const card = slotsGrid.querySelector(`[data-slot-number="${slotNumber}"]`);
    const player = getParticipantBySlot(slotNumber);
    const nameNode = card.querySelector(".slot-card__player");
    nameNode.textContent = player ? player.name : "A tirer";

    [1, 2, 3].forEach((tierNumber) => {
      const slot = card.querySelector(`[data-tier-slot="${tierNumber}"]`);
      const teamId = player?.teams?.[tierNumber];
      const currentTeamId = slot.dataset.teamId || "";
      const nextTeamId = teamId || "";
      if (currentTeamId === nextTeamId) {
        // Pas de changement, on touche pas au DOM (et donc pas de re-animation)
        return;
      }
      slot.replaceChildren();
      slot.classList.remove("slot-card__team--fresh");
      if (teamId) {
        const team = getTeam(teamId);
        if (team) {
          slot.innerHTML = `<img src="${team.logo}" alt="${team.label}" />`;
          // Si le slot etait vide avant -> animation flip
          if (!currentTeamId) {
            slot.classList.add("slot-card__team--fresh");
          }
        }
      }
      slot.dataset.teamId = nextTeamId;
    });
  }
}

function updateParticipants() {
  state.participants.forEach((player) => {
    const row = participantsList.querySelector(`[data-player-id="${player.id}"]`);
    if (!row) {
      return;
    }
    row.querySelector(".participant-row__spot").textContent = player.slotNumber ? `Spot ${player.slotNumber}` : "A tirer";
    const input = row.querySelector(".participant-row__name");
    if (input.value !== player.name) {
      input.value = player.name;
    }
  });
}

function updateTierTables() {
  const assignedTeams = getAssignedTeamIds();
  tiersGrid.querySelectorAll(".team-tile").forEach((tile) => {
    tile.classList.toggle("team-tile--taken", assignedTeams.has(tile.dataset.teamId));
  });
}

function updateToolbar() {
  const phase = getDrawPhase();
  const assignedSpots = getAssignedSpotCount();
  const assignedTeams = getAssignedTeamCount();
  const nextTeamStep = getNextTeamStep();

  if (phase === "waiting") {
    phaseLabel.textContent = "En attente";
    nextDrawLabel.textContent = "Cliquer sur Demarrer le tirage";
    drawNextButton.textContent = "Tirer";
  } else if (phase === "spots") {
    phaseLabel.textContent = "Tirage des spots";
    nextDrawLabel.textContent = `Tirer le spot ${assignedSpots + 1}`;
    drawNextButton.textContent = `Tirer spot ${assignedSpots + 1}`;
  } else if (phase === "teams" && nextTeamStep) {
    phaseLabel.textContent = `Tirage tier ${nextTeamStep.tier}`;
    nextDrawLabel.textContent = `Spot ${nextTeamStep.slotNumber} - Tier ${nextTeamStep.tier}`;
    drawNextButton.textContent = `Tirer tier ${nextTeamStep.tier}`;
  } else {
    phaseLabel.textContent = "Tier break termine";
    nextDrawLabel.textContent = "Toutes les equipes sont attribuees";
    drawNextButton.textContent = "Termine";
  }

  spotsSummary.textContent = `${assignedSpots} / 10 tires`;
  teamsSummary.textContent = `${30 - assignedTeams} equipes dispo`;

  const teamDrawStarted = assignedTeams > 0;
  // Lock du template dès que le break a démarré (pour éviter de changer en plein milieu)
  templateSelect.disabled = mode !== "streamer" || isSaving || isAnimating || state.started;
  drawNextButton.disabled = mode !== "streamer" || isSaving || isAnimating || phase === "complete" || phase === "waiting";
  drawNextButton.hidden = phase === "waiting" || phase === "complete";
  if (startDrawButton) {
    startDrawButton.hidden = mode !== "streamer" || phase !== "waiting";
    startDrawButton.disabled = mode !== "streamer" || isSaving || isAnimating;
  }
  if (showRecapButton) {
    showRecapButton.hidden = mode !== "streamer" || phase !== "complete" || state.recapVisible;
    showRecapButton.disabled = mode !== "streamer" || isSaving || isAnimating;
  }
  if (hideRecapButton) {
    hideRecapButton.hidden = mode !== "streamer" || !state.recapVisible;
    hideRecapButton.disabled = mode !== "streamer" || isSaving;
  }
  undoButton.disabled = mode !== "streamer" || isSaving || isAnimating || state.history.length === 0;
  resetButton.disabled = mode !== "streamer" || isSaving || isAnimating;
  if (exportCsvButton) {
    exportCsvButton.disabled = mode !== "streamer";
    exportCsvButton.hidden = mode !== "streamer";
  }
  if (clearParticipantsButton) {
    clearParticipantsButton.hidden = mode !== "streamer";
    clearParticipantsButton.disabled = mode !== "streamer" || isSaving || isAnimating;
  }
}

function updatePhaseClass() {
  document.body.classList.remove("phase-waiting", "phase-spots", "phase-teams", "phase-complete");
  document.body.classList.add(`phase-${getDrawPhase()}`);
}

function render(forceTemplate = false) {
  initializeBoard();
  if (forceTemplate) {
    renderTemplateSelect();
    renderTierColumns();
  }
  updateSlots();
  updateParticipants();
  updateTierTables();
  updateToolbar();
  updatePhaseClass();
  updateDrawStage();
  updateRecap();
}

function assignNextSpot() {
  const remainingParticipants = state.participants.filter((player) => player.slotNumber === null);
  if (remainingParticipants.length === 0) {
    return;
  }
  const player = randomItem(remainingParticipants);
  const slotNumber = getAssignedSpotCount() + 1;
  player.slotNumber = slotNumber;
  state.history.push({ type: "spot", playerId: player.id, slotNumber });
}

function assignNextTierTeam() {
  const template = getCurrentTemplate();
  const nextStep = getNextTeamStep();
  if (!template || !nextStep) {
    return;
  }
  const assignedTeams = getAssignedTeamIds();
  const remainingTeams = (template.tiers?.[nextStep.tier] || []).filter((teamId) => !assignedTeams.has(teamId));
  const teamId = randomItem(remainingTeams);
  const player = getParticipantBySlot(nextStep.slotNumber);
  if (!player || !teamId) {
    return;
  }
  player.teams[nextStep.tier] = teamId;
  state.history.push({
    type: "team",
    playerId: player.id,
    slotNumber: nextStep.slotNumber,
    tier: nextStep.tier,
    teamId,
  });
}

function clearPulseState() {
  for (const node of activePulseNodes) {
    node.classList.remove("participant-row--pulse", "slot-card--pulse", "team-tile--pulse");
  }
  activePulseNodes.clear();
}

function setPulseState(...nodes) {
  clearPulseState();
  nodes.filter(Boolean).forEach((node) => {
    if (node.classList.contains("participant-row")) {
      node.classList.add("participant-row--pulse");
    } else if (node.classList.contains("slot-card")) {
      node.classList.add("slot-card--pulse");
    } else if (node.classList.contains("team-tile")) {
      node.classList.add("team-tile--pulse");
    }
    activePulseNodes.add(node);
  });
}

async function playSpotAnimation(animation) {
  if (mode === "display") {
    const data = {
      phase: "spots",
      meta: "Tirage des spots",
      label: `Spot ${animation.targetSlotNumber}`,
      hubMeta: "Spot",
      hubLabel: `${animation.targetSlotNumber}`,
      items: animation.candidatePlayerIds.map((playerId) => {
        const player = getParticipantById(playerId);
        return player ? { id: player.id, label: player.name } : null;
      }).filter(Boolean),
    };
    updateDrawStage(data);
    const winner = getParticipantById(animation.winnerPlayerId);
    await playReveal(winner ? { id: winner.id, label: winner.name } : null);
    await sleep(420);
    return;
  }

  const targetSlotNumber = animation.targetSlotNumber;
  const targetSlotCard = slotsGrid.querySelector(`[data-slot-number="${targetSlotNumber}"]`);
  const candidateRows = animation.candidatePlayerIds
    .map((playerId) => participantsList.querySelector(`[data-player-id="${playerId}"]`))
    .filter(Boolean);

  const stepCount = mode === "display" ? 10 : 16;
  const baseDelay = mode === "display" ? 42 : 55;
  const stepDelay = mode === "display" ? 4 : 6;

  for (let step = 0; step < stepCount; step += 1) {
    const row = candidateRows[step % candidateRows.length];
    setPulseState(row, targetSlotCard);
    await sleep(baseDelay + step * stepDelay);
  }

  setPulseState(
    participantsList.querySelector(`[data-player-id="${animation.winnerPlayerId}"]`),
    targetSlotCard,
  );
  await sleep(mode === "display" ? 180 : 280);
  clearPulseState();
}

async function playTierAnimation(animation) {
  if (mode === "display") {
    const slotCard = slotsGrid.querySelector(`[data-slot-number="${animation.slotNumber}"]`);
    setPulseState(slotCard);
    const winningTeam = getTeam(animation.winningTeamId);
    const player = getParticipantBySlot(animation.slotNumber);
    await playCinematic({
      eyebrow: `Tier ${animation.tier} — Spot ${animation.slotNumber}`,
      logo: winningTeam?.logo || "",
      label: winningTeam?.label || "",
      player: player?.name || "",
    });
    clearPulseState();
    return;
  }

  const candidateTiles = animation.candidateTeamIds
    .map((teamId) => tiersGrid.querySelector(`[data-team-id="${teamId}"]`))
    .filter(Boolean);
  const slotCard = slotsGrid.querySelector(`[data-slot-number="${animation.slotNumber}"]`);

  const stepCount = mode === "display" ? 12 : 18;
  const baseDelay = mode === "display" ? 38 : 50;
  const stepDelay = mode === "display" ? 4 : 6;

  for (let step = 0; step < stepCount; step += 1) {
    const tile = candidateTiles[step % candidateTiles.length];
    setPulseState(tile, slotCard);
    await sleep(baseDelay + step * stepDelay);
  }

  setPulseState(
    tiersGrid.querySelector(`[data-team-id="${animation.winningTeamId}"]`),
    slotCard,
  );
  await sleep(mode === "display" ? 180 : 280);
  clearPulseState();
}

async function emitAnimation(payload) {
  await fetch(buildAnimationUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function drawNext() {
  if (mode !== "streamer" || isSaving || isAnimating) {
    return;
  }
  isAnimating = true;
  updateToolbar();
  const phase = getDrawPhase();
  try {
    if (phase === "spots") {
      const remainingParticipants = state.participants.filter((player) => player.slotNumber === null);
      const winner = randomItem(remainingParticipants);
      const animation = {
        type: "spot",
        targetSlotNumber: getAssignedSpotCount() + 1,
        candidatePlayerIds: remainingParticipants.map((player) => player.id),
        winnerPlayerId: winner.id,
      };
      await emitAnimation(animation);
      await playSpotAnimation(animation);
      winner.slotNumber = animation.targetSlotNumber;
      state.history.push({ type: "spot", playerId: winner.id, slotNumber: animation.targetSlotNumber });
    } else if (phase === "teams") {
      const nextStep = getNextTeamStep();
      const template = getCurrentTemplate();
      if (!nextStep || !template) {
        return;
      }
      const assignedTeams = getAssignedTeamIds();
      const remainingTeamIds = (template.tiers?.[nextStep.tier] || []).filter((teamId) => !assignedTeams.has(teamId));
      const winningTeamId = randomItem(remainingTeamIds);
      const player = getParticipantBySlot(nextStep.slotNumber);
      if (!player || !winningTeamId) {
        return;
      }
      const animation = {
        type: "team",
        tier: nextStep.tier,
        slotNumber: nextStep.slotNumber,
        candidateTeamIds: remainingTeamIds,
        winningTeamId,
      };
      await emitAnimation(animation);
      await playTierAnimation(animation);
      player.teams[nextStep.tier] = winningTeamId;
      state.history.push({
        type: "team",
        playerId: player.id,
        slotNumber: nextStep.slotNumber,
        tier: nextStep.tier,
        teamId: winningTeamId,
      });
    } else {
      return;
    }
    render();
    await saveState();
  } finally {
    isAnimating = false;
    updateToolbar();
  }
}

function undoLast() {
  if (mode !== "streamer" || isSaving || state.history.length === 0) {
    return;
  }
  const lastAction = state.history.pop();
  if (lastAction.type === "spot") {
    const player = getParticipantById(lastAction.playerId);
    if (player) {
      player.slotNumber = null;
    }
  }
  if (lastAction.type === "team") {
    const player = getParticipantById(lastAction.playerId);
    if (player) {
      player.teams[lastAction.tier] = null;
    }
  }
  render();
  void saveState();
}

function resetTierBreak() {
  if (mode !== "streamer" || isSaving) {
    return;
  }
  const currentNames = state.participants.map((player) => player.name);
  state = createDefaultState();
  state.templateId = templateSelect.value || state.templateId;
  state.participants.forEach((player, index) => {
    player.name = currentNames[index];
  });
  render(true);
  void saveState();
}

function clearParticipants() {
  if (mode !== "streamer" || isSaving || isAnimating) return;
  if (state.started) {
    if (!window.confirm("Le break est en cours. Vider tous les noms quand meme ?")) return;
  }
  state.participants.forEach((player, index) => {
    player.name = `Spot ${index + 1}`;
  });
  render(false);
  void saveState();
}

function startDraw() {
  if (mode !== "streamer" || isSaving || isAnimating || state.started) {
    return;
  }
  state.started = true;
  render(true);
  void saveState();
}

function showRecap() {
  if (mode !== "streamer" || isSaving || isAnimating) return;
  if (getDrawPhase() !== "complete") return;
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

function applyIncomingState(nextState) {
  const previousTemplateId = state.templateId;
  state = sanitizeState(nextState);
  render(previousTemplateId !== state.templateId);
}

function flushPendingIncomingState() {
  if (!pendingIncomingState) {
    return;
  }
  const incoming = pendingIncomingState;
  pendingIncomingState = null;
  if (JSON.stringify(incoming) === JSON.stringify(state)) {
    return;
  }
  applyIncomingState(incoming);
}

function applyIncomingStateSafely(nextState) {
  if (isAnimating) {
    pendingIncomingState = nextState;
    return;
  }
  if (JSON.stringify(nextState) === JSON.stringify(state)) {
    return;
  }
  applyIncomingState(nextState);
}

function handleTemplateChange() {
  if (getAssignedTeamCount() > 0) {
    templateSelect.value = state.templateId;
    return;
  }
  state.templateId = templateSelect.value;
  render(true);
  void saveState();
}

function connectStateStream() {
  const source = new EventSource(buildStreamUrl());
  source.addEventListener("tier-animation", (event) => {
    if (mode === "streamer" && isAnimating) {
      return;
    }
    try {
      const payload = JSON.parse(event.data);
      animationQueue = animationQueue.then(async () => {
        isAnimating = true;
        try {
          if (payload.type === "spot") {
            await playSpotAnimation(payload);
          }
          if (payload.type === "team") {
            await playTierAnimation(payload);
          }
        } finally {
          isAnimating = false;
          flushPendingIncomingState();
        }
      });
    } catch {
      // Ignore invalid animation events.
    }
  });
  source.onmessage = (event) => {
    try {
      const incoming = sanitizeState(JSON.parse(event.data));
      applyIncomingStateSafely(incoming);
    } catch {
      // Ignore invalid updates.
    }
  };
  source.onerror = () => {
    source.close();
    window.setTimeout(connectStateStream, 1500);
  };
}

async function syncState() {
  try {
    const incoming = await fetchState();
    applyIncomingStateSafely(incoming);
  } catch (error) {
    console.error(error);
  }
}

function csvEscape(value) {
  const str = value == null ? "" : String(value);
  if (/[",;\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildExportCsv() {
  const template = getCurrentTemplate();
  const templateName = template?.name || state.templateId || "";
  const sportName = sport?.name || "";
  const exportedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const sep = ";";
  const lines = [];

  lines.push(["Tier Break Export"].join(sep));
  lines.push(["Sport", csvEscape(sportName)].join(sep));
  lines.push(["Tableau", csvEscape(templateName)].join(sep));
  lines.push(["Date", csvEscape(exportedAt)].join(sep));
  lines.push("");

  lines.push(["Spot", "Participant", "Tier 1", "Tier 2", "Tier 3"].map(csvEscape).join(sep));
  for (let slotNumber = 1; slotNumber <= 10; slotNumber += 1) {
    const player = getParticipantBySlot(slotNumber);
    const cells = [slotNumber, player?.name || ""];
    [1, 2, 3].forEach((tier) => {
      const teamId = player?.teams?.[tier];
      const team = teamId ? getTeam(teamId) : null;
      cells.push(team?.label || (teamId ?? ""));
    });
    lines.push(cells.map(csvEscape).join(sep));
  }
  lines.push("");

  lines.push(["Tableau d'equipes utilise"].map(csvEscape).join(sep));
  lines.push(["Tier", "Equipes"].map(csvEscape).join(sep));
  ["1", "2", "3"].forEach((tier) => {
    const ids = template?.tiers?.[tier] || [];
    const labels = ids.map((id) => getTeam(id)?.label || id).join(", ");
    lines.push([`Tier ${tier}`, labels].map(csvEscape).join(sep));
  });
  lines.push("");

  lines.push(["Participants"].map(csvEscape).join(sep));
  lines.push(["Id", "Nom", "Spot"].map(csvEscape).join(sep));
  state.participants.forEach((player) => {
    lines.push([player.id, player.name, player.slotNumber ?? ""].map(csvEscape).join(sep));
  });

  return lines.join("\r\n");
}

function exportCsv() {
  const csv = buildExportCsv();
  const bom = "﻿";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tier-break-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

drawNextButton.addEventListener("click", drawNext);
startDrawButton?.addEventListener("click", startDraw);
showRecapButton?.addEventListener("click", showRecap);
hideRecapButton?.addEventListener("click", hideRecap);
undoButton.addEventListener("click", undoLast);
resetButton.addEventListener("click", resetTierBreak);
exportCsvButton?.addEventListener("click", exportCsv);
clearParticipantsButton?.addEventListener("click", clearParticipants);
templateSelect.addEventListener("change", handleTemplateChange);

window.addEventListener("keydown", (event) => {
  if (mode !== "streamer") {
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === " ") {
    event.preventDefault();
    drawNext();
  }
  if (key === "z" || key === "u") {
    undoLast();
  }
  if (key === "r") {
    resetTierBreak();
  }
});

void (async () => {
  try {
    await loadConfigs();
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
