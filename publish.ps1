[CmdletBinding()]param()
function main() {
  
  $SrcDir = $PSScriptRoot
  $targetDir = "C:\projects\Marc\cawoodm.github.io\minnidbmax"

  Push-Location $SrcDir
  $ver = (Get-Content -raw .\package.json | ConvertFrom-Json).version
  $msg = (git log -1)[-1].trim()
  vite build --base /minnidbmax/
  if (-not (Test-Path $targetDir)) {mkdir $targetDir | Out-Null}
  Copy-Item dist\* $targetDir -Force -Recurse
  Copy-Item .\README.md $targetDir -Force

  Push-Location $targetDir
  git add . && git commit -a -m "MinniDBMax App $($ver): $msg" && git push
  Pop-Location

  Pop-Location

}
$ErrorActionPreference = "Stop"
main

#$data = import-csv C:\marc\acc\Finances\cc.tsv -Delimiter "`t"
#$data | ConvertTo-Json