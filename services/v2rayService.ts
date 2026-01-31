import { ProcessingOptions } from '../types';
import { batchResolve, LocationData } from './geoIpService';

// Helper to base64 encode/decode safely
export const safeB64Decode = (str: string) => {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
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
        if (link.startsWith('ssr://')) {
             const b64 = link.replace('ssr://', '').split('/')[0];
             const decoded = safeB64Decode(b64);
             return decoded.split(':')[0] || null;
        }
        const url = new URL(link);
        return url.hostname;
    } catch { return null; }
};

// --- Naming Logic Helper ---
const generateNewAlias = (
    originalAlias: string, 
    index: number, 
    location: LocationData | undefined, 
    options: ProcessingOptions
): string => {
    const parts: string[] = [];

    // 1. Add Location Info (Flag + Country + City)
    if (location) {
        parts.push(location.flag);
        if (location.country) parts.push(location.country);
        if (location.city) parts.push(location.city);
    }

    // 2. Add Custom Base Name (User Defined or Default "VS")
    const baseName = options.customBaseName && options.customBaseName.trim() !== ''
        ? options.customBaseName.trim()
        : 'VS';
    parts.push(baseName);

    // 3. Add Index (Just the number as requested)
    parts.push(`${index + 1}`);

    return parts.join(' ');
};

// Process VMess Link
const processVmess = (link: string, options: ProcessingOptions, index: number, loc: LocationData | undefined): string => {
  try {
    const b64Part = link.replace('vmess://', '');
    const jsonStr = safeB64Decode(b64Part);
    if (!jsonStr) return link;

    const config = JSON.parse(jsonStr);

    // Apply Custom CDN IP
    // Logic: If net is WS/GRPC, swap address with CDN, but KEEP original host in "host" and "sni"
    if (options.enableCDNIP && options.customCDN && (config.net === 'ws' || config.net === 'grpc')) {
        const originalAddress = config.add;
        config.add = options.customCDN;
        
        // Preserve Host header: If empty, use original address
        if (!config.host || config.host.length === 0) {
            config.host = originalAddress;
        }
        
        // Preserve SNI: If empty and using TLS, use original address
        if (config.tls === 'tls' && (!config.sni || config.sni.length === 0)) {
            config.sni = originalAddress;
        }
    }

    // Apply Mux
    // Logic: Inject standard Mux object for clients that support it
    if (options.enableMux) {
       config.mux = {
           enabled: true,
           concurrency: options.muxConcurrency || 8
       };
    }

    // Allow Insecure
    // Logic: Do NOT force TLS. Only set verify param if TLS is already active.
    // 'skip-cert-verify' isn't standard in V2RayN JSON but 'verify_cert' sometimes is.
    // To be safe and avoid breaking, we mostly rely on clients global settings, 
    // but we can ensure we don't accidentally enable strict checking.
    // We removed the breaking `config.tls="tls"` line here.

    // Optimize ALPN
    if (options.enableALPN && config.tls === 'tls') {
        config.alpn = "h2,http/1.1";
    }

    // Global DNS
    // Logic: Removed. DNS is a client-side setting, not a per-proxy setting in VMess JSON.
    // Adding it typically does nothing or causes parse errors.

    // NEW NAMING LOGIC
    config.ps = generateNewAlias(config.ps, index, loc, options);

    return 'vmess://' + safeB64Encode(JSON.stringify(config));
  } catch (e) {
    return link; 
  }
};

