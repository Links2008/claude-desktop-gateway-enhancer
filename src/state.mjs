import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readJson,safePath,compatibility} from './engine.mjs';

export function validateStateTargets(state,{appRoot,local,userHome,profilePath}){
  const normalize=file=>path.resolve(file).toLowerCase();
  if(state.schema!==1||normalize(state.appRoot)!==normalize(appRoot)||!Array.isArray(state.files)||!Array.isArray(state.configs))throw Error('备份记录结构或安装目录不一致');
  const ion=path.join(appRoot,'resources/ion-dist');
  const allowed=new Set([...compatibility.files.map(e=>e.file),'i18n/zh-Hans.json','i18n/dynamic/zh-Hans.json'].map(file=>normalize(safePath(ion,file))));
  for(const file of state.files)if(!allowed.has(normalize(file.file)))throw Error('备份记录包含不属于本插件的资源路径');
  const data=path.join(local,'Claude-3p'),library=path.join(data,'configLibrary');
  const profileKeys=['chatTabEnabled','coworkTabEnabled','builtinBrowserEnabled','chatAdvancedFileAnalysisEnabled','userContentRendererUrl','deploymentDisplayName','endUserAttribution'];
  for(const config of state.configs){
    const file=normalize(config.file);let keys;
    if(file===normalize(safePath(data,'config.json')))keys=['locale'];
    else if(file===normalize(safePath(userHome,'.claude/settings.json')))keys=['disableWorkflows'];
    else if((path.dirname(file)===normalize(library)&&/^[a-z0-9-]+\.json$/.test(path.basename(file)))||(profilePath&&file===normalize(profilePath)))keys=profileKeys;
    else throw Error('备份记录包含不属于当前用户的设置路径');
    if(!Array.isArray(config.changes)||config.changes.some(change=>!keys.includes(change.key)))throw Error('备份记录包含本插件不修改的设置键');
  }
}

export function chooseStateDir(base,action){
  const active=[],incomplete=[];
  if(fs.existsSync(base)){
    if(fs.lstatSync(base).isSymbolicLink())throw Error('备份根目录不能是符号链接');
    for(const entry of fs.readdirSync(base,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw Error('备份目录包含符号链接，停止自动查找');
      if(!entry.isDirectory())continue;
      const directory=path.join(base,entry.name),file=path.join(directory,'install.json');
      if(!fs.existsSync(file))continue;
      const state=readJson(file);
      if(state.status==='installed')active.push(directory);
      else if(['prepared','recovery-required'].includes(state.status))incomplete.push(directory);
    }
  }
  if(incomplete.length)throw Error(`发现未完成的备份事务，请先检查：${incomplete.join('；')}`);
  if(active.length>1)throw Error('发现多份已安装备份，请使用“选择备份”指定对应目录');
  if(active.length===1)return active[0];
  if(action==='uninstall')throw Error('没有找到已安装的插件；如使用过自定义目录，请点击“选择备份”');
  return path.join(base,'install-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
}
