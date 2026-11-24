/**
 * T1.1 自检：URL 规范化与平台识别。
 *
 *   pnpm --filter @pb/core check
 *
 * 不引测试框架 —— 这个文件用 node 的类型剥离直接跑，
 * 少一个依赖，也少一套配置要维护。
 */
import {
  canonicalizeUrl,
  detectPlatform,
  extractFirstUrl,
  parseUrl,
} from '../src/url.ts';

let pass = 0;
let fail = 0;

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}\n       实际: ${a}\n       期望: ${e}`);
  }
}

console.log('\n[平台识别]');
eq('公众号', detectPlatform(parseUrl('https://mp.weixin.qq.com/s/abc')!), 'wechat');
eq('小红书', detectPlatform(parseUrl('https://www.xiaohongshu.com/explore/1')!), 'xhs');
eq('小红书短链', detectPlatform(parseUrl('http://xhslink.com/a/b')!), 'xhs');
eq('抖音', detectPlatform(parseUrl('https://v.douyin.com/xyz/')!), 'douyin');
eq('普通网站', detectPlatform(parseUrl('https://example.com/a')!), 'web');

console.log('\n[公众号：只保留唯一性参数]');
{
  const r = canonicalizeUrl(
    'https://mp.weixin.qq.com/s?__biz=MzA5&mid=265&idx=1&sn=abc&scene=21&spm=xx&from=timeline#rd',
  )!;
  eq(
    '保留 __biz/mid/idx/sn，丢弃 scene/spm/from',
    r.canonicalUrl,
    'https://mp.weixin.qq.com/s?__biz=MzA5&idx=1&mid=265&sn=abc',
  );
  eq('url 保留原始链接（供「原文 ↗」）', r.url.includes('scene=21'), true);
  eq('source = wechat', r.source, 'wechat');
}

console.log('\n[公众号短链：scene / click_id 不参与去重]');
{
  const a = canonicalizeUrl(
    'https://mp.weixin.qq.com/s/PQ3EoRFuGwA?scene=1&click_id=8081234567&from=timeline',
  )!;
  const b = canonicalizeUrl('https://mp.weixin.qq.com/s/PQ3EoRFuGwA?scene=21&click_id=999')!;
  eq('同一篇短链 → 同一个 canonical', a.canonicalUrl, b.canonicalUrl);
  eq('canonical 只留路径', a.canonicalUrl, 'https://mp.weixin.qq.com/s/PQ3EoRFuGwA');
  eq('原始 url 保留全部参数（供「原文 ↗」）', a.url.includes('click_id'), true);
}

console.log('\n[追踪参数与归一]');
{
  const a = canonicalizeUrl('https://example.com/post/?utm_source=x&b=2&a=1')!;
  const b = canonicalizeUrl('https://example.com/post?a=1&b=2&utm_medium=y')!;
  eq('不同 utm 与参数顺序 → 同一个 canonical', a.canonicalUrl, b.canonicalUrl);
  eq('末尾斜杠归一', a.canonicalUrl, 'https://example.com/post?a=1&b=2');
}
{
  const r = canonicalizeUrl('https://example.com/path/')!;
  eq('无 query 时去掉末尾斜杠', r.canonicalUrl, 'https://example.com/path');
}
{
  const r = canonicalizeUrl('HTTPS://Example.COM:443/A')!;
  eq('host 小写 + 去掉默认端口', r.canonicalUrl, 'https://example.com/A');
}

console.log('\n[小红书 xsec_* 不参与去重]');
{
  const a = canonicalizeUrl(
    'https://www.xiaohongshu.com/explore/123?xsec_token=AAA&xsec_source=pc',
  )!;
  const b = canonicalizeUrl('https://www.xiaohongshu.com/explore/123?xsec_token=BBB')!;
  eq('token/source 不同但 note 相同 → 同一个 canonical', a.canonicalUrl, b.canonicalUrl);
  eq('canonical 不含 xsec_', a.canonicalUrl, 'https://www.xiaohongshu.com/explore/123');
}

console.log('\n[容错]');
eq('没写协议也能解析', canonicalizeUrl('mp.weixin.qq.com/s/abc') !== null, true);
eq('非 http(s) 返回 null', canonicalizeUrl('ftp://example.com/a'), null);
eq('空字符串返回 null', canonicalizeUrl('   '), null);
eq(
  '从分享文案里抠链接',
  extractFirstUrl('好文推荐\nhttps://mp.weixin.qq.com/s/AbC123 转给你看看'),
  'https://mp.weixin.qq.com/s/AbC123',
);
eq(
  '中文标点结尾不吞进 URL',
  extractFirstUrl('看这个：https://mp.weixin.qq.com/s/Xyz），很值得'),
  'https://mp.weixin.qq.com/s/Xyz',
);

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
