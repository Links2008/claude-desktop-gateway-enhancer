param(
 [ValidateSet('doctor','install','uninstall')][string]$Action='doctor',
 [switch]$DryRun,[switch]$Ultra,[string]$Name,[string]$AppRoot,[string]$Profile,[string]$StateDir
)
$ErrorActionPreference='Stop'
if(-not(Get-Command node -ErrorAction SilentlyContinue)){throw '请先安装 Node.js 22 或更新版本'}
$arguments=@((Join-Path $PSScriptRoot 'src\cli.mjs'),$Action)
if($DryRun){$arguments+='--dry-run'}
if($Ultra){$arguments+='--ultra'}
foreach($entry in @(@('--name',$Name),@('--app-root',$AppRoot),@('--profile',$Profile),@('--state-dir',$StateDir))){if($entry[1]){$arguments+=$entry}}
& node @arguments
exit $LASTEXITCODE
