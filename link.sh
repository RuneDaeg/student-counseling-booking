#!/bin/sh
# ---------------------------------------------------------------
#  이미 만들어 둔 Apps Script 프로젝트에 이 폴더를 연결합니다.
#  (macOS / Linux / Windows Git Bash)
#
#    sh link.sh                  ← 스크립트 ID 를 물어봅니다
#    sh link.sh <스크립트ID>     ← 바로 연결
#
#  스크립트 ID 찾는 법:
#    Apps Script 편집기 → ⚙ 프로젝트 설정 → 스크립트 ID
#
#  연결한 뒤에는 sh install.sh 를 실행할 때마다 코드가 갱신됩니다.
# ---------------------------------------------------------------
set -e
cd "$(dirname "$0")"

SCRIPT_ID="$1"

if [ -z "$SCRIPT_ID" ]; then
  echo ""
  echo "  Apps Script 편집기 → 프로젝트 설정 → 스크립트 ID 를 붙여 넣어 주세요."
  printf "  스크립트 ID: "
  read -r SCRIPT_ID
fi

# 주소를 통째로 붙여 넣어도 ID만 골라냅니다.
SCRIPT_ID=$(printf '%s' "$SCRIPT_ID" | grep -oE '[-_A-Za-z0-9]{20,}' | head -1 || true)
if [ -z "$SCRIPT_ID" ]; then
  echo "  [멈춤] 스크립트 ID 같지 않습니다."
  exit 1
fi

if [ -f ".clasp.json" ]; then
  echo ""
  echo "  이미 연결된 프로젝트가 있습니다:"
  cat .clasp.json
  printf "  덮어쓸까요? (y/N): "
  read -r ANSWER
  if [ "$ANSWER" != "y" ]; then
    echo "  그대로 두었습니다."
    exit 0
  fi
fi

printf '{"scriptId":"%s","rootDir":"src"}\n' "$SCRIPT_ID" > .clasp.json

cat <<GUIDE

  연결했습니다: $SCRIPT_ID

  이제 코드를 올리려면:
      sh install.sh

  주의: 올린 코드가 학생 화면에 반영되려면 편집기에서
        [배포 > 배포 관리 > 수정 > 새 버전] 을 해야 합니다.

GUIDE