// Process SSR Link
const processSSR = (link: string, options: ProcessingOptions, index: number, loc: LocationData | undefined): string => {
  try {
    const b64 = link.replace(/^ssr:\/\//, '');
    const decoded = safeBase64UrlDecode(b64);
    
    const splitUrl = decoded.split('/?');
    if (splitUrl.length < 1) return link;
    
    const mainPart = splitUrl[0];
    const paramsStr = splitUrl[1] || '';
    const params = new URLSearchParams(paramsStr);
    
    // NEW NAMING LOGIC
    const newAlias = generateNewAlias("SSR", index, loc, options);
    params.set('remarks', safeBase64UrlEncode(newAlias));

    // SSR doesn't support modern V2Ray params (Mux, Fragment, etc) in link
    // We only touch the name.

    const newDecoded = `${mainPart}/?${params.toString()}`;
    return 'ssr://' + safeBase64UrlEncode(newDecoded);
    
  } catch (e) {
    return link;
  }
};

// Process VLESS/Trojan/SS Link
const processUrlBased = (link: string, options: ProcessingOptions, index: number, loc: LocationData | undefined): string => {
  try {
    let urlObj: URL;
    let originalLink = link;

    // Fix SS links without full URL structure
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

    // Apply Custom CDN IP
    const type = params.get('type');
    const serviceName = params.get('serviceName');
    const isWsOrGrpc = type === 'ws' || type === 'grpc' || params.get('mode') === 'grpc' || !!serviceName;

    if (options.enableCDNIP && options.customCDN && isWsOrGrpc) {
        const originalHost = urlObj.hostname;
        urlObj.hostname = options.customCDN;
        
        // Ensure Host is preserved
        if (!params.has('host')) {
            params.set('host', originalHost);
        }
        
        // Ensure SNI is preserved (if TLS is involved)
        const security = params.get('security');
        if (!params.has('sni') && (security === 'tls' || security === 'reality' || security === 'xtls')) {
            params.set('sni', originalHost);
        }
    }

    // Apply Mux
    // Note: 'mux' query param is supported by v2rayNG/v2rayN but not standard Xray-core.
    // We keep it as it's a requested feature for mobile clients.
    if (options.enableMux) {
      params.set('mux', 'true');
      params.set('concurrency', options.muxConcurrency.toString());
    }

    // Fragment
    // Note: Supported by v2rayNG/V2Box
    if (options.enableFragment) {
      params.set('fragment', `${options.fragmentLength},${options.fragmentInterval},random`);
    }

    // Insecure
    // Standard query param for VLESS/Trojan
    if (options.allowInsecure) {
      params.set('allowInsecure', '1');
    }

    // Optimize ALPN
    if (options.enableALPN) {
        const security = params.get('security');
        if (security === 'tls' || security === 'reality' || security === 'xtls') {
            params.set('alpn', 'h2,http/1.1');
        }
    }

    // Global DNS
    // Removed to prevent link corruption. DNS is a client setting.

    // NEW NAMING LOGIC
    const newAlias = generateNewAlias("Config", index, loc, options);
    urlObj.hash = encodeURIComponent(newAlias);

    return urlObj.toString();
  } catch (e) {
    return link;
  }
};

export const processConfigs = async (input: string, options: ProcessingOptions): Promise<string> => {
  const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // 1. Resolve GeoIPs
  let hostLocationMap: Record<string, LocationData> = {};
  
  if (options.addLocationFlag) {
      const hosts = lines.map(line => {
          if (line.startsWith('vmess://')) return getHostFromVmess(line);
          return getHostFromUrl(line);
      }).filter((h): h is string => h !== null);
      
      hostLocationMap = await batchResolve(hosts);
  }

  // 2. Process each line
  const processedLines = lines.map((line, index) => {
    let host: string | null = null;
    if (line.startsWith('vmess://')) host = getHostFromVmess(line);
    else host = getHostFromUrl(line);
    
    const loc = (host && hostLocationMap[host]) ? hostLocationMap[host] : undefined;

    if (line.startsWith('vmess://')) {
      return processVmess(line, options, index, loc);
    } else if (line.startsWith('ssr://')) {
      return processSSR(line, options, index, loc);
    } else if (line.startsWith('vless://') || line.startsWith('trojan://') || line.startsWith('ss://')) {
      return processUrlBased(line, options, index, loc);
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
