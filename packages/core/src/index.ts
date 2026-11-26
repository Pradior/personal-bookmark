export {
  canonicalizeUrl,
  detectPlatform,
  parseUrl,
  extractFirstUrl,
  type PlatformId,
  type SourceId,
} from './url';

export {
  fetchBinary,
  fetchHtml,
  decodeHtml,
  decodeEntities,
  detectBlock,
  FetchError,
  WECHAT_UA,
  WECHAT_REFERER,
  DESKTOP_UA,
  type FetchOptions,
  type FetchResult,
} from './fetcher';

export {
  adapters,
  pickAdapter,
  captureWithFallback,
  wechatAdapter,
  genericAdapter,
  countWords,
  type Adapter,
  type CaptureContext,
  type CaptureResult,
  type CaptureImage,
} from './adapters/index';

export {
  encryptSecret,
  decryptSecret,
  normalizeCookie,
  domainMatches,
} from './credentialCrypto';

export {
  sanitizeContent,
  htmlToText,
  type ImageMap,
  type SanitizedImage,
} from './sanitize';

export { applyHints, type CaptureHints } from './hints';

// 纯逻辑，不含 sharp —— web 可以安全引用
export {
  DEFAULT_RENDER,
  extForMime,
  normalizeMime,
  type RenderOptions,
} from './imageMime';
