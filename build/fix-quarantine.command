#!/bin/bash
# Retire l'attribut "quarantaine" pose par macOS sur les apps non signees.
# A executer UNE SEULE FOIS apres avoir glisse "Break Overlay.app" dans /Applications.
# Double-clic ce fichier (si macOS bloque, clic-droit -> Ouvrir).

APP_PATH="/Applications/Break Overlay.app"

echo ""
echo "  ============================================="
echo "    Break Overlay - Fix Quarantine"
echo "  ============================================="
echo ""

if [ ! -d "$APP_PATH" ]; then
  echo "  ✗ L'app n'est pas dans /Applications."
  echo ""
  echo "  Avant d'executer ce fichier :"
  echo "  1. Ouvre le .dmg"
  echo "  2. Glisse 'Break Overlay.app' dans le dossier 'Applications'"
  echo "  3. Reviens ici et relance ce fichier"
  echo ""
  read -n 1 -s -r -p "Appuie sur une touche pour fermer..."
  exit 1
fi

echo "  → Suppression de l'attribut quarantaine sur $APP_PATH"
xattr -cr "$APP_PATH"

if [ $? -eq 0 ]; then
  echo ""
  echo "  ✓ C'est bon ! Tu peux maintenant ouvrir 'Break Overlay'"
  echo "    depuis Applications ou ton Launchpad."
  echo ""
  read -n 1 -s -r -p "Appuie sur une touche pour fermer..."
else
  echo ""
  echo "  ✗ Erreur. Essaie en manuel dans le Terminal :"
  echo "    xattr -cr \"$APP_PATH\""
  echo ""
  read -n 1 -s -r -p "Appuie sur une touche pour fermer..."
  exit 1
fi
