#!/usr/bin/env bash
# 배포용 ZIP 생성. GitHub Releases 첨부나 웹스토어 업로드에 쓴다.
#
#   사용법: tools/package.sh [출력경로]        (기본: dist/)
#
# src/ 만 담는다. 설치하는 쪽에서 압축을 풀면 manifest.json 이 최상위에 오므로
# 그 폴더를 그대로 '압축해제된 확장 프로그램 로드'로 지정할 수 있다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/src"
OUT_DIR="${1:-$ROOT/dist}"

if [ ! -f "$SRC_DIR/manifest.json" ]; then
  echo "manifest.json 을 찾을 수 없습니다: $SRC_DIR" >&2
  exit 1
fi

# 버전은 manifest 가 기준. package.json 과 어긋나면 배포를 막는다.
MANIFEST_VERSION="$(node -p "require('$SRC_DIR/manifest.json').version")"
PACKAGE_VERSION="$(node -p "require('$ROOT/package.json').version")"
if [ "$MANIFEST_VERSION" != "$PACKAGE_VERSION" ]; then
  echo "버전이 어긋납니다. 맞춘 뒤 다시 실행하세요." >&2
  echo "  src/manifest.json : $MANIFEST_VERSION" >&2
  echo "  package.json      : $PACKAGE_VERSION" >&2
  exit 1
fi

# 다국어 리소스가 빠지면 이름/설명이 __MSG_extName__ 으로 나온다
if [ ! -d "$SRC_DIR/_locales" ]; then
  echo "_locales 디렉토리가 없습니다: $SRC_DIR/_locales" >&2
  exit 1
fi

NAME="shorts-blocker-for-youtube-$MANIFEST_VERSION.zip"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/$NAME"

( cd "$SRC_DIR" && zip -rq "$OUT_DIR/$NAME" . -x '.*' -x '*/.*' )

echo "생성: $OUT_DIR/$NAME"
echo
unzip -l "$OUT_DIR/$NAME" | tail -n +2
