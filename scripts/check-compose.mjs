#!/usr/bin/env node
/**
 * docker-compose / Dockerfile 静态校验
 *
 * 这台开发机装不了 Docker，所以用静态检查兜住最常见的低级错误：
 *   1. YAML 能不能解析（缩进、锚点、重复键）
 *   2. 必备服务在不在
 *   3. build.dockerfile 指向的文件存不存在
 *   4. build.target 指向的阶段在 Dockerfile 里定义没有
 *   5. depends_on 引用的服务存在吗
 *   6. compose 里用到的每个环境变量，在 .env.example 里有没有出现
 *   7. 绑定的宿主机路径会在运行时创建，这里只提示
 *
 *   node scripts/check-compose.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let errors = 0;
let warns = 0;

const fail = (msg) => {
  errors += 1;
  console.log(`  ✗ ${msg}`);
};
const warn = (msg) => {
  warns += 1;
  console.log(`  ! ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

/* ── 1. 解析 YAML ─────────────────────────────────── */
console.log('\n[1] YAML 解析');
const composePath = join(root, 'docker-compose.yml');
const raw = readFileSync(composePath, 'utf8');

let doc;
try {
  doc = parse(raw);
  ok('docker-compose.yml 语法正确');
} catch (e) {
  fail(`YAML 解析失败: ${e.message}`);
  process.exit(1);
}

const services = doc?.services ?? {};

/* ── 2. 必备服务 ──────────────────────────────────── */
console.log('\n[2] 服务定义');
for (const name of ['pb-db', 'pb-web', 'pb-worker']) {
  if (services[name]) ok(`存在 ${name}`);
  else fail(`缺少服务 ${name}`);
}

/* ── 3 & 4. 构建上下文 ────────────────────────────── */
console.log('\n[3] 构建配置');
const dockerfileCache = new Map();

function dockerfileStages(path) {
  if (dockerfileCache.has(path)) return dockerfileCache.get(path);
  const text = readFileSync(path, 'utf8');
  const stages = new Set();
  for (const m of text.matchAll(/^FROM\s+\S+(?:\s+AS\s+(\S+))?/gim)) {
    if (m[1]) stages.add(m[1].toLowerCase());
  }
  dockerfileCache.set(path, stages);
  return stages;
}

for (const [name, svc] of Object.entries(services)) {
  if (!svc?.build) continue;
  const ctx = resolve(root, svc.build.context ?? '.');
  const dfRel = svc.build.dockerfile ?? 'Dockerfile';
  const dfPath = resolve(ctx, dfRel);

  if (!existsSync(ctx)) {
    fail(`${name}: build.context 不存在 (${ctx})`);
    continue;
  }
  if (!existsSync(dfPath)) {
    fail(`${name}: Dockerfile 不存在 (${dfPath})`);
    continue;
  }
  ok(`${name}: Dockerfile 存在`);

  if (svc.build.target) {
    const stages = dockerfileStages(dfPath);
    if (stages.has(String(svc.build.target).toLowerCase())) {
      ok(`${name}: target "${svc.build.target}" 在 Dockerfile 中定义`);
    } else {
      fail(
        `${name}: target "${svc.build.target}" 未定义（现有阶段: ${
          [...stages].join(', ') || '无'
        }）`,
      );
    }
  }
}

/* ── 5. depends_on ────────────────────────────────── */
console.log('\n[4] 依赖关系');
for (const [name, svc] of Object.entries(services)) {
  const deps = svc?.depends_on;
  if (!deps) continue;
  const names = Array.isArray(deps) ? deps : Object.keys(deps);
  for (const d of names) {
    if (services[d]) ok(`${name} → ${d}`);
    else fail(`${name} 依赖了不存在的服务 ${d}`);
  }
}

/* ── 6. 环境变量与 .env.example 对齐 ──────────────── */
console.log('\n[5] 环境变量');
const envExample = existsSync(join(root, '.env.example'))
  ? readFileSync(join(root, '.env.example'), 'utf8')
  : '';
const definedInExample = new Set(
  [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);

const used = new Set();
for (const m of raw.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(?::[-?][^}]*)?\}/g)) {
  used.add(m[1]);
}

const missing = [...used].filter((v) => !definedInExample.has(v)).sort();
if (missing.length === 0) {
  ok(`${used.size} 个变量都在 .env.example 里有说明`);
} else {
  for (const v of missing) fail(`compose 用到 ${v}，但 .env.example 里没有`);
}

const required = [...raw.matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?[^}]*\}/g)].map((m) => m[1]);
if (required.length > 0) ok(`必填项: ${[...new Set(required)].join(', ')}`);

/* ── 7. 绑定路径提示 ──────────────────────────────── */
console.log('\n[6] 宿主路径');
for (const [name, svc] of Object.entries(services)) {
  for (const vol of svc?.volumes ?? []) {
    if (typeof vol !== 'string') continue;
    const host = vol.split(':')[0];
    if (!host || !host.startsWith('.')) continue;
    const abs = resolve(root, host);
    if (existsSync(abs)) ok(`${name}: ${host} 已存在`);
    else warn(`${name}: ${host} 不存在，首次启动时 Docker 会以 root 创建`);
  }
}

/* ── 汇总 ─────────────────────────────────────────── */
console.log(`\n${errors === 0 ? '✅ 通过' : '❌ 失败'}：${errors} 个错误，${warns} 个提示\n`);
process.exit(errors === 0 ? 0 : 1);
