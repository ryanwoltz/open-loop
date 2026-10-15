import type { DeviceInfo, PagePerformance, Viewport } from '@open-loop/shared';

export const parseUserAgent = (ua: string): { browser: string; os: string } => {
  const pick = (re: RegExp) => re.exec(ua)?.[1];
  let browser = 'Unknown';
  const edge = pick(/Edg\/([\d.]+)/);
  const opera = pick(/OPR\/([\d.]+)/);
  const chrome = pick(/Chrome\/([\d.]+)/);
  const firefox = pick(/Firefox\/([\d.]+)/);
  const safari = pick(/Version\/([\d.]+).*Safari/);
  if (edge) browser = `Edge ${edge}`;
  else if (opera) browser = `Opera ${opera}`;
  else if (chrome) browser = `Chrome ${chrome}`;
  else if (firefox) browser = `Firefox ${firefox}`;
  else if (safari) browser = `Safari ${safari}`;

  let os = 'Unknown';
  const mac = pick(/Mac OS X ([\d_]+)/);
  const win = pick(/Windows NT ([\d.]+)/);
  const android = pick(/Android ([\d.]+)/);
  const ios = pick(/OS ([\d_]+) like Mac OS X/);
  if (ios) os = `iOS ${ios.replace(/_/g, '.')}`;
  else if (android) os = `Android ${android}`;
  else if (mac) os = `macOS ${mac.replace(/_/g, '.')}`;
  else if (win) os = win === '10.0' ? 'Windows 10/11' : `Windows NT ${win}`;
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
};

type NavigatorExtras = Navigator & {
  deviceMemory?: number;
  connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  userAgentData?: { platform?: string; brands?: Array<{ brand: string; version: string }> };
};

export const deviceInfo = (): DeviceInfo => {
  const nav = navigator as NavigatorExtras;
  const { browser, os } = parseUserAgent(nav.userAgent);
  const conn = nav.connection;
  return {
    userAgent: nav.userAgent.slice(0, 1000),
    browser,
    os,
    platform: (nav.userAgentData?.platform || nav.platform || 'unknown').slice(0, 200),
    language: nav.language,
    languages: [...(nav.languages ?? [])].slice(0, 20),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
    ...(nav.hardwareConcurrency ? { hardwareConcurrency: nav.hardwareConcurrency } : {}),
    ...(nav.deviceMemory ? { deviceMemoryGb: nav.deviceMemory } : {}),
    ...(conn
      ? {
          connection: {
            ...(conn.effectiveType ? { effectiveType: conn.effectiveType } : {}),
            ...(conn.downlink !== undefined ? { downlinkMbps: conn.downlink } : {}),
            ...(conn.rtt !== undefined ? { rttMs: conn.rtt } : {}),
            ...(conn.saveData !== undefined ? { saveData: conn.saveData } : {}),
          },
        }
      : {}),
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    touch: nav.maxTouchPoints > 0,
    online: nav.onLine,
  };
};

export const viewportInfo = (): Viewport => ({
  width: window.innerWidth,
  height: window.innerHeight,
  scrollX: Math.round(window.scrollX),
  scrollY: Math.round(window.scrollY),
  devicePixelRatio: window.devicePixelRatio || 1,
  documentWidth: document.documentElement.scrollWidth,
  documentHeight: document.documentElement.scrollHeight,
});

let lcp: number | undefined;
try {
  new PerformanceObserver((list) => {
    const last = list.getEntries().at(-1);
    if (last) lcp = Math.round(last.startTime);
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch {
  /* unsupported */
}

export const performanceInfo = (): PagePerformance | undefined => {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const out: PagePerformance = {};
    if (nav?.domContentLoadedEventEnd) out.domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd);
    if (nav?.loadEventEnd) out.loadMs = Math.round(nav.loadEventEnd);
    if (fcp) out.firstContentfulPaintMs = Math.round(fcp.startTime);
    if (lcp !== undefined) out.largestContentfulPaintMs = lcp;
    if (mem) out.usedJsHeapMb = Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10;
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
};
