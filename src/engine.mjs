import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const compatibility=JSON.parse(fs.readFileSync(path.join(root,'src/patches.json'),'utf8'));
const translations=JSON.parse(fs.readFileSync(path.join(root,'locales/zh-Hans.json'),'utf8'));
export const hash=data=>crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
export const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export function safePath(base,relative){
  const result=path.resolve(base,relative),rel=path.relative(path.resolve(base),result);
  if(!relative||path.isAbsolute(relative)||rel.startsWith('..')||rel==='')throw Error('拒绝越界路径');
  // 不沿符号链接修改其他安装或用户文件。
  let cursor=path.resolve(base);
  for(const part of rel.split(path.sep)){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('拒绝符号链接路径');}
  return result;
}
export function transform(source,entry){
  if(hash(source)===entry.installedSha256)return source;
  if(hash(source)!==entry.sha256)throw Error(`版本或文件哈希不匹配：${entry.file}`);
  let output=source.toString('utf8');
  for(const {before,after}of entry.edits){if(output.split(before).length!==2)throw Error(`补丁锚点不唯一：${entry.file}`);output=output.replace(before,after);}
  const data=Buffer.from(output);
  if(hash(data)!==entry.installedSha256)throw Error(`补丁输出哈希不匹配：${entry.file}`);
  return data;
}
function tokens(text){return [...text.matchAll(/\{\s*([\w]+)\s*\}|<\/?([A-Za-z][\w-]*)\s*\/?>/g)].map(m=>m[0].replace(/\s/g,'')).sort().join('|');}
export function translate(en){
  const zh={...en};
  for(const [key,value]of Object.entries(translations)){
    if(!(key in en)||tokens(en[key])!==tokens(value))throw Error(`语言版本或占位符不兼容：${key}`);
    zh[key]=value;
  }
  return zh;
}
export function configValues(current,{name}={}){
  if(current.inferenceProvider!=='gateway')throw Error('仅支持已经配置好的 Gateway 模式；请先配置推理服务');
  if(name!==undefined&&(!name.trim()||name.length>80))throw Error('显示名称应为 1–80 个字符');
  const values={chatTabEnabled:true,coworkTabEnabled:true,builtinBrowserEnabled:true,chatAdvancedFileAnalysisEnabled:true};
  // 仅修正本项目实测的无效覆盖值，不覆盖用户自建的预览服务。
  if(current.userContentRendererUrl==='j')values.userContentRendererUrl=undefined;
  if(name!==undefined){values.deploymentDisplayName=name;values.endUserAttribution=false;}
  return values;
}
export function buildPlan({appRoot,profilePath,localePath,codeSettingsPath,ultra=false,name}){
  const ion=path.join(appRoot,'resources/ion-dist');
  const files=[];
  function add(file,data){const before=fs.existsSync(file)?fs.readFileSync(file):null;if(before&&!Buffer.compare(before,data))return;files.push({file,before,data});}
  for(const entry of compatibility.files){
    // 即便不启用 Ultra，也检查本版本全部相关脚本。
    const file=safePath(ion,entry.file),source=fs.readFileSync(file);
    const output=transform(source,entry);
    if(entry.feature!=='ultra'||ultra)add(file,output);
  }
  const en=readJson(path.join(ion,'i18n/en-US.json'));
  const zhFile=path.join(ion,'i18n/zh-Hans.json');
  const zh=translate(en);
  if(fs.existsSync(zhFile)){
    const existing=readJson(zhFile);
    // 用户已有的其他翻译保留；本插件负责的消息以本版本资源为准。
    for(const key of Object.keys(en))if(!(key in translations)&&typeof existing[key]==='string'&&tokens(en[key])===tokens(existing[key]))zh[key]=existing[key];
  }
  add(zhFile,Buffer.from(JSON.stringify(zh)));
  add(path.join(ion,'i18n/dynamic/zh-Hans.json'),fs.readFileSync(path.join(ion,'i18n/dynamic/en-US.json')));
  const configs=[];
  const settings=[[profilePath,configValues(readJson(profilePath),{name})],[localePath,{locale:'zh-Hans'}]];
  if(ultra&&codeSettingsPath)settings.push([codeSettingsPath,{disableWorkflows:false}]);
  for(const [file,values]of settings){
    const current=fs.existsSync(file)?readJson(file):{},changes=[];
    for(const [key,value]of Object.entries(values)){
      const had=Object.hasOwn(current,key),before=current[key];
      if((!had&&value===undefined)||(had&&JSON.stringify(before)===JSON.stringify(value)))continue;
      changes.push({key,beforeHad:had,...had?{before}: {},afterHad:value!==undefined,...value!==undefined?{after:value}: {}});
    }
    if(changes.length)configs.push({file,changes});
  }
  return {appRoot,files,configs,ultra};
}
function replace(file,data){const temp=file+'.gateway-enhancer.tmp';if(fs.existsSync(temp))throw Error(`临时文件已存在：${temp}`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temp,data);try{fs.renameSync(temp,file);}catch(e){fs.rmSync(temp,{force:true});throw e;}}
function changedConfig(file,changes,direction){
  const current=fs.existsSync(file)?readJson(file):{};
  for(const c of changes){const key=c.key,from=direction==='install'?'before':'after',to=direction==='install'?'after':'before';
    if(Object.hasOwn(current,key)!==c[from+'Had']||(c[from+'Had']&&JSON.stringify(current[key])!==JSON.stringify(c[from])))throw Error(`设置已被修改，停止操作：${key}`);
    if(c[to+'Had'])current[key]=c[to];else delete current[key];
  }
  return Buffer.from(JSON.stringify(current,null,2)+'\n');
}
export function install(plan,stateDir){
  const stateFile=path.join(stateDir,'install.json');
  if(fs.existsSync(stateFile))throw Error('已经安装；先 doctor 检查，或卸载后再更改安装选项');
  fs.mkdirSync(stateDir,{recursive:true});
  if(fs.readdirSync(stateDir).length)throw Error('备份目录非空，保留现场并停止');
  const records=plan.files.map((f,i)=>({file:f.file,existed:f.before!==null,beforeHash:f.before&&hash(f.before),afterHash:hash(f.data),backup:`resource-${i}.bin`}));
  const configData=plan.configs.map(c=>changedConfig(c.file,c.changes,'install'));
  const state={schema:1,pluginVersion:'0.1.0',appRoot:plan.appRoot,ultra:plan.ultra,status:'prepared',files:records,configs:plan.configs};
  for(let i=0;i<plan.files.length;i++)if(plan.files[i].before)fs.writeFileSync(safePath(stateDir,records[i].backup),plan.files[i].before);
  fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  const written=[],configsWritten=[];
  try{
    for(const f of plan.files){if((fs.existsSync(f.file)?hash(fs.readFileSync(f.file)):null)!==(f.before?hash(f.before):null))throw Error('部署前资源已变化');replace(f.file,f.data);written.push(f);}
    for(let i=0;i<plan.configs.length;i++){const c=plan.configs[i];const fresh=changedConfig(c.file,c.changes,'install');if(Buffer.compare(fresh,configData[i]))throw Error('部署前配置已变化');replace(c.file,fresh);configsWritten.push(c);}
    state.status='installed';fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  }catch(error){
    const failures=[];
    for(const c of configsWritten.reverse())try{replace(c.file,changedConfig(c.file,c.changes,'uninstall'));}catch(e){failures.push(e.message);}
    for(const f of written.reverse())try{if(f.before)replace(f.file,f.before);else fs.rmSync(f.file);}catch(e){failures.push(e.message);}
    state.status=failures.length?'recovery-required':'rolled-back';state.failures=failures;fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
    throw Error(`安装失败，${failures.length?'需要人工恢复':'已撤回本次写入'}：${error.message}`);
  }
  return state;
}
export function uninstall(stateDir){
  const stateFile=path.join(stateDir,'install.json'),state=readJson(stateFile);
  if(state.status!=='installed')throw Error('备份事务未处于已安装状态，请检查备份记录');
  // 先验证全部资源与备份，升级或后续修改时不覆盖现场。
  for(const f of state.files){if(hash(fs.readFileSync(f.file))!==f.afterHash)throw Error('资源已经变化，请勿跨版本回滚');if(f.existed&&hash(fs.readFileSync(safePath(stateDir,f.backup)))!==f.beforeHash)throw Error('备份损坏');}
  const configData=state.configs.map(c=>changedConfig(c.file,c.changes,'uninstall'));
  const resourceBefore=state.files.map(f=>fs.readFileSync(f.file)),written=[],configsWritten=[];
  try{
    for(let i=0;i<state.files.length;i++){const f=state.files[i];if(f.existed)replace(f.file,fs.readFileSync(safePath(stateDir,f.backup)));else fs.rmSync(f.file);written.push(i);}
    for(let i=0;i<state.configs.length;i++){replace(state.configs[i].file,configData[i]);configsWritten.push(i);}
  }catch(error){
    const failures=[];
    for(const i of configsWritten.reverse())try{const c=state.configs[i];replace(c.file,changedConfig(c.file,c.changes,'install'));}catch(e){failures.push(e.message);}
    for(const i of written.reverse())try{replace(state.files[i].file,resourceBefore[i]);}catch(e){failures.push(e.message);}
    if(failures.length){state.status='recovery-required';state.failures=failures;fs.writeFileSync(stateFile,JSON.stringify(state,null,2));}
    throw Error(`卸载失败，${failures.length?'需要人工恢复':'已撤回本次写入'}：${error.message}`);
  }
  state.status='uninstalled';fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  return state;
}
