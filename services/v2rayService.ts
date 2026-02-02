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

// --- Xray JSON Converter Helpers ---

// Converts any link to a standard Xray Outbound JSON object
const convertLinkToXrayOutbound = (link: string, options: ProcessingOptions, index: number, loc: LocationData | undefined): any | null => {
    try {
        let protocol = '';
        let settings = {};
        let streamSettings: any = { network: 'tcp', security: 'none' };
        let tag = '';
        let mux = options.enableMux ? { enabled: true, concurrency: options.muxConcurrency } : undefined;

        // Apply Fragment via sockopt if enabled
        const sockopt: any = {};
        if (options.enableFragment) {
            sockopt.fragment = {
                packets: "tlshello",
                length: options.fragmentLength,
                interval: options.fragmentInterval
            };
        }
        // Always attach sockopt to streamSettings later

        if (link.startsWith('vmess://')) {
            protocol = 'vmess';
            const b64 = link.replace('vmess://', '');
            const config = JSON.parse(safeB64Decode(b64));
            
            tag = generateNewAlias(config.ps, index, loc, options);
            
            // Map VMess fields to Xray
            const address = (options.enableCDNIP && options.customCDN && (config.net === 'ws' || config.net === 'grpc')) 
                            ? options.customCDN 
                            : config.add;
            const port = parseInt(config.port);
            
            settings = {
                vnext: [{
                    address: address,
                    port: port,
                    users: [{
                        id: config.id,
                        alterId: parseInt(config.aid || '0'),
                        security: config.scy || 'auto'
                    }]
                }]
            };

            streamSettings.network = config.net || 'tcp';
            streamSettings.security = config.tls || 'none';
            
            const host = config.host || config.add;
            const sni = config.sni || config.host || config.add;

            if (config.net === 'ws') {
                streamSettings.wsSettings = {
                    path: config.path || '/',
                    headers: { Host: host }
                };
            } else if (config.net === 'grpc') {
                streamSettings.grpcSettings = {
                    serviceName: config.path || ''
                };
            }

            if (config.tls === 'tls') {
                streamSettings.tlsSettings = {
                    serverName: sni,
                    allowInsecure: options.allowInsecure,
                    alpn: options.enableALPN ? ['h2', 'http/1.1'] : undefined,
                    fingerprint: config.fp || undefined
                };
            }

        } else if (link.startsWith('vless://') || link.startsWith('trojan://')) {
            const url = new URL(link);
            protocol = link.startsWith('vless://') ? 'vless' : 'trojan';
            tag = generateNewAlias(decodeURIComponent(url.hash.slice(1)), index, loc, options);
            
            const originalHost = url.hostname;
            const params = url.searchParams;
            const net = params.get('type') || params.get('mode') || 'tcp';
            const security = params.get('security') || 'none';
            
            const useCDN = options.enableCDNIP && options.customCDN && (net === 'ws' || net === 'grpc');
            const address = useCDN ? options.customCDN : originalHost;
            const port = parseInt(url.port);

            // User Settings
            if (protocol === 'vless') {
                settings = {
                    vnext: [{
                        address: address,
                        port: port,
                        users: [{
                            id: url.username,
                            encryption: params.get('encryption') || 'none',
                            level: 0
                        }]
                    }]
                };
            } else {
                settings = {
                    servers: [{
                        address: address,
                        port: port,
                        password: url.username,
                        level: 0
                    }]
                };
            }

            streamSettings.network = net;
            streamSettings.security = security;
            
            const host = params.get('host') || originalHost;
            const sni = params.get('sni') || host;
            const path = params.get('path') || params.get('serviceName') || '/';

            if (net === 'ws') {
                streamSettings.wsSettings = {
                    path: path,
                    headers: { Host: host }
                };
            } else if (net === 'grpc') {
                streamSettings.grpcSettings = {
                    serviceName: path
                };
            }

            if (security === 'tls') {
                streamSettings.tlsSettings = {
                    serverName: sni,
                    allowInsecure: options.allowInsecure,
                    alpn: options.enableALPN ? ['h2', 'http/1.1'] : undefined,
                    fingerprint: params.get('fp') || undefined
                };
            } else if (security === 'reality') {
                streamSettings.realitySettings = {
                    serverName: sni,
                    publicKey: params.get('pbk'),
                    shortId: params.get('sid'),
                    fingerprint: params.get('fp') || 'chrome',
                    spiderX: params.get('spx') || ''
                };
            }
        } else if (link.startsWith('ss://')) {
             // Basic SS support for JSON
             // Parsing SS is complex due to various formats (legacy/SIP002)
             // We'll skip deep implementation to keep it safe, or return basic
             return null; // Skipping SS for JSON export for now to ensure stability
        } else {
            return null; 
        }

        // Attach Sockopt
        streamSettings.sockopt = sockopt;

        return {
            tag: tag,
            protocol: protocol,
            settings: settings,
            streamSettings: streamSettings,
            mux: mux
        };

    } catch (e) {
        console.error("Error converting link to JSON", e);
        return null;
    }
};


// Process VMess Link (Legacy Base64 Mode)
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
      const hosts = lines.map(line => {
          if (line.startsWith('vmess://')) return getHostFromVmess(line);
          return getHostFromUrl(line);
      }).filter((h): h is string => h !== null);
      
      hostLocationMap = await batchResolve(hosts);
  }

  // 2. JSON Export Mode (Universal Config - Line Delimited)
  if (options.outputFormat === 'json') {
      const outbounds = lines.map((line, index) => {
          let host: string | null = null;
          if (line.startsWith('vmess://')) host = getHostFromVmess(line);
          else host = getHostFromUrl(line);
          
          const loc = (host && hostLocationMap[host]) ? hostLocationMap[host] : undefined;
          return convertLinkToXrayOutbound(line, options, index, loc);
      }).filter(o => o !== null);

      // Return Line-Delimited JSON (one compact JSON object per line)
      // Per user request: Do NOT Base64 encode this output.
      const jsonLines = outbounds.map(o => JSON.stringify(o)).join('\n');
      return jsonLines;
  }

  // 3. Standard Base64 Subscription Mode
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
