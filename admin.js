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
  // Met a jour les tags "NBA" en haut de chaque mode-card.
  // sportsConfig n'est pas encore initialise au tout premier appel (TDZ) -> try/catch safe.
  let sportLabel = selectedSport.toUpperCase();
  try {
    if (typeof sportsConfig !== "undefined" && sportsConfig && sportsConfig[selectedSport]?.label) {
      sportLabel = sportsConfig[selectedSport].label;
    }
  } catch { /* sportsConfig pas encore declare */ }
  document.querySelectorAll("[data-sport-tag]").forEach((el) => {
    el.textContent = sportLabel;
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
  applySportToLinks();
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
    renderSportEditorSelect();
    renderSportEditor();
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
  // Flag obs=1 → fond semi-transparent pour source navigateur OBS
  url.searchParams.set("obs", "1");
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

// === Sport editor ===
const BUILTIN_SPORTS = new Set(["nba", "nfl", "ucc"]);
const sportEditorSelect = document.querySelector("#sport-editor-select");
const sportEditorIdInput = document.querySelector("#sport-editor-id");
const sportEditorLabelInput = document.querySelector("#sport-editor-label");
const sportEditorNew = document.querySelector("#sport-editor-new");
const sportEditorSave = document.querySelector("#sport-editor-save");
const sportEditorDelete = document.querySelector("#sport-editor-delete");
const sportEditorExport = document.querySelector("#sport-editor-export");
const sportEditorImport = document.querySelector("#sport-editor-import");
const sportEditorImportFile = document.querySelector("#sport-editor-import-file");
const sportEditorDropzone = document.querySelector("#sport-editor-dropzone");
const sportEditorFilesInput = document.querySelector("#sport-editor-files");
const sportEditorTable = document.querySelector("#sport-editor-table");
const sportEditorTbody = document.querySelector("#sport-editor-tbody");
const sportEditorEmpty = document.querySelector("#sport-editor-empty");

// Etat local de l'editeur (non encore sauve)
let currentEditorSportId = null;
let currentEditorTeams = []; // [{id, label, logo}]
let currentEditorIsNew = false;

function slugifyTeamLabel(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function prettifyFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[-_]+/g, " ").trim();
  return cleaned.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function getCustomSportIds() {
  if (!sportsConfig) return [];
  return Object.keys(sportsConfig).filter((id) => !BUILTIN_SPORTS.has(id));
}

function renderSportEditorSelect() {
  if (!sportEditorSelect) return;
  const customIds = getCustomSportIds();
  sportEditorSelect.replaceChildren();
  if (customIds.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— aucun sport custom —";
    sportEditorSelect.appendChild(opt);
    return;
  }
  // Si aucun sport n'est en cours d'edition mais qu'il y en a en stock,
  // on auto-charge le premier pour que les champs ID/Label se remplissent.
  if (!currentEditorSportId && !currentEditorIsNew) {
    loadSportIntoEditor(customIds[0]);
    return; // loadSportIntoEditor rappelle renderSportEditor qui re-rendra le select
  }
  customIds.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${sportsConfig[id]?.label || id} (${id})`;
    opt.selected = id === currentEditorSportId;
    sportEditorSelect.appendChild(opt);
  });
}

function loadSportIntoEditor(sportId) {
  currentEditorIsNew = false;
  currentEditorSportId = sportId || null;
  if (!sportId || !sportsConfig?.[sportId]) {
    currentEditorTeams = [];
    sportEditorIdInput.value = "";
    sportEditorLabelInput.value = "";
  } else {
    const sport = sportsConfig[sportId];
    currentEditorTeams = (sport.teams || []).map((t) => ({ id: t.id, label: t.label, logo: t.logo }));
    sportEditorIdInput.value = sportId;
    sportEditorLabelInput.value = sport.label || sportId.toUpperCase();
  }
  renderSportEditorSelect();
  renderSportEditor();
}

function startNewSport() {
  currentEditorIsNew = true;
  currentEditorSportId = null;
  currentEditorTeams = [];
  sportEditorIdInput.value = "";
  sportEditorLabelInput.value = "";
  renderSportEditor();
}

function renderSportEditor() {
  const hasCustom = getCustomSportIds().length > 0;
  const editing = currentEditorIsNew || currentEditorSportId;
  // Toggle visibility
  if (sportEditorEmpty) sportEditorEmpty.hidden = hasCustom || editing;
  if (sportEditorDropzone) sportEditorDropzone.hidden = !editing;
  if (sportEditorTable) sportEditorTable.hidden = !editing || currentEditorTeams.length === 0;

  // Le bouton supprimer est dispo seulement si on est sur un sport custom existant
  if (sportEditorDelete) {
    sportEditorDelete.disabled = !currentEditorSportId || currentEditorIsNew;
  }
  if (sportEditorExport) {
    sportEditorExport.disabled = !currentEditorSportId || currentEditorIsNew;
  }
  // Save dispo si on edite quelque chose
  if (sportEditorSave) sportEditorSave.disabled = !editing;

  // Rendu de la table
  if (!sportEditorTbody) return;
  sportEditorTbody.replaceChildren();
  currentEditorTeams.forEach((team, index) => {
    const tr = document.createElement("tr");
    const logoCell = document.createElement("td");
    if (team.logo) {
      const img = document.createElement("img");
      img.className = "sport-editor__logo";
      img.src = team.logo;
      img.alt = team.label;
      logoCell.appendChild(img);
    } else {
      logoCell.textContent = "—";
    }
    const idCell = document.createElement("td");
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.value = team.id;
    idInput.addEventListener("input", (e) => {
      team.id = e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    });
    idCell.appendChild(idInput);
    const labelCell = document.createElement("td");
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = team.label;
    labelInput.addEventListener("input", (e) => { team.label = e.target.value; });
    labelCell.appendChild(labelInput);
    const actionsCell = document.createElement("td");
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn--danger";
    removeBtn.style.minHeight = "30px";
    removeBtn.style.padding = "0 10px";
    removeBtn.style.fontSize = "0.85rem";
    removeBtn.textContent = "Retirer";
    removeBtn.addEventListener("click", () => {
      currentEditorTeams.splice(index, 1);
      renderSportEditor();
    });
    actionsCell.appendChild(removeBtn);
    tr.append(logoCell, idCell, labelCell, actionsCell);
    sportEditorTbody.appendChild(tr);
  });
}

async function uploadLogoFile(sportId, file) {
  const filename = slugifyTeamLabel(file.name.replace(/\.[^.]+$/, "")) + (file.name.match(/\.[^.]+$/)?.[0] || ".png");
  const url = new URL(`./api/config/sports/${encodeURIComponent(sportId)}/logos`, window.location.href);
  url.searchParams.set("filename", filename);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`Upload echec (HTTP ${res.status}): ${errBody.error || "(no detail)"}`);
  }
  const data = await res.json();
  return data.url; // ./user-logos/<sportId>/<filename>
}

async function handleFilesDropped(files) {
  const sportId = sportEditorIdInput.value.toLowerCase().trim();
  if (!sportId || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(sportId)) {
    window.alert("Renseigne d'abord un ID de sport valide (ex: mlb)");
    return;
  }
  if (BUILTIN_SPORTS.has(sportId)) {
    window.alert("Cet ID est reserve a un sport built-in.");
    return;
  }
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const logoUrl = await uploadLogoFile(sportId, file);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const teamId = slugifyTeamLabel(baseName) || `team-${Date.now()}`;
      const teamLabel = prettifyFilename(file.name);
      // Evite doublon par id
      if (currentEditorTeams.some((t) => t.id === teamId)) continue;
      currentEditorTeams.push({ id: teamId, label: teamLabel, logo: logoUrl });
    } catch (err) {
      console.error("Upload failed for", file.name, err);
      window.alert(`Echec upload ${file.name} : ${err.message}`);
    }
  }
  renderSportEditor();
}

async function saveSportEditor() {
  const id = sportEditorIdInput.value.toLowerCase().trim();
  const label = sportEditorLabelInput.value.trim() || id.toUpperCase();
  if (!id || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(id)) {
    window.alert("ID invalide (lettres / chiffres / tirets, 1-30 caracteres, doit commencer par lettre/chiffre)");
    return;
  }
  if (BUILTIN_SPORTS.has(id)) {
    window.alert("Cet ID est reserve a un sport built-in.");
    return;
  }
  if (currentEditorTeams.length === 0) {
    if (!window.confirm("Aucune equipe ajoutee. Sauvegarder quand meme ?")) return;
  }
  try {
    const res = await fetch("./api/config/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, label, teams: currentEditorTeams }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    // Rafraichit la config sports
    sportsConfig = await fetchSportsConfig();
    renderSportPicker();
    currentEditorSportId = id;
    currentEditorIsNew = false;
    renderSportEditorSelect();
    renderSportEditor();
    window.alert(`Sport "${label}" sauvegarde.`);
  } catch (err) {
    window.alert("Erreur sauvegarde : " + err.message);
  }
}

async function deleteSportEditor() {
  if (!currentEditorSportId) return;
  if (!window.confirm(`Supprimer le sport "${currentEditorSportId}" et tous ses logos ?`)) return;
  try {
    const res = await fetch(`./api/config/sports/${encodeURIComponent(currentEditorSportId)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sportsConfig = await fetchSportsConfig();
    renderSportPicker();
    currentEditorSportId = null;
    currentEditorIsNew = false;
    currentEditorTeams = [];
    sportEditorIdInput.value = "";
    sportEditorLabelInput.value = "";
    renderSportEditorSelect();
    renderSportEditor();
  } catch (err) {
    window.alert("Erreur suppression : " + err.message);
  }
}

// Export d'un sport en .zip contenant sport.json + tous les logos
async function exportCurrentSport() {
  if (!currentEditorSportId || !sportsConfig?.[currentEditorSportId]) return;
  if (typeof JSZip === "undefined") {
    window.alert("JSZip n'est pas charge. Recharge la page.");
    return;
  }
  const sport = sportsConfig[currentEditorSportId];
  const zip = new JSZip();
  const logosFolder = zip.folder("logos");

  // Manifest avec chemins relatifs aux logos dans le zip
  const teamsForExport = [];
  for (const team of sport.teams) {
    let logoFilename = "";
    if (team.logo) {
      try {
        const res = await fetch(team.logo, { cache: "no-store" });
        if (res.ok) {
          const blob = await res.blob();
          // Recupere le nom du fichier d'origine ou genere un slug
          logoFilename = (team.logo.split("/").pop() || `${team.id}.png`).toLowerCase();
          logosFolder.file(logoFilename, blob);
        }
      } catch (err) {
        console.warn("Skip logo fetch for", team.id, err);
      }
    }
    teamsForExport.push({ id: team.id, label: team.label, logo: logoFilename ? `logos/${logoFilename}` : "" });
  }

  const manifest = {
    type: "break-overlay-sport",
    version: 2,
    id: currentEditorSportId,
    label: sport.label,
    teams: teamsForExport,
  };
  zip.file("sport.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sport-${currentEditorSportId}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Import d'un sport depuis un .zip (ou .json legacy)
async function importSportFromFile(file) {
  try {
    if (file.name.toLowerCase().endsWith(".json")) {
      // Format legacy : juste un JSON (sans logos)
      return await importSportFromJson(file);
    }
    if (typeof JSZip === "undefined") {
      window.alert("JSZip n'est pas charge. Recharge la page.");
      return;
    }
    const zip = await JSZip.loadAsync(file);
    const manifestEntry = zip.file("sport.json");
    if (!manifestEntry) {
      window.alert("Le zip ne contient pas sport.json.");
      return;
    }
    const manifest = JSON.parse(await manifestEntry.async("string"));
    if (manifest.type !== "break-overlay-sport" || !manifest.id || !Array.isArray(manifest.teams)) {
      window.alert("Fichier invalide : ce n'est pas un export de sport.");
      return;
    }
    if (BUILTIN_SPORTS.has(manifest.id)) {
      window.alert(`L'ID "${manifest.id}" est reserve. Renomme le sport avant import.`);
      return;
    }

    // Upload chaque logo present dans le zip
    const teamsForServer = [];
    for (const team of manifest.teams) {
      let logoUrl = "";
      if (team.logo && typeof team.logo === "string") {
        const entry = zip.file(team.logo);
        if (entry) {
          const blob = await entry.async("blob");
          const filename = team.logo.split("/").pop() || `${team.id}.png`;
          const file = new File([blob], filename, { type: blob.type || "image/png" });
          try {
            logoUrl = await uploadLogoFile(manifest.id, file);
          } catch (err) {
            console.warn("Logo upload failed for", team.id, err);
          }
        }
      }
      teamsForServer.push({ id: team.id, label: team.label, logo: logoUrl });
    }

    // Sauvegarde du sport
    const res = await fetch("./api/config/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: manifest.id, label: manifest.label, teams: teamsForServer }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    sportsConfig = await fetchSportsConfig();
    renderSportPicker();
    currentEditorSportId = manifest.id;
    currentEditorIsNew = false;
    loadSportIntoEditor(manifest.id);
    renderSportEditorSelect();
    window.alert(`Sport "${manifest.label}" importe avec ${teamsForServer.filter((t) => t.logo).length} logo(s).`);
  } catch (err) {
    window.alert("Erreur import : " + err.message);
  }
}

// Fallback pour anciens exports JSON sans logos
async function importSportFromJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (parsed.type !== "break-overlay-sport" || !parsed.id || !Array.isArray(parsed.teams)) {
    window.alert("Fichier invalide : ce n'est pas un export de sport.");
    return;
  }
  if (BUILTIN_SPORTS.has(parsed.id)) {
    window.alert(`L'ID "${parsed.id}" est reserve.`);
    return;
  }
  // Les logos pointent sur des URLs absolues d'une autre instance -> on garde tels quels mais ils risquent de ne pas charger
  const res = await fetch("./api/config/sports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: parsed.id, label: parsed.label, teams: parsed.teams }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  sportsConfig = await fetchSportsConfig();
  renderSportPicker();
  currentEditorSportId = parsed.id;
  currentEditorIsNew = false;
  loadSportIntoEditor(parsed.id);
  renderSportEditorSelect();
  window.alert(`Sport "${parsed.label}" importe (JSON legacy, sans logos).`);
}

// Listeners
sportEditorSelect?.addEventListener("change", () => {
  if (sportEditorSelect.value) loadSportIntoEditor(sportEditorSelect.value);
});
sportEditorNew?.addEventListener("click", startNewSport);
sportEditorSave?.addEventListener("click", () => { void saveSportEditor(); });
sportEditorDelete?.addEventListener("click", () => { void deleteSportEditor(); });
sportEditorExport?.addEventListener("click", () => { void exportCurrentSport(); });
sportEditorImport?.addEventListener("click", () => sportEditorImportFile?.click());
sportEditorImportFile?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) void importSportFromFile(file);
});

// Drag-drop
if (sportEditorDropzone) {
  sportEditorDropzone.addEventListener("click", () => sportEditorFilesInput?.click());
  sportEditorDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    sportEditorDropzone.classList.add("sport-editor__dropzone--hover");
  });
  sportEditorDropzone.addEventListener("dragleave", () => {
    sportEditorDropzone.classList.remove("sport-editor__dropzone--hover");
  });
  sportEditorDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    sportEditorDropzone.classList.remove("sport-editor__dropzone--hover");
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) void handleFilesDropped(files);
  });
  sportEditorFilesInput?.addEventListener("change", (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length > 0) void handleFilesDropped(files);
  });
}

