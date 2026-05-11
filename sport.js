// Petit helper partagé : lit ?sport= dans l'URL, charge sports.json,
// et expose des utilitaires pour fabriquer les URLs API avec le bon session.
// Si ?sport=nba (ou absent), on reste sur les fichiers root historiques.
// Sinon, on isole le state du sport dans sessions/sport-<id>-<scope>.json.

(function () {
  const SUPPORTED = ["nba", "nfl", "ucc"];
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get("sport") || "nba").toLowerCase();
  const sportId = SUPPORTED.includes(requested) ? requested : "nba";

  function getSessionId() {
    // ?session= explicite l'emporte toujours
    const explicit = params.get("session");
    if (explicit) return explicit;
    if (sportId === "nba") return null; // null => le serveur tape sur state.json root
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
    return { id: sportId, label: sport.label, teams: sport.teams, all: sports };
  }

  window.AppSport = {
    id: sportId,
    isSupported: (s) => SUPPORTED.includes(s),
    getSessionId,
    buildApiUrl,
    loadSport,
  };
})();
