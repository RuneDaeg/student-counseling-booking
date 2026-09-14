#!/usr/bin/env bash
# 날짜·시간대 관련 회귀 테스트를 모두 돌립니다. (구글 계정 없이 로컬에서 실행)
set -e
cd "$(dirname "$0")/.."
node tools/test/run-tests.js
echo
node tools/test/run-edge-tests.js
