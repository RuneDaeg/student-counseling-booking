# ---------------------------------------------------------------
#  이미 만들어 둔 Apps Script 프로젝트에 이 폴더를 연결합니다. (Windows PowerShell)
#
#    .\link.ps1                     ← 스크립트 ID 를 물어봅니다
#    .\link.ps1 <스크립트ID>        ← 바로 연결
#
#  스크립트 ID 찾는 법:
#    Apps Script 편집기 → ⚙ 프로젝트 설정 → 스크립트 ID
#    (편집기 주소창의 /projects/ 와 /edit 사이 글자여도 됩니다)
#
#  연결한 뒤에는 .\install.ps1 을 실행할 때마다 코드가 갱신됩니다.
# ---------------------------------------------------------------
param([string]$ScriptId)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $ScriptId) {
    Write-Host ""
    Write-Host "  Apps Script 편집기 → 프로젝트 설정 → 스크립트 ID 를 붙여 넣어 주세요."
    $ScriptId = Read-Host "  스크립트 ID"
}

# 주소를 통째로 붙여 넣어도 ID만 골라냅니다.
if ($ScriptId -match "[-_A-Za-z0-9]{20,}") {
    $ScriptId = $Matches[0]
} else {
    Write-Host "  [멈춤] 스크립트 ID 같지 않습니다: $ScriptId"
    exit 1
}

if (Test-Path ".clasp.json") {
    Write-Host ""
    Write-Host "  이미 연결된 프로젝트가 있습니다:"
    Get-Content .clasp.json | Write-Host
    $answer = Read-Host "  덮어쓸까요? (y/N)"
    if ($answer -ne "y") {
        Write-Host "  그대로 두었습니다."
        exit 0
    }
}

# BOM 없이 써야 clasp 가 읽을 수 있습니다. 내용이 전부 ASCII 라 -Encoding ascii 로 충분합니다.
Set-Content -Path ".clasp.json" -Value "{`"scriptId`":`"$ScriptId`",`"rootDir`":`"src`"}" -Encoding ascii

Write-Host ""
Write-Host "  연결했습니다: $ScriptId"
Write-Host ""
Write-Host "  이제 코드를 올리려면:"
Write-Host "      .\install.ps1"
Write-Host ""
Write-Host "  주의: 올린 코드가 학생 화면에 반영되려면 편집기에서"
Write-Host "        [배포 > 배포 관리 > 수정 > 새 버전] 을 해야 합니다."
Write-Host ""
