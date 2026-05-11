const wheelSummary = document.querySelector("#wheel-summary");
const draftSummary = document.querySelector("#draft-summary");
const tierSummary = document.querySelector("#tier-summary");
const wheelBadge = document.querySelector("#wheel-badge");
const draftBadge = document.querySelector("#draft-badge");
const tierBadge = document.querySelector("#tier-badge");
const wheelResetButton = document.querySelector("#wheel-reset");
const draftResetButton = document.querySelector("#draft-reset");
const tierResetButton = document.querySelector("#tier-reset");
const wheelCopyDisplayButton = document.querySelector("#wheel-copy-display");
const draftCopyDisplayButton = document.querySelector("#draft-copy-display");
const tierCopyDisplayButton = document.querySelector("#tier-copy-display");
const tierTemplateSelect = document.querySelector("#tier-template-select");
const tierTemplateIdInput = document.querySelector("#tier-template-id");
const tierTemplateLabelInput = document.querySelector("#tier-template-label");
const tierTemplateNewButton = document.querySelector("#tier-template-new");
const tierTemplateDuplicateButton = document.querySelector("#tier-template-duplicate");
const tierTemplateSaveButton = document.querySelector("#tier-template-save");
const tierTemplateDeleteButton = document.querySelector("#tier-template-delete");
const tierTemplateExportButton = document.querySelector("#tier-template-export");
const tierTemplateImportButton = document.querySelector("#tier-template-import");
const tierTemplateImportFileInput = document.querySelector("#tier-template-import-file");
const tierTemplateGrid = document.querySelector("#tier-template-grid");
const sportSelect = document.querySelector("#sport-select");

const STORAGE_KEY = "admin.selectedSport";
let selectedSport = localStorage.getItem(STORAGE_KEY) || "nba";
if (!["nba", "nfl", "ucc"].includes(selectedSport)) selectedSport = "nba";

function applySportToLinks() {
  document.querySelectorAll("a.mode-link").forEach((link) => {
    try {
      const url = new URL(link.href, window.location.href);
      if (selectedSport === "nba") {
        url.searchParams.delete("sport");
      } else {
        url.searchParams.set("sport", selectedSport);
      }
      link.href = url.toString();
    } catch {
      // ignore
    }
  });
}

function setSelectedSport(next) {
  selectedSport = next;
  localStorage.setItem(STORAGE_KEY, next);
  applySportToLinks();
  if (sportsConfig) {
    renderTemplateEditor();
  }
}

function renderSportPicker() {
  if (!sportSelect || !sportsConfig) return;
  const ids = Object.keys(sportsConfig);
  const previous = selectedSport;
  sportSelect.replaceChildren();
  ids.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = sportsConfig[id]?.label || id.toUpperCase();
    sportSelect.appendChild(option);
  });
  if (!ids.includes(previous)) {
    setSelectedSport(ids[0] || "nba");
  }
  sportSelect.value = selectedSport;
}

if (sportSelect) {
  sportSelect.value = selectedSport;
  sportSelect.addEventListener("change", () => setSelectedSport(sportSelect.value));
}
applySportToLinks();

