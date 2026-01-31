import { safeB64Decode } from './v2rayService';
import { PingResult } from '../types';

interface ServerInfo {
  id: string;
  alias: string;
  host: string;
  protocol: string;
}

// Helper to extract host from various link formats
export const extractServerInfo = (input: string): ServerInfo[] => {
  const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  return lines.map((line, index) => {
    try {
      if (line.startsWith('vmess://')) {
        const decoded = safeB64Decode(line.replace('vmess://', ''));
        const data = JSON.parse(decoded);
        return { id: `vms-${index}`, alias: data.ps || 'VMess Server', host: data.add, protocol: 'VMess' };
      }
      if (line.startsWith('vless://') || line.startsWith('trojan://') || line.startsWith('ss://')) {
        const url = new URL(line);
        const alias = decodeURIComponent(url.hash.substring(1)) || url.hostname;
        return { 
          id: `url-${index}`, 
          alias: alias, 
          host: url.hostname, 
          protocol: url.protocol.replace(':', '').toUpperCase() 
        };
      }
      if (line.startsWith('ssr://')) {
        // Simple extraction for SSR - decoding the main part
        const b64 = line.replace('ssr://', '').split('/')[0];
        const decoded = safeB64Decode(b64);
        const host = decoded.split(':')[0];
        return { id: `ssr-${index}`, alias: 'SSR Server', host: host, protocol: 'SSR' };
      }
    } catch (e) {
      console.error("Error parsing line for speed test", line);
    }
    return null;
  }).filter((s): s is ServerInfo => s !== null && !!s.host);
};

export const pingServer = async (server: ServerInfo): Promise<PingResult> => {
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

  try {
    // We use a simple fetch to the host. 
    // Even if it fails with 404 or similar, the timing tells us the latency.
    // 'no-cors' is essential to bypass CORS preflight issues for pinging.
    await fetch(`https://${server.host}`, { 
      mode: 'no-cors', 
      signal: controller.signal,
      cache: 'no-cache',
      referrerPolicy: 'no-referrer'
    });
    const end = performance.now();
    clearTimeout(timeoutId);
    return {
      ...server,
      latency: Math.round(end - start),
      lastTested: new Date()
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { ...server, latency: 'timeout', lastTested: new Date() };
    }
    // Fallback to HTTP if HTTPS fails immediately (some servers might not have 443 open)
    try {
        const startHttp = performance.now();
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 2000);
        await fetch(`http://${server.host}`, { mode: 'no-cors', signal: ctrl2.signal });
        clearTimeout(t2);
        return { ...server, latency: Math.round(performance.now() - startHttp), lastTested: new Date() };
    } catch {
        return { ...server, latency: 'error', lastTested: new Date() };
    }
  }
};