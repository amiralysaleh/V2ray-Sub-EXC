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

    // 2. Add Custom Base Name (User Defined)
    if (options.customBaseName) {
        parts.push(options.customBaseName);
    } 
    // If NO location and NO custom name, strictly keep generic fallback, DO NOT use original name
    else if (!location) {
        parts.push("Server");
    }

    // 3. Add Index (Always or if required)
    // The user requested removing old name entirely.
    // Adding index is good practice to avoid duplicates.
    parts.push(`#${index + 1}`);

    // If Mux/Frag is enabled, maybe append small tag? 
    // User asked to clean up names, so let's keep it minimal as requested.
    
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
    if (options.enableCDNIP && options.customCDN && (config.net === 'ws' || config.net === 'grpc')) {
        const originalAdd = config.add;
        config.add = options.customCDN;
        if (!config.host) config.host = originalAdd;
        if (!config.sni) config.sni = originalAdd;
    }

    // Apply Mux
    if (options.enableMux) {
      // config.ps = `${config.ps} | Mux`; // REMOVED per request
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
        if (security === 'tls' || security === 'reality' || security === 'xtls') {
            params.set('alpn', 'h2,http/1.1');
        }
    }

    // Custom DNS
    if (options.enableDNS && options.customDNS) {
      params.set('dns', options.customDNS);
    }
    
    // NEW NAMING LOGIC
    // We completely ignore the old hash/alias
    const newAlias = generateNewAlias("Config", index, loc, options);
    urlObj.hash = encodeURIComponent(newAlias);

    return urlObj.toString();
  } catch (e) {
    return link;
  }
};

export const processConfigs = async (input: string, options: ProcessingOptions): Promise<string> => {
  const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // 1. Resolve GeoIPs (Always do this if we want location naming, or if user toggled it)
  // Even if 'addLocationFlag' is false in options, the user might still want to use the Naming logic
  // But usually, naming relies on location detection. Let's assume we always try to resolve 
  // if the user expects "Country Name" in the output.
  let hostLocationMap: Record<string, LocationData> = {};
  
  // We resolve if option is checked OR if user didn't disable location explicitly 
  // (Assuming 'addLocationFlag' acts as the master switch for GeoIP lookup)
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
