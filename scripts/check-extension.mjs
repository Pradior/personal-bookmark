#!/usr/bin/env node
/**
 * 浏览器扩展的静态校验（没有打包工具，所以只能靠这几条兜住）。
 *
 * 检查：
 *   1. manifest.json 能解析且是 MV3
 *   2. 必备字段与权限在不在
 *   3. manifest 里引用的文件是否真的存在
 *   4. popup.js / sw.js 语法能否编译（用 new Function 只编译不执行）
 *
 *   node scripts/check-extension.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'apps/extension');

let errors = 0;
const fail = (m) => {
  errors += 1;
  console.log(`  ✗ ${m}`);
};
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('\n══ 浏览器扩展 ══');

const manifestPath = join(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('manifest.json 不存在');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  ok('manifest.json 是合法 JSON');
} catch (e) {
  fail(`manifest.json 解析失败: ${e.message}`);
  process.exit(1);
}

if (manifest.manifest_version === 3) ok('manifest_version = 3');
else fail(`manifest_version 应为 3，实际 ${manifest.manifest_version}`);

for (const field of ['name', 'version', 'action', 'background']) {
  if (manifest[field]) ok(`有 ${field}`);
  else fail(`缺少 ${field}`);
}

// MV3 里 background.service_worker 必需
if (manifest.background?.service_worker) ok('background.service_worker 已声明');
else fail('缺少 background.service_worker');

// 权限：activeTab + scripting 是"注入当前页"的最小集合
const perms = manifest.permissions ?? [];
for (const p of ['activeTab', 'scripting', 'storage']) {
  if (perms.includes(p)) ok(`权限 ${p}`);
  else fail(`缺少权限 ${p}`);
}

// 刻意不申请"访问所有网站"：靠 optional_host_permissions 运行时再要
if (perms.includes('host_permissions') || Array.isArray(manifest.host_permissions)) {
  fail('不应声明静态 host_permissions（会在安装时索要全部网站权限）');
} else {
  ok('没有静态 host_permissions（运行时按需申请）');
}
if (Array.isArray(manifest.optional_host_permissions)) {
  ok('声明了 optional_host_permissions');
} else {
  fail('缺少 optional_host_permissions，运行时无法申请服务器地址权限');
}

// 引用的文件必须存在
const referenced = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
].filter(Boolean);

// 图标也要在（扩展工具栏没图标会显示成一个灰色方块）
for (const rel of Object.values(manifest.icons ?? {})) referenced.push(rel);
for (const rel of Object.values(manifest.action?.default_icon ?? {})) referenced.push(rel);

for (const rel of new Set(referenced)) {
  if (existsSync(join(dir, rel))) ok(`引用文件存在: ${rel}`);
  else fail(`manifest 引用了不存在的文件: ${rel}`);
}

// popup.html 里 <script src> 也要存在
const popupPath = join(dir, manifest.action?.default_popup ?? 'popup.html');
if (existsSync(popupPath)) {
  const html = readFileSync(popupPath, 'utf8');
  for (const m of html.matchAll(/<script\s+src="([^"]+)"/g)) {
    const src = m[1];
    if (existsSync(join(dir, src))) ok(`popup 引用的脚本存在: ${src}`);
    else fail(`popup 引用了不存在的脚本: ${src}`);
  }
}

// 语法校验：new Function 只编译不执行，能抓出括号/引号这类低级错误
for (const rel of ['popup.js', 'sw.js']) {
  const p = join(dir, rel);
  if (!existsSync(p)) {
    fail(`缺少 ${rel}`);
    continue;
  }
  try {
    new Function(readFileSync(p, 'utf8'));
    ok(`${rel} 语法正确`);
  } catch (e) {
    fail(`${rel} 语法错误: ${e.message}`);
  }
}

console.log(`\n${errors === 0 ? '✅ 通过' : '❌ 失败'}：${errors} 个错误\n`);
process.exit(errors === 0 ? 0 : 1);
