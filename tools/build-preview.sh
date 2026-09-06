#!/bin/sh
# src/Index.html + Stylesheet.html + JavaScript.html 를 하나로 합쳐
# 브라우저에서 볼 수 있는 tools/preview.html 을 만듭니다.
#
#   sh tools/build-preview.sh && node tools/preview-server.js
#   → http://localhost:5599
#
# 가짜 데이터(tools/mock.html)로 도는 화면 확인용이라 실제 배포와는 무관합니다.

cd "$(dirname "$0")/.." || exit 1

{
  echo '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>미리보기</title>'
  cat src/Stylesheet.html
  echo '</head>'
  sed -n '/^<body>/,/^<\/body>/p' src/Index.html \
    | sed 's/<?= appTitle ?>/상담 신청/g' \
    | grep -v "include('JavaScript')" \
    | grep -v '^</body>$'
  cat tools/mock.html
  cat src/JavaScript.html
  echo '</body></html>'
} > tools/preview.html

echo "tools/preview.html 을 만들었습니다."
