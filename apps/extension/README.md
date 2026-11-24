Sprint 2 会在这里放 Chrome MV3 扩展。

计划结构（见 SPEC §3.3、§5.4）：
  manifest.json     host_permissions 含 *://mmbiz.qpic.cn/*
  background.ts     抓图必须在这里 fetch —— 页面上下文会被 CORS 拦
  content.ts        页面内提取 #js_content 与 data-src
  popup.tsx         一键保存当前页
