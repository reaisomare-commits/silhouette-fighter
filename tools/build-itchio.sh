#!/usr/bin/env bash
# itch.io にアップロードする zip を作る（遊ぶのに要るファイルだけ入れる）。
# 使い方: bash tools/build-itchio.sh [出力先のフォルダ]   （省略すると dist/）
# zip の中は index.html が一番上にくる形（itch.io の「HTML」形式の決まり）。
set -euo pipefail
cd "$(dirname "$0")/.."
out_dir="${1:-dist}"
version=$(node -p "require('./package.json').version")
name="silhouette-fighter-${version}-itchio.zip"
mkdir -p "$out_dir"
out="$(cd "$out_dir" && pwd)/$name"
rm -f "$out"
# index.html が読み込むファイルを全部入れる（読み込み漏れがあれば止める）
files=(index.html)
while read -r src; do
  [ -f "$src" ] || { echo "見つからないファイル: $src" >&2; exit 1; }
  files+=("$src")
done < <(grep -o 'src="[^"]*\.js"' index.html | sed 's/^src="//; s/"$//')
zip -q -X "$out" "${files[@]}"
echo "作成: $out（${#files[@]} ファイル、$(du -h "$out" | cut -f1)）"
