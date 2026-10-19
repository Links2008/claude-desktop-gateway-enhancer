$ErrorActionPreference='Stop'
$package=Get-AppxPackage -Name Claude|Where-Object{$_.PackageFamilyName-eq'Claude_pzs8sxrjxfjjc'}|Select-Object -First 1
if(-not$package){throw '没有找到原版 Claude MSIX 安装'}
$target=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude.lnk'
if(Test-Path -LiteralPath $target){Write-Output '桌面已有 Claude 快捷方式，保留原文件。';exit 0}
$shell=New-Object -ComObject WScript.Shell
$link=$shell.CreateShortcut($target)
$link.TargetPath=Join-Path $env:WINDIR 'explorer.exe'
$link.Arguments='shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude'
$link.IconLocation=(Join-Path $package.InstallLocation 'app\Claude.exe')+',0'
$link.Description='打开原版 Claude Desktop'
$link.Save()
Write-Output '桌面快捷方式已创建，指向原版安装。'
