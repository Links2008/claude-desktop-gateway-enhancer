#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {compatibility,buildPlan,install,uninstall,readJson,hash} from './engine.mjs';

const args=process.argv.slice(2),action=args.shift()??'help';
const help=`Claude Desktop Gateway Enhancer 0.1.0

用法：node src/cli.mjs <doctor|install|uninstall> [选项]
  --dry-run          仅预览，不写文件
  --ultra            启用已验证的本机原生 Ultra 适配（可选）
  --name <名称>     自定义 Gateway 显示名称（不改 Windows 用户名）
  --app-root <路径> 指定原版 app 目录；默认发现原 MSIX 安装
  --profile <路径>  指定现有 Gateway 配置；默认使用已应用配置
  --state-dir <路径>指定本机备份目录；禁止放在本项目中

支持 Windows Claude Desktop ${compatibility.version}，Node.js 22+。
Magpie 可选；先在原版客户端配置可用的 Gateway，再安装本补丁。
install/uninstall 前保存工作并从托盘正常退出 Claude。
本工具不修改 ACL/所有权，不安装原版应用，不提供或上传凭据。`;
if(action==='help'||action==='--help'||args.includes('--help')){console.log(help);process.exit(0);}
try{
  if(process.platform!=='win32')throw Error('本发行版仅支持 Windows');
  if(!['doctor','install','uninstall'].includes(action))throw Error('未知操作');
  const options={};
  while(args.length){const key=args.shift();if(['--dry-run','--ultra'].includes(key))options[key]=true;else if(['--name','--app-root','--profile','--state-dir'].includes(key)){const value=args.shift();if(!value||value.startsWith('--'))throw Error(`缺少参数：${key}`);options[key]=value;}else throw Error(`未知选项：${key}`);}
  const local=process.env.LOCALAPPDATA;if(!local)throw Error('缺少 LOCALAPPDATA');
  const powershell=script=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true}).replace(/^\uFEFF/,'').trim();
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const stateDir=path.resolve(options['--state-dir']??path.join(local,'ClaudeGatewayEnhancer','0.1.0'));
  const repo=path.resolve(import.meta.dirname,'..'),relative=path.relative(repo,stateDir);
  if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw Error('备份必须保存在项目外，防止被提交到公开仓库');
  const stateFile=path.join(stateDir,'install.json');
  let appRoot=options['--app-root'];
  if(!appRoot&&fs.existsSync(stateFile))appRoot=readJson(stateFile).appRoot;
  if(!appRoot){
    const found=JSON.parse(powershell("@(Get-AppxPackage -Name Claude | Select-Object InstallLocation,Version,PackageFamilyName) | ConvertTo-Json -Compress")||'[]');
    const packages=Array.isArray(found)?found:[found],match=packages.find(p=>p.PackageFamilyName===compatibility.family&&p.Version===compatibility.packageVersion);
    if(!match)throw Error(`没有找到受支持的原版 ${compatibility.version} MSIX 安装；不会自动下载或降级`);
    appRoot=path.join(match.InstallLocation,'app');
  }
  appRoot=path.resolve(appRoot);
  if(!fs.existsSync(path.join(appRoot,'Claude.exe')))throw Error('所选目录不是原版 app 目录');
  const version=powershell(`(Get-Item -LiteralPath ${quote(path.join(appRoot,'Claude.exe'))}).VersionInfo.ProductVersion`);
  if(version!==compatibility.version)throw Error(`程序版本 ${version} 不兼容；仅支持 ${compatibility.version}`);
  const running=powershell(`@(Get-Process -Name Claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${quote(path.join(appRoot,'Claude.exe'))} }).Count`)!=='0';
  if(action!=='doctor'&&!options['--dry-run']&&running)throw Error('Claude 正在运行；请保存工作并从托盘正常退出后重试');
  if(action==='uninstall'){
    if(options['--dry-run']){const state=readJson(stateFile);console.log(`将恢复 ${state.files.length} 个资源，合并恢复 ${state.configs.length} 份设置；没有写入。`);}
    else{uninstall(stateDir);console.log('已恢复安装前状态；备份保留供检查。');}
    process.exit(0);
  }
  if(fs.existsSync(stateFile)){
    const state=readJson(stateFile);
    if(state.status==='installed'){
      for(const f of state.files)if(hash(fs.readFileSync(f.file))!==f.afterHash)throw Error('已安装资源发生变化，请勿跨版本覆盖');
      console.log(`已安装 v${state.pluginVersion}；资源完整。备份：${stateDir}`);process.exit(0);
    }
    throw Error('存在历史备份事务；请改用新的空备份目录，不要覆盖旧备份');
  }
  const dataRoot=path.join(local,'Claude-3p'),library=path.join(dataRoot,'configLibrary');
  let profilePath=options['--profile'];
  if(!profilePath){const id=readJson(path.join(library,'_meta.json')).appliedId;if(!/^[a-zA-Z0-9-]+$/.test(id??''))throw Error('当前 Gateway 配置标识无效');profilePath=path.join(library,id+'.json');}
  const plan=buildPlan({appRoot,profilePath:path.resolve(profilePath),localePath:path.join(dataRoot,'config.json'),codeSettingsPath:path.join(process.env.USERPROFILE,'.claude/settings.json'),ultra:!!options['--ultra'],name:options['--name']});
  console.log(`版本 ${compatibility.version}、补丁锚点和语言资源检查通过。`);
  console.log(`待更新资源：${plan.files.length}；待合并设置：${plan.configs.length}；Ultra：${plan.ultra?'启用受限适配':'保持原样'}。`);
  if(action==='doctor'||options['--dry-run']){console.log('仅检查，没有写入。');process.exit(0);}
  install(plan,stateDir);console.log(`安装完成。备份：${stateDir}\n请从原版快捷方式启动 Claude。`);
}catch(error){console.error(`操作停止：${error.message}`);process.exitCode=1;}
