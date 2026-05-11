#!/bin/bash
# Double-clic sur ce fichier depuis le Finder pour lancer le serveur.
# Si macOS bloque l'execution, fais clic-droit -> Ouvrir une premiere fois.

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js n'est pas installe sur ce Mac."
  echo ""
  echo "  Deux options pour l'installer :"
  echo "    1) Telecharge l'installeur officiel sur https://nodejs.org (version LTS)"
  echo "    2) Si tu as Homebrew : brew install node"
  echo ""
  echo "  Puis relance ce fichier."
  echo ""
  read -n 1 -s -r -p "Appuie sur une touche pour fermer..."
  exit 1
fi

echo "Lancement du serveur NBA overlay..."

# Demarre node en arriere-plan dans cette fenetre
node server.js &
SERVER_PID=$!

# Laisse 2s pour qu'il s'initialise
sleep 2

# Ouvre l'admin dans le navigateur par defaut
open "http://127.0.0.1:4173/admin.html"

echo ""
echo "  Admin   : http://127.0.0.1:4173/admin.html"
echo "  Wheel   : http://127.0.0.1:4173/index.html?mode=streamer"
echo "  Draft   : http://127.0.0.1:4173/draft.html?mode=streamer"
echo "  Tier    : http://127.0.0.1:4173/tier.html?mode=streamer"
echo "  OBS     : utilise ensuite les liens display depuis l'admin"
echo ""
echo "  Garde cette fenetre ouverte pendant le live."
echo "  Ferme-la pour arreter le serveur (ou Ctrl+C)."
echo ""

# Si l'utilisateur ferme la fenetre, tuer node aussi
trap "kill $SERVER_PID 2>/dev/null" EXIT INT TERM

# Attendre que node se termine
wait $SERVER_PID
