#!/usr/bin/env bash
# src/ 의 확장 파일을 크롬이 로드하는 경로로 복사한다.
#
#   사용법: tools/deploy.sh [대상경로] [-y]
#
# 대상 경로는 다음 순서로 결정한다.
#   1) 명령행 인자
#   2) 환경변수 DEPLOY_TARGET
#   3) 저장소 루트의 .env 파일
# 셋 다 없으면 기본값을 넘겨짚지 않고 중단한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/src"

# .env (있으면) 읽기 — 커밋되지 않는 개인 설정
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

TARGET="${DEPLOY_TARGET:-}"
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -*) echo "알 수 없는 옵션: $arg" >&2; exit 1 ;;
    *) TARGET="$arg" ;;
  esac
done

if [ -z "$TARGET" ]; then
  cat >&2 <<'USAGE'
배포 대상 경로가 지정되지 않았습니다.

다음 중 하나로 지정하세요.
  1) cp .env.sample .env  후 DEPLOY_TARGET 값을 채웁니다 (권장)
  2) DEPLOY_TARGET=/path/to/extension npm run deploy
  3) tools/deploy.sh /path/to/extension

대상 경로는 크롬 '압축해제된 확장 프로그램 로드'로 지정한 폴더입니다.
USAGE
  exit 1
fi

if [ ! -d "$SRC_DIR" ]; then
  echo "src 디렉토리를 찾을 수 없습니다: $SRC_DIR" >&2
  exit 1
fi

echo "배포 원본: $SRC_DIR"
echo "배포 대상: $TARGET"

if [ ! -d "$TARGET" ]; then
  echo "대상 경로가 없습니다. 새로 만듭니다."
elif [ -n "$(find "$TARGET" -maxdepth 1 -type f ! -name '.*' -print -quit)" ]; then
  echo "대상 경로의 기존 파일을 덮어씁니다."
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "진행할까요? [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "취소했습니다."; exit 0 ;;
  esac
fi

mkdir -p "$TARGET"
cp -f "$SRC_DIR"/* "$TARGET"/

echo
echo "복사 완료:"
ls -1 "$TARGET"
echo
echo "크롬에서 chrome://extensions 를 열고 '새로고침'을 누른 뒤,"
echo "유튜브 페이지도 새로고침해야 content script 가 교체됩니다."
