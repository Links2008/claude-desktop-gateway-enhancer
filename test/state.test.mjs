import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chooseStateDir,validateStateTargets} from '../src/state.mjs';
function fixture(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'gwe-state-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return base;}
function state(base,name,status){const folder=path.join(base,name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'install.json'),JSON.stringify({status}));return folder;}
test('自动识别 0.1.0 已安装备份',t=>{const base=fixture(t),legacy=state(base,'0.1.0','installed');assert.equal(chooseStateDir(base,'uninstall'),legacy);assert.equal(chooseStateDir(base,'install'),legacy);});
test('卸载后重新安装使用新目录，保留历史备份',t=>{const base=fixture(t),old=state(base,'0.1.0','uninstalled');const next=chooseStateDir(base,'install');assert.notEqual(next,old);assert(fs.existsSync(old));assert(!fs.existsSync(next));assert.notEqual(chooseStateDir(base,'install'),next);});
test('没有备份时卸载只报错，不创建目录',t=>{const base=fixture(t);assert.throws(()=>chooseStateDir(base,'uninstall'),/没有找到/);assert.equal(fs.readdirSync(base).length,0);});
test('不忽略失败后需要恢复的事务',t=>{const base=fixture(t);state(base,'broken','recovery-required');assert.throws(()=>chooseStateDir(base,'install'),/未完成/);});
test('普通安装失败已撤回时允许重试，但保留失败记录',t=>{const base=fixture(t),old=state(base,'failed','rolled-back');assert.notEqual(chooseStateDir(base,'install'),old);assert(fs.existsSync(old));});
test('多份有效备份时要求显式选择，不猜测恢复目标',t=>{const base=fixture(t);state(base,'one','installed');state(base,'two','installed');assert.throws(()=>chooseStateDir(base,'uninstall'),/多份/);});
test('卸载前拒绝备份中的其他程序路径',t=>{const root=fixture(t),context={appRoot:path.join(root,'app'),local:path.join(root,'local'),userHome:path.join(root,'user')};const data={schema:1,appRoot:context.appRoot,files:[{file:path.join(context.appRoot,'resources/ion-dist/i18n/zh-Hans.json')}],configs:[]};validateStateTargets(data,context);data.files[0].file=path.join(root,'other-program.exe');assert.throws(()=>validateStateTargets(data,context),/资源路径/);});
test('卸载前只接受原用户配置和插件修改的键',t=>{const root=fixture(t),context={appRoot:path.join(root,'app'),local:path.join(root,'local'),userHome:path.join(root,'user')};const data={schema:1,appRoot:context.appRoot,files:[],configs:[{file:path.join(context.local,'Claude-3p/config.json'),changes:[{key:'locale'}]}]};validateStateTargets(data,context);data.configs[0].changes=[{key:'inferenceGatewayApiKey'}];assert.throws(()=>validateStateTargets(data,context),/设置键/);data.configs[0].file=path.join(root,'other-user.json');assert.throws(()=>validateStateTargets(data,context),/设置路径/);});