// === Historique ===
const historyTable = document.querySelector("#history-table");
const historyTbody = document.querySelector("#history-tbody");
const historyEmpty = document.querySelector("#history-empty");
const historyPagination = document.querySelector("#history-pagination");
const historyPageInfo = document.querySelector("#history-page-info");
const historyPrevBtn = document.querySelector("#history-prev");
const historyNextBtn = document.querySelector("#history-next");
const historyModal = document.querySelector("#history-modal");
const historyModalTitle = document.querySelector("#history-modal-title");
const historyModalEyebrow = document.querySelector("#history-modal-eyebrow");
const historyModalBody = document.querySelector("#history-modal-body");
const historyModalClose = document.querySelector("#history-modal-close");

const HISTORY_PAGE_SIZE = 10;
let historyEntries = [];
let historyPage = 0;

function formatHistoryDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

async function fetchHistory() {
  const res = await fetch("./api/history", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function fetchHistoryEntry(id) {
  const res = await fetch(`./api/history/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function deleteHistoryEntry(id) {
  const res = await fetch(`./api/history/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

async function renderHistory() {
  if (!historyTbody) return;
  try {
    historyEntries = await fetchHistory();
  } catch (err) {
    console.error(err);
    historyEntries = [];
  }
  // Si la page courante n'a plus de contenu (suppressions), recule
  const totalPages = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
  if (historyPage >= totalPages) historyPage = totalPages - 1;
  if (historyPage < 0) historyPage = 0;
  renderHistoryPage();
}

function renderHistoryPage() {
  if (!historyTbody) return;
  historyTbody.replaceChildren();
  if (historyEntries.length === 0) {
    historyTable.hidden = true;
    historyEmpty.hidden = false;
    historyPagination.hidden = true;
    return;
  }
  historyEmpty.hidden = true;
  historyTable.hidden = false;

  const start = historyPage * HISTORY_PAGE_SIZE;
  const slice = historyEntries.slice(start, start + HISTORY_PAGE_SIZE);
  slice.forEach((entry) => {
    const tr = document.createElement("tr");
    const sportLabel = sportsConfig?.[entry.sportId]?.label || entry.sportId.toUpperCase();
    tr.innerHTML = `
      <td>${formatHistoryDate(entry.createdAt)}</td>
      <td><span class="history-badge">${sportLabel}</span></td>
      <td><span class="history-badge">${entry.scope === "tier" ? "Tier" : entry.scope === "draft" ? "Draft" : entry.scope}</span></td>
      <td>
        <div class="history-table__actions">
          <button class="btn" data-action="view" data-id="${entry.id}">Voir</button>
          <button class="btn" data-action="csv" data-id="${entry.id}">CSV</button>
          <button class="btn btn--danger" data-action="delete" data-id="${entry.id}">Supprimer</button>
        </div>
      </td>
    `;
    historyTbody.appendChild(tr);
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
  historyPagination.hidden = totalPages <= 1;
  historyPageInfo.textContent = `Page ${historyPage + 1} / ${totalPages} · ${historyEntries.length} break${historyEntries.length > 1 ? "s" : ""}`;
  historyPrevBtn.disabled = historyPage === 0;
  historyNextBtn.disabled = historyPage >= totalPages - 1;
}

historyPrevBtn?.addEventListener("click", () => {
  if (historyPage > 0) { historyPage -= 1; renderHistoryPage(); }
});
historyNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
  if (historyPage < totalPages - 1) { historyPage += 1; renderHistoryPage(); }
});

function buildHistoryCsv(entry) {
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const sep = ";";
  const lines = [];
  const sportLabel = sportsConfig?.[entry.sportId]?.label || entry.sportId.toUpperCase();
  const teams = sportsConfig?.[entry.sportId]?.teams || [];
  const teamLabel = (id) => teams.find((t) => t.id === id)?.label || id || "";

  lines.push(`Break Overlay - ${sportLabel} - ${entry.scope}`);
  lines.push(["Date", escape(formatHistoryDate(entry.createdAt))].join(sep));
  lines.push("");

  if (entry.scope === "tier") {
    lines.push(["Spot", "Participant", "Tier 1", "Tier 2", "Tier 3"].map(escape).join(sep));
    const bySlot = new Map();
    entry.state.participants.forEach((p) => { if (p.slotNumber) bySlot.set(p.slotNumber, p); });
    for (let n = 1; n <= 10; n += 1) {
      const p = bySlot.get(n);
      lines.push([n, p?.name || "", teamLabel(p?.teams?.[1]), teamLabel(p?.teams?.[2]), teamLabel(p?.teams?.[3])].map(escape).join(sep));
    }
  } else if (entry.scope === "draft") {
    lines.push(["Spot", "Participant", "Pick 1", "Pick 2", "Pick 3"].map(escape).join(sep));
    entry.state.participants.forEach((p, i) => {
      lines.push([i + 1, p.name || "", teamLabel(p.teams?.[0]), teamLabel(p.teams?.[1]), teamLabel(p.teams?.[2])].map(escape).join(sep));
    });
  }
  return lines.join("\r\n");
}

function downloadHistoryCsv(entry) {
  const csv = buildHistoryCsv(entry);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${entry.id}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openHistoryModal(entry) {
  const sportLabel = sportsConfig?.[entry.sportId]?.label || entry.sportId.toUpperCase();
  const teams = sportsConfig?.[entry.sportId]?.teams || [];
  const teamLogo = (id) => teams.find((t) => t.id === id)?.logo || "";
  const teamLabel = (id) => teams.find((t) => t.id === id)?.label || id || "";

  historyModalEyebrow.textContent = `${formatHistoryDate(entry.createdAt)} — ${sportLabel}`;
  historyModalTitle.textContent = entry.scope === "tier" ? "Tier Break" : entry.scope === "draft" ? "Draft" : entry.scope;

  const grid = document.createElement("div");
  grid.className = "history-modal__grid";

  if (entry.scope === "tier") {
    const bySlot = new Map();
    entry.state.participants.forEach((p) => { if (p.slotNumber) bySlot.set(p.slotNumber, p); });
    for (let n = 1; n <= 10; n += 1) {
      const p = bySlot.get(n);
      const card = document.createElement("article");
      card.className = "recap-card";
      const teamsHtml = [1, 2, 3].map((tier) => {
        const tid = p?.teams?.[tier];
        if (tid) return `<div class="recap-card__team"><img src="${teamLogo(tid)}" alt="${teamLabel(tid)}" /></div>`;
        return `<div class="recap-card__team recap-card__team--empty"></div>`;
      }).join("");
      card.innerHTML = `
        <div class="recap-card__head"><span class="recap-card__spot">Spot ${n}</span></div>
        <div class="recap-card__player">${p?.name || "—"}</div>
        <div class="recap-card__teams" style="margin-top:10px">${teamsHtml}</div>
      `;
      grid.appendChild(card);
    }
  } else if (entry.scope === "draft") {
    entry.state.participants.forEach((p, i) => {
      const card = document.createElement("article");
      card.className = "recap-card";
      const teamsHtml = [0, 1, 2].map((idx) => {
        const tid = p.teams?.[idx];
        if (tid) return `<div class="recap-card__team"><img src="${teamLogo(tid)}" alt="${teamLabel(tid)}" /></div>`;
        return `<div class="recap-card__team recap-card__team--empty"></div>`;
      }).join("");
      card.innerHTML = `
        <div class="recap-card__head"><span class="recap-card__spot">Spot ${i + 1}</span></div>
        <div class="recap-card__player">${p.name}</div>
        <div class="recap-card__teams" style="margin-top:10px">${teamsHtml}</div>
      `;
      grid.appendChild(card);
    });
  }
  historyModalBody.replaceChildren(grid);
  historyModal.hidden = false;
}

function closeHistoryModal() {
  historyModal.hidden = true;
  historyModalBody.replaceChildren();
}

historyTbody?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === "delete") {
    if (!window.confirm("Supprimer ce break archive ?")) return;
    try {
      await deleteHistoryEntry(id);
      await renderHistory();
    } catch (err) {
      window.alert("Erreur: " + (err?.message || err));
    }
    return;
  }
  try {
    const entry = await fetchHistoryEntry(id);
    if (action === "view") openHistoryModal(entry);
    else if (action === "csv") downloadHistoryCsv(entry);
  } catch (err) {
    window.alert("Erreur: " + (err?.message || err));
  }
});

historyModalClose?.addEventListener("click", closeHistoryModal);
historyModal?.addEventListener("click", (event) => {
  if (event.target.dataset.closeModal !== undefined) closeHistoryModal();
});

void refreshAdmin();
void renderHistory();
// Rafraichit l'historique toutes les 30s pour capter les nouveaux breaks termines
setInterval(() => { void renderHistory(); }, 30000);
