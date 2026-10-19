import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compatibility,hash,transform,translate,configValues,safePath,install,uninstall,readJson} from '../src/engine.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-enhancer-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function planAt(root){
 const resource=path.join(root,'resource.js'),added=path.join(root,'zh.json'),profile=path.join(root,'profile.json');
 fs.writeFileSync(resource,'original');fs.writeFileSync(profile,JSON.stringify({inferenceProvider:'gateway',inferenceGatewayApiKey:'test-only-placeholder',custom:'keep'}));
 return {appRoot:root,ultra:false,files:[{file:resource,before:Buffer.from('original'),data:Buffer.from('patched')},{file:added,before:null,data:Buffer.from('{}')}],configs:[{file:profile,changes:[{key:'chatTabEnabled',beforeHad:false,afterHad:true,after:true}]}]};
}
test('唯一锚点、预期输出及已安装状态验证',()=>{
 const before=Buffer.from('hello ONE world'),after=Buffer.from('hello TWO world');
 const entry={file:'test.js',sha256:hash(before),installedSha256:hash(after),edits:[{before:'ONE',after:'TWO'}]};
 assert.deepEqual(transform(before,entry),after);assert.deepEqual(transform(after,entry),after);
 assert.throws(()=>transform(Buffer.from('unknown version'),entry),/哈希不匹配/);
 assert.throws(()=>transform(before,{...entry,edits:[{before:'missing',after:'TWO'}]}),/锚点/);
});
test('拒绝路径越界及符号链接',t=>{
 const root=fixture(t);assert.throws(()=>safePath(root,'../other'),/越界/);assert.throws(()=>safePath(root,path.resolve(root,'other')),/越界/);
 fs.symlinkSync(root,path.join(root,'link'),process.platform==='win32'?'junction':'dir');assert.throws(()=>safePath(root,'link/file'),/符号链接/);
});
test('配置仅合并功能键，Magpie 并非必需且密钥不进入差异',()=>{
 const profile={inferenceProvider:'gateway',inferenceGatewayBaseUrl:'https://gateway.example',inferenceGatewayApiKey:'test-only-placeholder',userContentRendererUrl:'https://preview.example'};
 const values=configValues(profile,{name:'我的网关'});assert.equal(values.deploymentDisplayName,'我的网关');assert(!('inferenceGatewayApiKey'in values));assert(!('userContentRendererUrl'in values));
 assert.throws(()=>configValues({inferenceProvider:'anthropic'}),/Gateway/);assert.throws(()=>configValues(profile,{name:''}),/名称/);
 assert.equal(configValues({...profile,userContentRendererUrl:'j'}).userContentRendererUrl,undefined);
});
test('真实 Ultra 补丁保留模型、版本、远程和管理员限制',()=>{
 const entry=compatibility.files.find(e=>e.file.includes('c9543'));
 const expression=entry.edits[0].after.slice('_e='.length);
 const available=new Function('G','l','u','p','e','t','o','U','he','oe','ge',`return ${expression}`);
 const args=[true,{disableWorkflows:{value:false}},false,compatibility.ultraModel,{type:'local'},{processCliVersion:compatibility.engine},'local',()=>{},true,true,true];
 assert.equal(available(...args),true);
 for(const [index,value]of [[0,false],[1,{disableWorkflows:{value:true}}],[1,{disableWorkflows:{value:false},managedSettingsPending:true}],[1,{disableWorkflows:{value:false},managedSettingsUnverified:true}],[3,'other-model'],[4,{type:'remote'}],[5,{processCliVersion:'old'}],[7,undefined],[10,false]]){const changed=[...args];changed[index]=value;assert.equal(available(...changed),false);}
});
test('语言资源与预期英文版本不一致时拒绝安装',()=>{assert.throws(()=>translate({}),/语言版本/);});
test('安装与卸载保留其他配置和新密钥，不备份整份凭据',t=>{
 const root=fixture(t),plan=planAt(root),stateDir=path.join(root,'state');install(plan,stateDir);
 assert.equal(fs.readFileSync(plan.files[0].file,'utf8'),'patched');const current=readJson(plan.configs[0].file);current.inferenceGatewayApiKey='changed-test-placeholder';current.later='preserved';fs.writeFileSync(plan.configs[0].file,JSON.stringify(current));
 assert(!fs.readFileSync(path.join(stateDir,'install.json'),'utf8').includes('test-only-placeholder'));
 uninstall(stateDir);const restored=readJson(plan.configs[0].file);assert.equal(restored.inferenceGatewayApiKey,'changed-test-placeholder');assert.equal(restored.later,'preserved');assert(!('chatTabEnabled'in restored));assert.equal(fs.readFileSync(plan.files[0].file,'utf8'),'original');assert(!fs.existsSync(plan.files[1].file));
});
test('重复安装保留原始备份',t=>{const root=fixture(t),plan=planAt(root),stateDir=path.join(root,'state');install(plan,stateDir);assert.throws(()=>install(plan,stateDir),/已经安装/);assert.equal(fs.readFileSync(path.join(stateDir,'resource-0.bin'),'utf8'),'original');});
test('资源升级后拒绝卸载，不产生部分修改',t=>{const root=fixture(t),plan=planAt(root),stateDir=path.join(root,'state');install(plan,stateDir);fs.writeFileSync(plan.files[1].file,'vendor update');assert.throws(()=>uninstall(stateDir),/资源已经变化/);assert.equal(fs.readFileSync(plan.files[0].file,'utf8'),'patched');});
test('用户修改过相关开关时拒绝卸载',t=>{const root=fixture(t),plan=planAt(root),stateDir=path.join(root,'state');install(plan,stateDir);const current=readJson(plan.configs[0].file);current.chatTabEnabled=false;fs.writeFileSync(plan.configs[0].file,JSON.stringify(current));assert.throws(()=>uninstall(stateDir),/设置已被修改/);assert.equal(fs.readFileSync(plan.files[0].file,'utf8'),'patched');});
test('安装中遇到临时文件冲突，撤回先前写入并保留恢复记录',t=>{const root=fixture(t),plan=planAt(root),stateDir=path.join(root,'state');fs.writeFileSync(plan.files[1].file+'.gateway-enhancer.tmp','busy');assert.throws(()=>install(plan,stateDir),/已撤回本次写入/);assert.equal(fs.readFileSync(plan.files[0].file,'utf8'),'original');assert.equal(readJson(path.join(stateDir,'install.json')).status,'rolled-back');});
test('备份损坏时拒绝卸载',t=>{const root=fixture(t),plan=planAt(root),stateDir=path.join(root,'state');install(plan,stateDir);fs.writeFileSync(path.join(stateDir,'resource-0.bin'),'corrupt');assert.throws(()=>uninstall(stateDir),/备份损坏/);});
test('卸载中出错时恢复已安装状态',t=>{const root=fixture(t),plan=planAt(root),stateDir=path.join(root,'state');install(plan,stateDir);fs.writeFileSync(plan.configs[0].file+'.gateway-enhancer.tmp','busy');assert.throws(()=>uninstall(stateDir),/已撤回本次写入/);assert.equal(fs.readFileSync(plan.files[0].file,'utf8'),'patched');assert(fs.existsSync(plan.files[1].file));});
