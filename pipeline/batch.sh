#!/usr/bin/env bash
# Download + convert a rectangular range of Berlin LOD2 tiles.
# Usage:  ./batch.sh <minX> <maxX> <minY> <maxY>
# Example: ./batch.sh 388 390 5818 5820   (3×3 grid around Brandenburg Gate)
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 <minX> <maxX> <minY> <maxY>" >&2
  exit 1
fi

MIN_X=$1; MAX_X=$2; MIN_Y=$3; MAX_Y=$4

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
OUT_DIR="$ROOT_DIR/public/tiles"
TOOLS="$SCRIPT_DIR/citygml-tools-2.4.0/citygml-tools"

mkdir -p "$DATA_DIR" "$OUT_DIR"

for ((y=MIN_Y; y<=MAX_Y; y++)); do
  for ((x=MIN_X; x<=MAX_X; x++)); do
    name="LoD2_${x}_${y}"
    zip="$DATA_DIR/$name.zip"
    gml="$DATA_DIR/LoD2_33_${x}_${y}_1_BE.xml"
    cj="$DATA_DIR/LoD2_33_${x}_${y}_1_BE.json"
    glb="$OUT_DIR/$name.glb"

    if [[ -f "$glb" ]]; then
      echo "skip $name (glb exists)"
      continue
    fi

    if [[ ! -f "$gml" ]]; then
      if [[ ! -f "$zip" ]]; then
        echo "download $name"
        if ! curl -sSL --fail -o "$zip" "https://gdi.berlin.de/data/a_lod2/atom/$name.zip"; then
          rm -f "$zip"
          echo "  (no tile at $x,$y — skip)"
          continue
        fi
      fi
      unzip -oq "$zip" -d "$DATA_DIR"
    fi

    if [[ ! -f "$cj" ]]; then
      echo "citygml-tools $name"
      "$TOOLS" to-cityjson -e 25833 -c -v 2.0 "$gml" >/dev/null
    fi

    echo "convert $name → glb"
    (cd "$ROOT_DIR" && npx tsx pipeline/cityjson-to-glb.ts "$cj" "$glb")
  done
done

echo "done"
ls -la "$OUT_DIR"
