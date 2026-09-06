# ---------------------------------------------------------------
#  상담 신청 웹앱 설치 (Windows PowerShell)
#
#    .\install.ps1
#
#  하는 일:
#    1) 구글 계정 로그인 (브라우저가 열립니다)
#    2) 새 구글 스프레드시트 + 그 시트에 붙은 Apps Script 프로젝트 생성
#    3) 코드 업로드
#    4) 편집기 열기
#
#  필요한 것: Node.js 18 이상
#  미리 켜 둘 것: https://script.google.com/home/usersettings 에서
#                "Google Apps Script API" 를 사용 설정 (한 번만)
# ---------------------------------------------------------------
param([string]$Title = "상담 신청")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  상담 신청 웹앱 설치를 시작합니다."
Write-Host "  만들 이름: $Title"
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  [멈춤] Node.js 가 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요."
    exit 1
}

function Invoke-Clasp {
    param([string[]]$ClaspArgs)
    & npx --yes "@google/clasp@latest" @ClaspArgs
    return $LASTEXITCODE
}

if (Test-Path ".clasp.json") {
    Write-Host "  이미 설치된 프로젝트가 있습니다. 코드만 새로 올립니다."
    Invoke-Clasp @("push", "--force") | Out-Null
    Invoke-Clasp @("open-script") | Out-Null
    exit 0
}

Write-Host "  [1/4] 구글 계정 로그인 (브라우저가 열립니다)"
if ((Invoke-Clasp @("login")) -ne 0) {
    Write-Host "  [멈춤] 로그인에 실패했습니다."
    exit 1
}

Write-Host ""
Write-Host "  [2/4] 구글 드라이브에 스프레드시트와 스크립트를 만듭니다"
if ((Invoke-Clasp @("create-script", "--type", "sheets", "--title", $Title, "--rootDir", "src")) -ne 0) {
    Write-Host ""
    Write-Host "  [멈춤] 만들지 못했습니다. 아래를 확인해 주세요."
    Write-Host "     https://script.google.com/home/usersettings 에서"
    Write-Host "     'Google Apps Script API' 를 사용 설정한 뒤 다시 실행하세요."
    exit 1
}

Write-Host ""
Write-Host "  [3/4] 코드를 올립니다"
Invoke-Clasp @("push", "--force") | Out-Null

Write-Host ""
Write-Host "  [4/4] 편집기를 엽니다"
Invoke-Clasp @("open-script") | Out-Null

Write-Host @"

  ─────────────────────────────────────────────
  업로드까지 끝났습니다. 이제 브라우저에서 3단계만 하면 됩니다.

  1. 방금 만들어진 스프레드시트를 엽니다
     (편집기 왼쪽 위 프로젝트 이름 → 또는 드라이브에서 찾기)

  2. 상단 [상담 관리] 메뉴 → ① 최초 설정 실행 → 권한 허용
     이어서 ② AI 키 등록 (console.anthropic.com 에서 발급)

  3. Apps Script 편집기 → 배포 → 새 배포 → 웹 앱
     · 실행 계정: 나
     · 액세스 권한: 모든 사용자
     나온 주소를 학생에게 알려 주면 끝입니다.

  자세한 설명은 README.md 를 봐 주세요.
  ─────────────────────────────────────────────

"@
