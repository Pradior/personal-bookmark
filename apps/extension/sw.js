/**
 * service worker：替 popup 发跨域请求。
 *
 * popup 页面发请求会受 CORS 约束，而 SW 在拥有该 origin 的 host permission
 * 之后不受约束 —— 我们的服务端没有（也不需要）开 CORS 头。
 */

const PAT_HEADER = (pat) => ({ authorization: `Bearer ${pat}` });

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 把网络层错误翻译成人看得懂的话 */
function describeNetworkError(err, server) {
  const msg = err?.message ?? String(err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return `连不上 ${server}。检查地址/端口是否正确，以及手机或电脑能否访问到它`;
  }
  return msg;
}

async function handleCapture({ server, pat, url, html, overwrite }) {
  const body = { url, client: 'extension' };
  if (typeof html === 'string' && html.length > 200) body.html = html;
  if (overwrite === true && body.html) body.overwrite = true;

  let res;
  try {
    res = await fetch(`${server}/api/v1/capture`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...PAT_HEADER(pat),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: describeNetworkError(err, server) };
  }

  const parsed = await readJson(res);

  if (res.ok || res.status === 409) {
    return { ok: true, status: res.status, body: parsed };
  }

  const message =
    parsed?.error?.message ??
    (res.status === 401
      ? '令牌无效或已过期，去设置页重新建一个'
      : res.status === 403
        ? '该令牌没有 capture 权限'
        : res.status === 413
          ? '页面太大，取消勾选「发送整页 HTML」再试'
          : `HTTP ${res.status}`);
  return { ok: false, status: res.status, error: message };
}

async function handlePing({ server, pat }) {
  let res;
  try {
    res = await fetch(`${server}/api/v1/auth/me`, {
      headers: PAT_HEADER(pat),
      cache: 'no-store',
    });
  } catch (err) {
    return { ok: false, error: describeNetworkError(err, server) };
  }
  const body = await readJson(res);
  return { ok: true, status: res.status, body };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // 必须返回 true 保持消息通道，等异步结果
  if (msg?.type === 'capture') {
    handleCapture(msg).then(sendResponse, (err) =>
      sendResponse({ ok: false, error: String(err?.message ?? err) }),
    );
    return true;
  }
  if (msg?.type === 'ping') {
    handlePing(msg).then(sendResponse, (err) =>
      sendResponse({ ok: false, error: String(err?.message ?? err) }),
    );
    return true;
  }
  return false;
});
