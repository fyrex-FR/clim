// Petit helper partagé : lit ?sport= dans l'URL, charge sports.json,
// et expose des utilitaires pour fabriquer les URLs API avec le bon session.
// Si ?sport=nba (ou absent), on reste sur les fichiers root historiques.
// Sinon, on isole le state du sport dans sessions/sport-<id>-<scope>.json.

(function () {
  // Sports built-in qui utilisent le state root (state.json sans session).
  // Les autres (sports custom comme nfl/ucc/mlb/donruss-wc) utilisent session=sport-<id>.
  const ROOT_SPORT = "nba";
  const params = new URLSearchParams(window.location.search);
  const sportId = (params.get("sport") || ROOT_SPORT).toLowerCase().trim() || ROOT_SPORT;

  function getSessionId() {
    const explicit = params.get("session");
    if (explicit) return explicit;
    if (sportId === ROOT_SPORT) return null;
    return `sport-${sportId}`;
  }

  function buildApiUrl(pathname, extraParams = {}) {
    const url = new URL(pathname, window.location.href);
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v != null) url.searchParams.set(k, v);
    });
    const session = getSessionId();
    if (session) url.searchParams.set("session", session);
    return url.toString();
  }

  async function loadSport() {
    const response = await fetch("./api/config/sports", { cache: "no-store" });
    if (!response.ok) throw new Error(`sports.json: HTTP ${response.status}`);
    const sports = await response.json();
    const sport = sports[sportId];
    if (!sport) throw new Error(`Sport inconnu: ${sportId}`);
    // Applique la classe "sport-round" sur le body si demande par le sport
    if (sport.logoStyle === "round") {
      document.body.classList.add("sport-round");
    }
    return { id: sportId, label: sport.label, teams: sport.teams, logoStyle: sport.logoStyle, all: sports };
  }

  window.AppSport = {
    id: sportId,
    getSessionId,
    buildApiUrl,
    loadSport,
  };
})();
