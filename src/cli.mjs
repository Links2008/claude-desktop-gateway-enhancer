#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {compatibility,pluginVersion,buildPlan,install,uninstall,prepareUninstall,readJson,hash} from './engine.mjs';
import {chooseStateDir,validateStateTargets} from './state.mjs';

const args=process.argv.slice(2),action=args.shift()??'help',json=args.includes('--json');
function result(value){console.log(json?JSON.stringify({ok:true,pluginVersion,...value}):value.message);}
const help=`Claude Desktop Gateway Enhancer ${pluginVersion}

用法：node src/cli.mjs <doctor|install|uninstall> [选项]
  --dry-run          仅预览，不写文件
  --ultra            启用已验证的本机原生 Ultra 适配（可选）
  --name <名称>     自定义 Gateway 显示名称
  --app-root <路径> 指定原版 app 目录；默认发现原 MSIX 安装
  --profile <路径>  指定现有 Gateway 配置；默认使用已应用配置
  --state-dir <路径>指定备份；默认自动查找，重装时保留历史备份
  --json             输出供图形安装器读取的结果
  --user-local <路径>原用户 LOCALAPPDATA（管理员重试时保持上下文）
  --user-home <路径> 原用户 USERPROFILE（管理员重试时保持上下文）

普通用户请双击发行包中的“一键安装.exe”或“一键卸载.exe”。
支持 Windows Claude Desktop ${compatibility.version}，命令行入口需要 Node.js 22+。
完整双击包已内置运行组件，Magpie 可选。操作前请保存并正常退出 Claude。`;
if(action==='help'||action==='--help'||args.includes('--help')){console.log(help);process.exit(0);}
try{
  if(process.platform!=='win32')throw Error('本发行版仅支持 Windows');
  if(!['doctor','install','uninstall'].includes(action))throw Error('未知操作');
  const options={};
  while(args.length){const key=args.shift();if(['--dry-run','--ultra','--json'].includes(key))options[key]=true;else if(['--name','--app-root','--profile','--state-dir','--user-local','--user-home'].includes(key)){const value=args.shift();if(!value||value.startsWith('--'))throw Error(`缺少参数：${key}`);options[key]=value;}else throw Error(`未知选项：${key}`);}
  const local=options['--user-local']??process.env.LOCALAPPDATA,userHome=options['--user-home']??process.env.USERPROFILE;
  if(!local||!userHome)throw Error('缺少用户目录上下文');
  const powershell=script=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'+script],{encoding:'utf8',windowsHide:true}).replace(/^\uFEFF/,'').trim();
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const stateDir=options['--state-dir']?path.resolve(options['--state-dir']):chooseStateDir(path.join(local,'ClaudeGatewayEnhancer'),action);
  const repo=path.resolve(import.meta.dirname,'..'),relative=path.relative(repo,stateDir);
  if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw Error('备份必须保存在项目外');
  const stateFile=path.join(stateDir,'install.json');
  let appRoot=options['--app-root'];
  if(!appRoot&&fs.existsSync(stateFile))appRoot=readJson(stateFile).appRoot;
  if(!appRoot){
    const found=JSON.parse(powershell("@(Get-AppxPackage -Name Claude | Select-Object InstallLocation,Version,PackageFamilyName) | ConvertTo-Json -Compress")||'[]');
    const packages=Array.isArray(found)?found:[found],match=packages.find(p=>p.PackageFamilyName===compatibility.family&&p.Version===compatibility.packageVersion);
    if(!match)throw Error(`没有找到受支持的原版 ${compatibility.version} MSIX 安装；不会下载或降级`);
    appRoot=path.join(match.InstallLocation,'app');
  }
  appRoot=path.resolve(appRoot);
  if(!fs.existsSync(path.join(appRoot,'Claude.exe')))throw Error('所选目录不是原版 app 目录');
  const version=powershell(`(Get-Item -LiteralPath ${quote(path.join(appRoot,'Claude.exe'))}).VersionInfo.ProductVersion`);
  if(version!==compatibility.version)throw Error(`程序版本 ${version} 不兼容；仅支持 ${compatibility.version}`);
  const running=powershell(`@(Get-Process -Name Claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${quote(path.join(appRoot,'Claude.exe'))} }).Count`)!=='0';
  const common={appVersion:version,appRoot,stateDir,running};
  if(action!=='doctor'&&!options['--dry-run']&&running)throw Error('Claude 正在运行；请保存工作并从托盘正常退出，再点击重试');
  if(action==='uninstall'){
    validateStateTargets(readJson(stateFile),{appRoot,local,userHome,profilePath:options['--profile']});
    const {state}=prepareUninstall(stateDir);
    if(options['--dry-run'])result({...common,status:'ready',message:`卸载检查通过：将恢复 ${state.files.length} 个资源和 ${state.configs.length} 份设置；没有写入。`});
    else{uninstall(stateDir);result({...common,status:'uninstalled',message:'卸载完成，已恢复安装前状态。历史备份保留，会话和其他设置保留。'});}
    process.exit(0);
  }
  if(fs.existsSync(stateFile)){
    const state=readJson(stateFile);
    if(state.status==='installed'){
      validateStateTargets(state,{appRoot,local,userHome,profilePath:options['--profile']});
      for(const f of state.files)if(hash(fs.readFileSync(f.file))!==f.afterHash)throw Error('已安装资源发生变化，请勿跨版本覆盖');
      result({...common,status:'installed',message:`已安装 v${state.pluginVersion}；资源完整，原始备份保留。`});process.exit(0);
    }
    throw Error('所选备份不是已安装状态；请检查备份记录');
  }
  const dataRoot=path.join(local,'Claude-3p'),library=path.join(dataRoot,'configLibrary');
  let profilePath=options['--profile'];
  if(!profilePath){const id=readJson(path.join(library,'_meta.json')).appliedId;if(!/^[a-zA-Z0-9-]+$/.test(id??''))throw Error('当前 Gateway 配置标识无效');profilePath=path.join(library,id+'.json');}
  const plan=buildPlan({appRoot,profilePath:path.resolve(profilePath),localePath:path.join(dataRoot,'config.json'),codeSettingsPath:path.join(userHome,'.claude/settings.json'),ultra:!!options['--ultra'],name:options['--name']});
  const summary={...common,status:'ready',resourceChanges:plan.files.length,settingChanges:plan.configs.length,ultra:plan.ultra};
  if(action==='doctor'||options['--dry-run'])result({...summary,message:`版本和资源检查通过。待更新 ${plan.files.length} 个资源、合并 ${plan.configs.length} 份设置；仅检查，没有写入。${running?'请先保存并退出 Claude。':''}`});
  else{install(plan,stateDir);result({...summary,status:'installed',message:'安装完成，自动备份已保存。请从原版快捷方式启动 Claude。'});}
}catch(error){console.error(json?JSON.stringify({ok:false,error:error.message}):`操作停止：${error.message}`);process.exitCode=1;}