const defaultDraftState = {
  participants: Array.from({ length: 10 }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Spot ${index + 1}`,
    teams: [],
  })),
  currentPick: 0,
};

let sportsConfig = null;
let tierTemplates = {};
let currentTemplateId = null;

async function fetchWheelState() {
  const response = await fetch("./api/state", { cache: "no-store" });
  if (!response.ok) throw new Error("Wheel state unavailable");
  return response.json();
}

async function fetchDraftState() {
  const response = await fetch("./api/state?scope=draft", { cache: "no-store" });
  if (!response.ok) throw new Error("Draft state unavailable");
  return response.json();
}

async function fetchTierState() {
  const response = await fetch("./api/state?scope=tier", { cache: "no-store" });
  if (!response.ok) throw new Error("Tier state unavailable");
  return response.json();
}

async function fetchSportsConfig() {
  const response = await fetch("./api/config/sports", { cache: "no-store" });
  if (!response.ok) throw new Error("Sports config unavailable");
  return response.json();
}

async function fetchTierTemplates() {
  const response = await fetch("./api/config/tier-templates", { cache: "no-store" });
  if (!response.ok) throw new Error("Tier templates unavailable");
  return response.json();
}

async function saveTierTemplates(nextValue) {
  const response = await fetch("./api/config/tier-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextValue),
  });
  if (!response.ok) throw new Error("Unable to save tier templates");
  return response.json();
}

function renderWheelSummary(state) {
  const removed = Array.isArray(state.removed) ? state.removed.length : 0;
  const label = `${30 - removed} restantes`;
  wheelSummary.textContent = label;
  wheelBadge.textContent = label;
}

function renderDraftSummary(state) {
  const currentPick = Number.isInteger(state.currentPick) ? state.currentPick : 0;
  const label = `Pick ${Math.min(currentPick, 30)}/30`;
  draftSummary.textContent = label;
  draftBadge.textContent = label;
}

function renderTierSummary(state) {
  const assignedSpots = Array.isArray(state.participants)
    ? state.participants.filter((player) => Number.isInteger(player.slotNumber)).length
    : 0;
  const assignedTeams = Array.isArray(state.participants)
    ? state.participants.flatMap((player) => [player.teams?.[1], player.teams?.[2], player.teams?.[3]].filter(Boolean)).length
    : 0;
  const headerLabel = `${assignedSpots}/10 spots`;
  tierSummary.textContent = `${headerLabel} · ${assignedTeams}/30 teams`;
  tierBadge.textContent = headerLabel;
}

function getCurrentSportTeams() {
  return sportsConfig?.[selectedSport]?.teams || [];
}

function buildTeamOptions(selectedTeamId) {
  const teams = getCurrentSportTeams();
  return [
    `<option value="">Aucune</option>`,
    ...teams.map((team) => `<option value="${team.id}"${team.id === selectedTeamId ? " selected" : ""}>${team.label}</option>`),
  ].join("");
}

function getTemplatesForSport() {
  return Object.values(tierTemplates).filter((t) => !t.sport || t.sport === selectedSport);
}

function renderTemplateEditor() {
  const templateEntries = getTemplatesForSport();
  tierTemplateSelect.replaceChildren();
  tierTemplateGrid.replaceChildren();

  if (templateEntries.length === 0) {
    currentTemplateId = null;
    tierTemplateIdInput.value = "";
    tierTemplateLabelInput.value = "";
    tierTemplateDeleteButton.disabled = true;
    const empty = document.createElement("p");
    empty.style.color = "var(--muted)";
    empty.textContent = `Aucun template pour ${sportsConfig?.[selectedSport]?.label || selectedSport}. Clique sur Nouveau pour en créer un.`;
    tierTemplateGrid.appendChild(empty);
    return;
  }

  if (!currentTemplateId || !tierTemplates[currentTemplateId] || tierTemplates[currentTemplateId].sport !== selectedSport) {
    currentTemplateId = templateEntries[0].id;
  }

  templateEntries.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    option.selected = template.id === currentTemplateId;
    tierTemplateSelect.appendChild(option);
  });

  const currentTemplate = tierTemplates[currentTemplateId];
  tierTemplateIdInput.value = currentTemplate.id;
  tierTemplateLabelInput.value = currentTemplate.label;
  tierTemplateDeleteButton.disabled = templateEntries.length <= 1;

  [1, 2, 3].forEach((tierNumber) => {
    const column = document.createElement("section");
    column.className = "template-column";
    column.innerHTML = `
      <div class="template-column__head">
        <strong>Tier ${tierNumber}</strong>
        <span>10 equipes</span>
      </div>
      <div class="template-column__list"></div>
    `;
    const list = column.querySelector(".template-column__list");
    const teamIds = currentTemplate.tiers?.[tierNumber] || [];

    for (let index = 0; index < 10; index += 1) {
      const select = document.createElement("select");
      select.dataset.tierNumber = String(tierNumber);
      select.dataset.teamIndex = String(index);
      select.innerHTML = buildTeamOptions(teamIds[index] || "");
      list.appendChild(select);
    }

    tierTemplateGrid.appendChild(column);
  });
}

function collectTemplateFromEditor() {
  const templateId = String(tierTemplateIdInput.value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || `template-${Date.now()}`;
  const label = tierTemplateLabelInput.value.trim() || templateId;
  const tiers = { 1: [], 2: [], 3: [] };

  tierTemplateGrid.querySelectorAll("select").forEach((select) => {
    const tierNumber = Number(select.dataset.tierNumber);
    tiers[tierNumber].push(select.value || "");
  });

  return {
    id: templateId,
    label,
    sport: selectedSport,
    tiers: {
      1: tiers[1].filter(Boolean),
      2: tiers[2].filter(Boolean),
      3: tiers[3].filter(Boolean),
    },
  };
}

async function refreshAdmin() {
  try {
    const [wheelState, draftState, tierState, sports, templates] = await Promise.all([
      fetchWheelState(),
      fetchDraftState(),
      fetchTierState(),
      fetchSportsConfig(),
      fetchTierTemplates(),
    ]);
    sportsConfig = sports;
    tierTemplates = templates;
    currentTemplateId = tierState.templateId || currentTemplateId;
    renderSportPicker();
    renderWheelSummary(wheelState);
    renderDraftSummary(draftState);
    renderTierSummary(tierState);
    renderTemplateEditor();
  } catch {
    wheelSummary.textContent = "Erreur";
    draftSummary.textContent = "Erreur";
    tierSummary.textContent = "Erreur";
    wheelBadge.textContent = "Erreur";
    draftBadge.textContent = "Erreur";
    tierBadge.textContent = "Erreur";
  }
}

async function resetWheel() {
  wheelResetButton.disabled = true;
  try {
    await fetch("./api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removed: [] }),
    });
    await refreshAdmin();
  } finally {
    wheelResetButton.disabled = false;
  }
}

async function resetDraft() {
  draftResetButton.disabled = true;
  try {
    const currentState = await fetchDraftState();
    const nextState = {
      ...defaultDraftState,
      participants: defaultDraftState.participants.map((player, index) => ({
        ...player,
        name: currentState.participants?.[index]?.name || player.name,
      })),
    };
    await fetch("./api/state?scope=draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextState),
    });
    await refreshAdmin();
  } finally {
    draftResetButton.disabled = false;
  }
}

async function resetTier() {
  tierResetButton.disabled = true;
  try {
    const currentState = await fetchTierState();
    const nextState = {
      templateId: currentState.templateId || "nba-standard",
      participants: Array.from({ length: 10 }, (_, index) => ({
        id: `player-${index + 1}`,
        name: currentState.participants?.[index]?.name || `Spot ${index + 1}`,
        slotNumber: null,
        teams: { 1: null, 2: null, 3: null },
      })),
      history: [],
    };
    await fetch("./api/state?scope=tier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextState),
    });
    await refreshAdmin();
  } finally {
    tierResetButton.disabled = false;
  }
}

function handleTierTemplateNew() {
  const templateId = `template-${Date.now()}`;
  tierTemplates[templateId] = {
    id: templateId,
    label: "Nouveau template",
    sport: selectedSport,
    tiers: { 1: [], 2: [], 3: [] },
  };
  currentTemplateId = templateId;
  renderTemplateEditor();
}

function handleTierTemplateDuplicate() {
  if (!currentTemplateId || !tierTemplates[currentTemplateId]) {
    return;
  }

  const source = tierTemplates[currentTemplateId];
  const duplicateId = `${source.id}-copy`;
  let nextId = duplicateId;
  let suffix = 2;

  while (tierTemplates[nextId]) {
    nextId = `${duplicateId}-${suffix}`;
    suffix += 1;
  }

  tierTemplates[nextId] = {
    ...source,
    id: nextId,
    label: `${source.label} Copy`,
    tiers: {
      1: [...(source.tiers?.[1] || [])],
      2: [...(source.tiers?.[2] || [])],
      3: [...(source.tiers?.[3] || [])],
    },
  };

  currentTemplateId = nextId;
  renderTemplateEditor();
}

async function handleTierTemplateSave() {
  tierTemplateSaveButton.disabled = true;
  try {
    const nextTemplate = collectTemplateFromEditor();
    tierTemplates[nextTemplate.id] = nextTemplate;
    if (nextTemplate.id !== currentTemplateId) {
      delete tierTemplates[currentTemplateId];
    }
    currentTemplateId = nextTemplate.id;
    await saveTierTemplates(tierTemplates);
    await refreshAdmin();
  } finally {
    tierTemplateSaveButton.disabled = false;
  }
}

async function handleTierTemplateDelete() {
  const templateEntries = Object.keys(tierTemplates);
  if (templateEntries.length <= 1 || !currentTemplateId) {
    return;
  }

  tierTemplateDeleteButton.disabled = true;
  try {
    delete tierTemplates[currentTemplateId];
    currentTemplateId = Object.keys(tierTemplates)[0] || null;
    await saveTierTemplates(tierTemplates);
    await refreshAdmin();
  } finally {
    tierTemplateDeleteButton.disabled = false;
  }
}

async function copyDisplayUrl(pathname, button) {
  const url = new URL(pathname, window.location.href);
  if (selectedSport !== "nba") {
    url.searchParams.set("sport", selectedSport);
  }
  await navigator.clipboard.writeText(url.toString());
  const previousLabel = button.textContent;
  button.textContent = "Copie";
  window.setTimeout(() => {
    button.textContent = previousLabel;
  }, 1200);
}

wheelResetButton.addEventListener("click", resetWheel);
draftResetButton.addEventListener("click", resetDraft);
tierResetButton.addEventListener("click", resetTier);
wheelCopyDisplayButton.addEventListener("click", () => {
  void copyDisplayUrl("./index.html?mode=display", wheelCopyDisplayButton);
});
draftCopyDisplayButton.addEventListener("click", () => {
  void copyDisplayUrl("./draft.html?mode=display", draftCopyDisplayButton);
});
tierCopyDisplayButton.addEventListener("click", () => {
  void copyDisplayUrl("./tier.html?mode=display", tierCopyDisplayButton);
});
function exportTierTemplates() {
  const payload = {
    type: "break-overlay-tier-templates",
    version: 1,
    exportedAt: new Date().toISOString(),
    templates: tierTemplates,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tier-templates-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeImportedTemplate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") : "";
  if (!id) return null;
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : id;
  const sport = typeof raw.sport === "string" ? raw.sport.toLowerCase().trim() : "nba";
  const tiersRaw = raw.tiers && typeof raw.tiers === "object" ? raw.tiers : {};
  const tiers = { 1: [], 2: [], 3: [] };
  [1, 2, 3].forEach((tier) => {
    const list = Array.isArray(tiersRaw[tier]) ? tiersRaw[tier] : Array.isArray(tiersRaw[String(tier)]) ? tiersRaw[String(tier)] : [];
    tiers[tier] = list.filter((teamId) => typeof teamId === "string").slice(0, 10);
  });
  return { id, label, sport, tiers };
}

async function importTierTemplates(file) {
  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (error) {
    window.alert("Fichier invalide : ce n'est pas du JSON.");
    return;
  }

  // Supporte deux formats : { templates: {...} } (export officiel) ou directement {...} (tier-templates.json brut)
  const incomingRaw = (parsed && typeof parsed.templates === "object") ? parsed.templates : parsed;
  if (!incomingRaw || typeof incomingRaw !== "object") {
    window.alert("Fichier invalide : aucun template trouve.");
    return;
  }

  let importedCount = 0;
  let skippedCount = 0;
  const incomingList = Object.values(incomingRaw).map(sanitizeImportedTemplate).filter(Boolean);
  if (incomingList.length === 0) {
    window.alert("Aucun template valide dans ce fichier.");
    return;
  }

  for (const template of incomingList) {
    let targetId = template.id;
    if (tierTemplates[targetId]) {
      const choice = window.prompt(
        `Le template "${targetId}" existe deja.\n\n` +
        `Tape :\n` +
        `  ECRASER pour remplacer\n` +
        `  un nouveau ID pour renommer (ex: ${targetId}-import)\n` +
        `  vide ou IGNORER pour passer ce template`,
        `${targetId}-import`,
      );
      if (!choice || choice.trim().toUpperCase() === "IGNORER") {
        skippedCount += 1;
        continue;
      }
      const normalized = choice.trim().toUpperCase();
      if (normalized === "ECRASER") {
        // garde targetId
      } else {
        targetId = choice.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
        if (!targetId) {
          skippedCount += 1;
          continue;
        }
      }
    }
    tierTemplates[targetId] = { ...template, id: targetId };
    importedCount += 1;
  }

  if (importedCount === 0) {
    window.alert(`Aucun template importe (${skippedCount} ignore${skippedCount > 1 ? "s" : ""}).`);
    return;
  }

  try {
    await saveTierTemplates(tierTemplates);
    await refreshAdmin();
    window.alert(`✓ ${importedCount} template${importedCount > 1 ? "s" : ""} importe${importedCount > 1 ? "s" : ""}` + (skippedCount ? `, ${skippedCount} ignore${skippedCount > 1 ? "s" : ""}.` : "."));
  } catch (error) {
    window.alert("Erreur lors de la sauvegarde : " + (error?.message || "inconnue"));
  }
}

tierTemplateSelect.addEventListener("change", () => {
  currentTemplateId = tierTemplateSelect.value;
  renderTemplateEditor();
});
tierTemplateNewButton.addEventListener("click", handleTierTemplateNew);
tierTemplateDuplicateButton.addEventListener("click", handleTierTemplateDuplicate);
tierTemplateSaveButton.addEventListener("click", () => {
  void handleTierTemplateSave();
});
tierTemplateDeleteButton.addEventListener("click", () => {
  void handleTierTemplateDelete();
});
tierTemplateExportButton?.addEventListener("click", exportTierTemplates);
tierTemplateImportButton?.addEventListener("click", () => tierTemplateImportFileInput?.click());
tierTemplateImportFileInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = ""; // permet de re-importer le même fichier
  if (file) {
    await importTierTemplates(file);
  }
});

void refreshAdmin();
