import { ProcessingOptions } from '../types';
import { batchResolve } from './geoIpService';

// Helper to base64 encode/decode safely
export const safeB64Decode = (str: string) => {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
    // Attempt to handle URL-safe chars if standard atob fails
    try {
        const fixedStr = str.replace(/-/g, '+').replace(/_/g, '/');
        return decodeURIComponent(escape(atob(fixedStr)));
    } catch (e2) {
        console.error("Decode error", e);
        return "";
    }
  }
};

const safeB64Encode = (str: string) => {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch (e) {
    console.error("Encode error", e);
    return "";
  }
};

const safeBase64UrlDecode = (str: string) => {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return safeB64Decode(base64);
};

const safeBase64UrlEncode = (str: string) => {
    let base64 = safeB64Encode(str);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const parseSubscription = (content: string): string => {
    const decoded = safeB64Decode(content.trim());
    return decoded || content;
};

const getHostFromVmess = (link: string): string | null => {
    try {
        const b64Part = link.replace('vmess://', '');
        const jsonStr = safeB64Decode(b64Part);
        const config = JSON.parse(jsonStr);
        return config.add || null;
    } catch { return null; }
};

const getHostFromUrl = (link: string): string | null => {
    try {
        // Handle SSR separately as it has different structure
        if (link.startsWith('ssr://')) {
             const b64 = link.replace('ssr://', '').split('/')[0];
             const decoded = safeB64Decode(b64);
             return decoded.split(':')[0] || null;
        }
        // VLESS, Trojan, SS, etc.
        const url = new URL(link);
        return url.hostname;
    } catch { return null; }
};

// Process VMess Link
const processVmess = (link: string, options: ProcessingOptions, index: number, flag: string = ''): string => {
  try {
    const b64Part = link.replace('vmess://', '');
    const jsonStr = safeB64Decode(b64Part);
    if (!jsonStr) return link;

    const config = JSON.parse(jsonStr);

    // Apply Custom CDN IP (Revive Config)
    // Only for WS or GRPC
    if (options.enableCDNIP && options.customCDN && (config.net === 'ws' || config.net === 'grpc')) {
        const originalAdd = config.add;
        config.add = options.customCDN;
        
        // If host/sni not set, use original address
        if (!config.host) config.host = originalAdd;
        if (!config.sni) config.sni = originalAdd;
    }

    // Apply Mux
    if (options.enableMux) {
      config.ps = `${config.ps} | Mux`;
    }

    // Apply Fragment
    if (options.enableFragment) {
       config.ps = `${config.ps} | Frag`;
    }

    // Allow Insecure
    if (options.allowInsecure) {
        if (!config.tls) config.tls = "tls"; 
    }

    // Optimize ALPN
    if (options.enableALPN && config.tls === 'tls') {
        config.alpn = "h2,http/1.1";
    }

    // Apply DNS
    if (options.enableDNS && options.customDNS) {
      (config as any).dns = options.customDNS;
    }

    let alias = config.ps || 'VMess';
    if (flag) {
        alias = `${flag} ${alias}`;
    }

    if (options.addRandomAlias) {
      alias = `${alias} #${index + 1}`;
    }
    config.ps = alias;

    return 'vmess://' + safeB64Encode(JSON.stringify(config));
  } catch (e) {
    return link; 
  }
};

// Process SSR Link
const processSSR = (link: string, options: ProcessingOptions, index: number, flag: string = ''): string => {
  try {
    const b64 = link.replace(/^ssr:\/\//, '');
    const decoded = safeBase64UrlDecode(b64);
    
    const splitUrl = decoded.split('/?');
    if (splitUrl.length < 1) return link;
    
    const mainPart = splitUrl[0];
    const paramsStr = splitUrl[1] || '';
    
    const params = new URLSearchParams(paramsStr);
    
    const currentRemarksB64 = params.get('remarks') || '';
    let currentRemarks = '';
    try {
        currentRemarks = safeBase64UrlDecode(currentRemarksB64) || 'SSR';
    } catch(e) {}
    
    if (flag) {
        currentRemarks = `${flag} ${currentRemarks}`;
    }
    
    if (options.addRandomAlias) {
        currentRemarks = `${currentRemarks} #${index + 1}`;
    }
    
    params.set('remarks', safeBase64UrlEncode(currentRemarks));

    const newDecoded = `${mainPart}/?${params.toString()}`;
    return 'ssr://' + safeBase64UrlEncode(newDecoded);
    
  } catch (e) {
    return link;
  }
};

// Process VLESS/Trojan/SS Link
const processUrlBased = (link: string, options: ProcessingOptions, index: number, flag: string = ''): string => {
  try {
    let urlObj: URL;
    let originalLink = link;

    if (link.startsWith('ss://') && !link.includes('@') && !link.includes('?')) {
        const hashIndex = link.indexOf('#');
        let b64 = link.substring(5, hashIndex > -1 ? hashIndex : undefined);
        const hash = hashIndex > -1 ? link.substring(hashIndex) : '';
        if (!b64.includes(':')) {
           try {
              const decoded = safeBase64UrlDecode(b64);
              if (decoded.includes('@') && decoded.includes(':')) {
                  originalLink = `ss://${decoded}${hash}`;
              }
           } catch(e) {}
        }
    }

    try {
        urlObj = new URL(originalLink);
    } catch (e) {
        return link;
    }
    
    const params = urlObj.searchParams;

    // Apply Custom CDN IP (Revive Config)
    const type = params.get('type');
    const serviceName = params.get('serviceName'); // for grpc
    const isWsOrGrpc = type === 'ws' || type === 'grpc' || params.get('mode') === 'grpc' || !!serviceName;

    if (options.enableCDNIP && options.customCDN && isWsOrGrpc) {
        const originalHost = urlObj.hostname;
        urlObj.hostname = options.customCDN;

        if (!params.has('host')) params.set('host', originalHost);
        if (!params.has('sni')) params.set('sni', originalHost);
    }

    // Apply Mux
    if (options.enableMux) {
      params.set('mux', 'true');
      params.set('concurrency', options.muxConcurrency.toString());
    }

    // Fragment
    if (options.enableFragment) {
      params.set('fragment', `${options.fragmentLength},${options.fragmentInterval},random`);
    }

    // Insecure
    if (options.allowInsecure) {
      params.set('allowInsecure', '1');
    }

    // Optimize ALPN
    if (options.enableALPN) {
        const security = params.get('security');
        // Apply ALPN only if TLS or Reality is active
        if (security === 'tls' || security === 'reality' || security === 'xtls') {
            params.set('alpn', 'h2,http/1.1');
        }
    }

    // Custom DNS
    if (options.enableDNS && options.customDNS) {
      params.set('dns', options.customDNS);
    }
    
    // Alias handling
    let alias = "";
    if (urlObj.hash) {
        alias = decodeURIComponent(urlObj.hash.substring(1));
    }
    if (!alias) alias = "Config";
    
    if (flag) {
        alias = `${flag} ${alias}`;
    }

    if (options.addRandomAlias) {
        alias = `${alias} #${index + 1}`;
    }
    
    urlObj.hash = alias;

    return urlObj.toString();
  } catch (e) {
    return link;
  }
};

export const processConfigs = async (input: string, options: ProcessingOptions): Promise<string> => {
  const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // 1. Resolve GeoIPs if enabled
  let hostFlagMap: Record<string, string> = {};
  if (options.addLocationFlag) {
      const hosts = lines.map(line => {
          if (line.startsWith('vmess://')) return getHostFromVmess(line);
          return getHostFromUrl(line);
      }).filter((h): h is string => h !== null);
      
      hostFlagMap = await batchResolve(hosts);
  }

  // 2. Process each line
  const processedLines = lines.map((line, index) => {
    let host: string | null = null;
    if (line.startsWith('vmess://')) host = getHostFromVmess(line);
    else host = getHostFromUrl(line);
    
    const flag = (host && hostFlagMap[host]) ? hostFlagMap[host] : '';

    if (line.startsWith('vmess://')) {
      return processVmess(line, options, index, flag);
    } else if (line.startsWith('ssr://')) {
      return processSSR(line, options, index, flag);
    } else if (line.startsWith('vless://') || line.startsWith('trojan://') || line.startsWith('ss://')) {
      return processUrlBased(line, options, index, flag);
    }
    return line;
  });

  return safeB64Encode(processedLines.join('\n'));
};

export const getTehranDate = (): string => {
  return new Date().toLocaleDateString('fa-IR-u-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};