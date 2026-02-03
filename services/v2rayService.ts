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

// --- Host Extraction Logic ---

const getHostFromVmess = (link: string): string | null => {
    try {
        const b64Part = link.replace('vmess://', '');
        const jsonStr = safeB64Decode(b64Part);
        const config = JSON.parse(jsonStr);
        // Valid VMess should have 'add' (address)
        return config.add && config.add.trim().length > 0 ? config.add : null;
    } catch { return null; }
};

const getHostFromSSR = (link: string): string | null => {
    try {
        const b64 = link.replace(/^ssr:\/\//, '').split('/')[0]; // Remove query params first
        const decoded = safeBase64UrlDecode(b64);
        const parts = decoded.split(':');
        return parts.length > 0 ? parts[0] : null;
    } catch { return null; }
};

const getHostFromStandardUrl = (link: string): string | null => {
    try {
        // Handle Legacy SS (Base64 encoded without @)
        if (link.startsWith('ss://') && !link.includes('@')) {
            const hashIndex = link.indexOf('#');
            const b64 = link.substring(5, hashIndex > -1 ? hashIndex : undefined);
            const hash = hashIndex > -1 ? link.substring(hashIndex) : '';
            try {
                // Try decoding SIP002 legacy style
                const decoded = safeBase64UrlDecode(b64);
                if (decoded.includes('@')) {
                   const parts = decoded.split('@');
                   const addressPart = parts[parts.length - 1]; // host:port
                   return addressPart.split(':')[0];
                } else if (decoded.includes(':')) {
                    // format: method:password@host:port (sometimes encoded fully)
                    // OR format: host:port (very old)
                    // It's ambiguous, but if it parses as URL logic below, good.
                }
            } catch(e) {}
        }

        // Standard URL parsing for VLESS, Trojan, and standard SS
        // This handles: protocol://user@host:port...
        const url = new URL(link);
        
        // Handle IPv6 literals in URL (e.g., [2001:db8::1])
        let hostname = url.hostname;
        
        // If hostname is empty, it might be a malformed URL
        if (!hostname) return null;
        
        // Remove brackets from IPv6 for cleaner handling
        if (hostname.startsWith('[') && hostname.endsWith(']')) {
            hostname = hostname.slice(1, -1);
        }

        return hostname;
    } catch { 
        return null; 
    }
};

const extractHost = (link: string): string | null => {
    link = link.trim();
    if (link.startsWith('vmess://')) return getHostFromVmess(link);
    if (link.startsWith('ssr://')) return getHostFromSSR(link);
    if (link.startsWith('vless://') || link.startsWith('trojan://') || link.startsWith('ss://')) {
        return getHostFromStandardUrl(link);
    }
    return null;
};

// --- Naming Logic Helper ---
const generateNewAlias = (
    originalAlias: string, 
    index: number, 
    location: LocationData | undefined, 
    options: ProcessingOptions
): string => {
    const parts: string[] = [];

    // 1. Add Location Info (Flag + Country)
    if (location && location.country) { // Ensure country exists
        parts.push(location.flag);
        parts.push(location.country);
    }

    // 2. Add Custom Base Name
    const baseName = options.customBaseName && options.customBaseName.trim() !== ''
        ? options.customBaseName.trim()
        : 'VS';
    parts.push(baseName);

    // 3. Add Index
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

    if (options.enableCDNIP && options.customCDN && (config.net === 'ws' || config.net === 'grpc')) {
        const originalAddress = config.add;
        config.add = options.customCDN;
        if (!config.host || config.host.length === 0) config.host = originalAddress;
        if (config.tls === 'tls' && (!config.sni || config.sni.length === 0)) config.sni = originalAddress;
    }

    if (options.enableMux) {
       config.mux = {
           enabled: true,
           concurrency: options.muxConcurrency || 8
       };
    }

    if (options.enableALPN && config.tls === 'tls') {
        config.alpn = "h2,http/1.1";
    }

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
    
    const newAlias = generateNewAlias("SSR", index, loc, options);
    params.set('remarks', safeBase64UrlEncode(newAlias));

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

    // Pre-processing for legacy SS to ensure URL parsing works
    if (link.startsWith('ss://') && !link.includes('@')) {
         // Try to convert to standard format if possible for the URL parser
         const hashIndex = link.indexOf('#');
         const b64 = link.substring(5, hashIndex > -1 ? hashIndex : undefined);
         const hash = hashIndex > -1 ? link.substring(hashIndex) : '';
         try {
             const decoded = safeBase64UrlDecode(b64);
             if (decoded.includes('@')) {
                 originalLink = `ss://${decoded}${hash}`;
             }
         } catch(e) {}
    }

    try {
        urlObj = new URL(originalLink);
    } catch (e) {
        return link;
    }
    
    const params = urlObj.searchParams;

    const type = params.get('type');
    const serviceName = params.get('serviceName');
    const isWsOrGrpc = type === 'ws' || type === 'grpc' || params.get('mode') === 'grpc' || !!serviceName;

    if (options.enableCDNIP && options.customCDN && isWsOrGrpc) {
        const originalHost = urlObj.hostname;
        urlObj.hostname = options.customCDN;
        if (!params.has('host')) params.set('host', originalHost);
        const security = params.get('security');
        if (!params.has('sni') && (security === 'tls' || security === 'reality' || security === 'xtls')) {
            params.set('sni', originalHost);
        }
    }

    if (options.enableMux) {
      params.set('mux', 'true');
      params.set('concurrency', options.muxConcurrency.toString());
    }

    if (options.enableFragment) {
      params.set('fragment', `${options.fragmentLength},${options.fragmentInterval},random`);
    }

    if (options.allowInsecure) {
      params.set('allowInsecure', '1');
    }

    if (options.enableALPN) {
        const security = params.get('security');
        if (security === 'tls' || security === 'reality' || security === 'xtls') {
            params.set('alpn', 'h2,http/1.1');
        }
    }

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
      // Extract hosts using the unified extractor
      const hosts = lines.map(line => extractHost(line)).filter((h): h is string => h !== null);
      hostLocationMap = await batchResolve(hosts);
  }

  // 2. Process Lines
  const processedLines = lines.map((line, index) => {
    const host = extractHost(line);
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
