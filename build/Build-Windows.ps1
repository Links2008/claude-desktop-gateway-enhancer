param([string]$OutputRoot,[string]$NodeArchive)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$package=Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw|ConvertFrom-Json
if(-not$OutputRoot){$OutputRoot=Join-Path $repo 'dist'}
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
$name='claude-desktop-gateway-enhancer-'+$package.version+'-windows-x64'
$target=Join-Path $OutputRoot $name
if(Test-Path -LiteralPath $target){throw '构建目录已存在，保留现场。请指定新的输出目录。'}
$nodeVersion='22.23.3'
$archiveSha='2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71'
$url='https://nodejs.org/dist/v'+$nodeVersion+'/node-v'+$nodeVersion+'-win-x64.zip'
if(-not$NodeArchive){
 $cache=Join-Path $env:LOCALAPPDATA 'ClaudeGatewayEnhancerBuild'
 New-Item -ItemType Directory -Path $cache -Force|Out-Null
 $NodeArchive=Join-Path $cache ('node-v'+$nodeVersion+'-win-x64.zip')
 if(-not(Test-Path -LiteralPath $NodeArchive)){Invoke-WebRequest -Uri $url -OutFile $NodeArchive}
}
if((Get-FileHash -LiteralPath $NodeArchive -Algorithm SHA256).Hash.ToLower()-ne$archiveSha){throw 'Node.js 官方发行文件校验失败'}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not(Test-Path -LiteralPath $compiler)){throw '需要 Windows 自带的 .NET Framework 4 编译器'}
New-Item -ItemType Directory -Path $target -Force|Out-Null
foreach($directory in @('src','locales','docs')){Copy-Item -LiteralPath (Join-Path $repo $directory) -Destination (Join-Path $target $directory) -Recurse}
foreach($file in @('package.json','README.md','LICENSE','NOTICE','CHANGELOG.md','Enhancer.ps1','Create-Shortcut.ps1')){Copy-Item -LiteralPath (Join-Path $repo $file) -Destination (Join-Path $target $file)}
$unpacked=Join-Path $OutputRoot ('node-unpacked-'+[guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $NodeArchive -DestinationPath $unpacked
$runtime=Join-Path $target 'runtime'
New-Item -ItemType Directory -Path $runtime|Out-Null
$nodeSource=Join-Path $unpacked ('node-v'+$nodeVersion+'-win-x64')
Copy-Item -LiteralPath (Join-Path $nodeSource 'node.exe') -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath (Join-Path $nodeSource 'LICENSE') -Destination (Join-Path $runtime 'LICENSE.txt')
@{version=$nodeVersion;sha256=(Get-FileHash -LiteralPath (Join-Path $runtime 'node.exe')).Hash.ToLower();source=$url;archiveSha256=$archiveSha}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtime 'manifest.json') -Encoding utf8
# 先校验后编译，发行包不依赖本机 Node 或额外 npm 模块。
foreach($mode in @('INSTALL','UNINSTALL')){
 $exe=Join-Path $target $(if($mode-eq'INSTALL'){'一键安装.exe'}else{'一键卸载.exe'})
 & $compiler /nologo /target:winexe /platform:x64 /optimize+ "/define:$mode" "/win32manifest:$(Join-Path $repo 'gui\app.manifest')" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$exe" (Join-Path $repo 'gui\Launcher.cs')
 if($LASTEXITCODE-ne0){throw '图形入口编译失败'}
 $process=Start-Process -FilePath $exe -ArgumentList '--self-test' -WindowStyle Hidden -Wait -PassThru
 if($process.ExitCode-ne0){throw '图形入口启动或运行组件自检失败'}
}
$instructions=@'
Claude Gateway 增强插件 · 双击使用

1. 先把 ZIP 中的整个文件夹解压出来。
2. 保存工作，从托盘正常退出 Claude。
3. 双击“一键安装.exe”，检查通过后点击“安装并自动备份”。
4. 需要恢复时，双击“一键卸载.exe”，点击“卸载并恢复原状”。

不需要敲命令，也不需要另外安装 Node.js。
请保留 src、locales、runtime 等文件夹，不要只复制两个 EXE。
原生 Ultra 为可选项，兼容范围和功能说明见 README.md。
备份自动保存在本机用户目录，不随安装包删除。

如果提示 Claude 正在运行，请保存并从托盘退出，再重新检查。
如果文件保护拒绝写入，可点击管理员重试；保护仍拒绝时工具会停止。
不要关闭系统保护，也不要对整个 WindowsApps 递归修改权限。
'@
$instructions|Set-Content -LiteralPath (Join-Path $target '先看这里.txt') -Encoding utf8
$zip=Join-Path $OutputRoot ($name+'.zip')
Compress-Archive -LiteralPath $target -DestinationPath $zip -CompressionLevel Optimal
$sum=(Get-FileHash -LiteralPath $zip).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $OutputRoot ($name+'.sha256')),($sum+'  '+$name+'.zip'+"`n"),[Text.UTF8Encoding]::new($false))
Write-Output ('已生成：'+$zip)
