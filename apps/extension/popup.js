/**
 * popup：读取配置 → 抓当前页 → 交给 service worker 发请求。
 *
 * 为什么发请求要绕到 sw.js：
 *   MV3 里扩展页面（popup）发跨域请求会被 CORS 拦；而 service worker 在
 *   拿到该站点的 host permission 后不受 CORS 约束。所以统一由 SW 发。
 */

const DEFAULTS = { server: '', pat: '', sendHtml: true, overwrite: true };

const $ = (id) => document.getElementById(id);

function status(text, kind) {
  const el = $('status');
  el.hidden = false;
  el.className = `status${kind ? ` ${kind}` : ''}`;
  el.innerHTML = text;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  $('server').value = stored.server ?? '';
  $('pat').value = stored.pat ?? '';
  $('sendHtml').checked = stored.sendHtml !== false;
  $('overwrite').checked = stored.overwrite !== false;
}

async function saveConfig() {
  await chrome.storage.local.set({
    server: $('server').value.trim().replace(/\/+$/, ''),
    pat: $('pat').value.trim(),
    sendHtml: $('sendHtml').checked,
    overwrite: $('overwrite').checked,
  });
}

/** 只在需要时才向用户申请该站点的权限，而不是装扩展就要"访问所有网站" */
async function ensureHostPermission(serverUrl) {
  let origin;
  try {
    origin = new URL(serverUrl).origin + '/*';
  } catch {
    throw new Error('服务器地址不合法，要带 http:// 或 https:// 和端口');
  }

  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;

  // 必须在用户手势里调用，否则会被拒
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new Error(`没有获得访问 ${origin} 的权限，无法保存`);
  }
  return true;
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('拿不到当前标签页');
  return tab;
}

/**
 * 注入到页面里执行：取渲染后的 DOM + 按尺寸筛出的图片。
 *
 * 关键点：不能依赖 CSS 类名。小红书改版频繁，但"配图的 naturalWidth 很大、
 * 图标很小"这件事不会变。所以用渲染尺寸过滤，图标/头像/角标天然被排除。
 *
 * 另外要先逼出懒加载：配图往往要滚动到位置才变成真 <img>。
 */
async function grabPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1) 触发懒加载
  for (const img of Array.from(document.images)) {
    try {
      img.loading = 'eager';
      img.decoding = 'sync';
    } catch {
      /* 忽略只读属性 */
    }
  }
  const startY = window.scrollY;
  const docHeight = Math.max(
    document.body?.scrollHeight ?? 0,
    document.documentElement?.scrollHeight ?? 0,
  );
  // 分几步往下滚，让每一屏的图都有机会加载
  for (let y = 0; y < docHeight; y += Math.max(400, window.innerHeight * 0.8)) {
    window.scrollTo(0, y);
    await sleep(120);
  }
  window.scrollTo(0, startY);
  await sleep(250);

  // 2) 按渲染尺寸筛图（MIN 300px），去重、保序
  const MIN = 300;
  const seen = new Set();
  const images = [];
  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    if (!src || !/^https?:/i.test(src)) continue;
    if (img.naturalWidth < MIN || img.naturalHeight < MIN) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    images.push(src);
    if (images.length >= 40) break;
  }

  return {
    url: location.href,
    title: document.title,
    html: document.documentElement.outerHTML,
    images,
  };
}

/** 去掉标题尾巴上的站名，例如 "xxx - 小红书" */
function stripSiteSuffix(title) {
  return String(title ?? '')
    .replace(/\s*[-|–]\s*(小红书|抖音|知乎|微博|B站|bilibili)\s*$/u, '')
    .trim();
}

async function doSave() {
  const btn = $('save');
  const server = $('server').value.trim().replace(/\/+$/, '');
  const pat = $('pat').value.trim();

  if (!server) return status('请先填服务器地址', 'err');
  if (!pat) return status('请先填访问令牌（设置页可新建）', 'err');

  btn.disabled = true;
  try {
    await saveConfig();
    await ensureHostPermission(server);

    const tab = await currentTab();
    if (!/^https?:/i.test(tab.url ?? '')) {
      throw new Error('当前页面不是网页（chrome:// 或扩展页不能采集）');
    }

    status('正在读取页面…');

    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: grabPage,
    });

    const page = injected?.result;
    if (!page?.url) throw new Error('读取页面失败，可能是不允许注入的页面');

    const wantHtml = $('sendHtml').checked;
    const html = wantHtml ? page.html : undefined;

    status(
      wantHtml
        ? `正在保存…（页面 ${Math.round((html?.length ?? 0) / 1024)} KB）`
        : '正在保存（仅链接）…',
    );

    const res = await chrome.runtime.sendMessage({
      type: 'capture',
      server,
      pat,
      url: page.url,
      html,
      // 页面里按渲染尺寸筛出来的图片 —— 懒加载的配图主要靠这个补进来
      hint: {
        title: stripSiteSuffix(page.title),
        images: page.images ?? [],
      },
      // 只有真的带了 HTML 才允许覆盖，否则会把已有正文冲成空壳
      overwrite: Boolean(html) && $('overwrite').checked,
    });

    if (!res?.ok) {
      return status(`保存失败：${esc(res?.error ?? '未知错误')}`, 'err');
    }

    if (res.status === 409) {
      const id = res.body?.itemId ?? res.body?.existingItemId;
      return status(
        `这个链接已经收藏过了。${id ? `<a href="${esc(server)}/item/${esc(id)}" target="_blank">打开已有条目</a>` : ''}`,
      );
    }

    const id = res.body?.itemId;
    status(
      `已提交，正在后台抓取。<br>${
        id ? `<a href="${esc(server)}/item/${esc(id)}" target="_blank">等几秒后查看</a>` : ''
      }`,
      'ok',
    );
  } catch (err) {
    status(`出错：${esc(err?.message ?? err)}`, 'err');
  } finally {
    btn.disabled = false;
  }
}

/** 测试连接：用 /api/v1/auth/me 验证地址与令牌 */
async function doTest() {
  const server = $('server').value.trim().replace(/\/+$/, '');
  const pat = $('pat').value.trim();
  if (!server || !pat) return status('地址和令牌都要填', 'err');

  try {
    await ensureHostPermission(server);
    const res = await chrome.runtime.sendMessage({ type: 'ping', server, pat });
    if (!res?.ok) return status(`连接失败：${esc(res?.error ?? '未知错误')}`, 'err');
    if (res.status === 200) {
      return status(`连接正常，令牌可用（${esc(res.body?.authMethod ?? 'ok')}）`, 'ok');
    }
    return status(`服务器返回 ${res.status}`, 'err');
  } catch (err) {
    status(`出错：${esc(err?.message ?? err)}`, 'err');
  }
}

async function init() {
  await loadConfig();
  $('save').addEventListener('click', doSave);
  $('test').addEventListener('click', doTest);

  try {
    const tab = await currentTab();
    $('tab-title').textContent = tab?.title ? tab.title.slice(0, 60) : '（无标题页面）';
  } catch {
    $('tab-title').textContent = '读取当前标签页失败';
  }
}

init();
