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

// --- Xray JSON Builder ---

const buildFullXrayConfig = (link: string, options: ProcessingOptions, index: number, loc: LocationData | undefined): any | null => {
    try {
        // --- 1. Parse Link Details ---
        let protocol = '';
        let address = '';
        let port = 0;
        let id = '';
        let security = 'none';
        let net = 'tcp';
        let type = 'none'; // header type
        let host = '';
        let path = '';
        let sni = '';
        let alpn: string[] | undefined = undefined;
        let fingerprint = '';
        let flow = '';
        let encryption = 'none';
        let pbk = '';
        let sid = '';
        let spx = '';
        let alias = '';
        
        // Parsing Logic
        if (link.startsWith('vmess://')) {
            protocol = 'vmess';
            const b64 = link.replace('vmess://', '');
            const config = JSON.parse(safeB64Decode(b64));
            
            alias = generateNewAlias(config.ps, index, loc, options);
            address = config.add;
            port = parseInt(config.port);
            id = config.id;
            security = config.tls || 'none';
            net = config.net || 'tcp';
            type = config.type || 'none';
            host = config.host || config.add;
            path = config.path || '/';
            sni = config.sni || config.host || config.add;
            fingerprint = config.fp || '';
            
            // AlterId is deprecated in newer Xray, usually 0
        } else if (link.startsWith('vless://') || link.startsWith('trojan://')) {
            protocol = link.startsWith('vless://') ? 'vless' : 'trojan';
            const url = new URL(link);
            alias = generateNewAlias(decodeURIComponent(url.hash.slice(1)), index, loc, options);
            
            address = url.hostname;
            port = parseInt(url.port);
            id = url.username; // UUID or Password
            
            const params = url.searchParams;
            security = params.get('security') || 'none';
            net = params.get('type') || params.get('mode') || 'tcp';
            type = params.get('headerType') || 'none';
            
            host = params.get('host') || address;
            path = params.get('path') || params.get('serviceName') || '/';
            sni = params.get('sni') || host;
            fingerprint = params.get('fp') || '';
            flow = params.get('flow') || '';
            encryption = params.get('encryption') || 'none';
            
            // Reality specific
            pbk = params.get('pbk') || '';
            sid = params.get('sid') || '';
            spx = params.get('spx') || '';
        } else {
            return null; // Skip unsupported
        }

        // --- 2. Apply Customizations (CDN, ALPN, etc.) ---
        
        // CDN Override
        if (options.enableCDNIP && options.customCDN && (net === 'ws' || net === 'grpc')) {
             // Keep SNI/Host as original, change address to CDN
             if (!host) host = address;
             if (!sni && (security === 'tls' || security === 'reality')) sni = address;
             address = options.customCDN;
        }

        // ALPN
        if (options.enableALPN && (security === 'tls' || security === 'reality')) {
            alpn = ['h2', 'http/1.1'];
        }

        // --- 3. Build "Proxy" Outbound ---
        
        const proxySettings: any = {};
        
        if (protocol === 'vmess') {
            proxySettings.vnext = [{
                address: address,
                port: port,
                users: [{
                    id: id,
                    alterId: 0,
                    security: 'auto',
                    encryption: encryption
                }]
            }];
        } else if (protocol === 'vless') {
            proxySettings.vnext = [{
                address: address,
                port: port,
                users: [{
                    id: id,
                    encryption: encryption,
                    flow: flow
                }]
            }];
        } else if (protocol === 'trojan') {
            proxySettings.servers = [{
                address: address,
                port: port,
                password: id,
                level: 0
            }];
        }

        const streamSettings: any = {
            network: net,
            security: security,
            sockopt: {
                tcpKeepAliveIdle: 100,
                mark: 255
            }
        };

        // TCP Settings
        if (net === 'tcp' && type === 'http') {
             streamSettings.tcpSettings = {
                 header: {
                     type: 'http',
                     request: {
                         headers: {
                             Host: [host]
                         },
                         path: [path]
                     }
                 }
             };
        }

        // WS Settings
        if (net === 'ws') {
            streamSettings.wsSettings = {
                path: path,
                headers: {
                    Host: host
                }
            };
        }

        // GRPC Settings
        if (net === 'grpc') {
            streamSettings.grpcSettings = {
                serviceName: path,
                multiMode: false // defaults
            };
        }

        // TLS / Reality Settings
        if (security === 'tls') {
            streamSettings.tlsSettings = {
                allowInsecure: options.allowInsecure,
                serverName: sni,
                fingerprint: fingerprint || 'chrome',
                alpn: alpn,
                show: false
            };
        } else if (security === 'reality') {
            streamSettings.realitySettings = {
                show: false,
                fingerprint: fingerprint || 'chrome',
                serverName: sni,
                publicKey: pbk,
                shortId: sid,
                spiderX: spx
            };
        }

        // Mux
        const mux = options.enableMux ? {
            enabled: true,
            concurrency: options.muxConcurrency
        } : { enabled: true, concurrency: null }; // Template defaults

        // Fragment Logic (The Key Part)
        // If Fragment is enabled, we set dialerProxy on the main outbound
        // and create a secondary outbound with tag "fragment".
        if (options.enableFragment && (security === 'tls' || security === 'reality')) {
            streamSettings.sockopt.dialerProxy = "fragment";
        }

        const proxyOutbound = {
            tag: "proxy",
            protocol: protocol,
            settings: proxySettings,
            streamSettings: streamSettings,
            mux: mux
        };

        // --- 4. Build Outbound List ---
        const outbounds: any[] = [proxyOutbound];

        // Add Fragment Outbound if needed (Matching template)
        outbounds.push({
            tag: "fragment",
            protocol: "freedom",
            settings: {
                fragment: options.enableFragment ? {
                    packets: "tlshello",
                    length: options.fragmentLength,
                    interval: options.fragmentInterval
                } : undefined
            },
            streamSettings: {
                sockopt: {
                    TcpNoDelay: true,
                    tcpKeepAliveIdle: 100,
                    mark: 255
                }
            }
        });

        // Add Direct and Block
        outbounds.push({
            tag: "direct",
            protocol: "freedom",
            settings: {}
        });

        outbounds.push({
            tag: "block",
            protocol: "blackhole",
            settings: {
                response: {
                    type: "http"
                }
            }
        });

        // --- 5. Construct Final JSON (Exactly matching template) ---
        return {
            log: {
                access: "",
                error: "",
                loglevel: "warning"
            },
            inbounds: [
                {
                    tag: "socks",
                    port: 10808,
                    listen: "127.0.0.1",
                    protocol: "socks",
                    sniffing: {
                        enabled: true,
                        destOverride: ["http", "tls"],
                        routeOnly: false
                    },
                    settings: {
                        auth: "noauth",
                        udp: true,
                        allowTransparent: false
                    }
                },
                {
                    tag: "http",
                    port: 10809,
                    listen: "127.0.0.1",
                    protocol: "http",
                    sniffing: {
                        enabled: true,
                        destOverride: ["http", "tls"],
                        routeOnly: false
                    },
                    settings: {
                        auth: "noauth",
                        udp: true,
                        allowTransparent: false
                    }
                }
            ],
            outbounds: outbounds,
            routing: {
                domainStrategy: "AsIs",
                rules: [
                    {
                        type: "field",
                        inboundTag: ["api"],
                        outboundTag: "api",
                        enabled: true
                    },
                    {
                        id: "5465425548310166497",
                        type: "field",
                        outboundTag: "direct",
                        domain: ["domain:ir", "geosite:cn"],
                        enabled: true
                    },
                    {
                        id: "5425034033205580637",
                        type: "field",
                        outboundTag: "direct",
                        ip: ["geoip:private", "geoip:cn", "geoip:ir"],
                        enabled: true
                    },
                    {
                        id: "5627785659655799759",
                        type: "field",
                        port: "0-65535",
                        outboundTag: "proxy",
                        enabled: true
                    }
                ]
            },
            // Note: remarks is not in standard Xray Config, but clients like v2rayNG 
            // read top-level 'remarks' or 'ps' field from a custom JSON import.
            remarks: alias 
        };

    } catch (e) {
        console.error("Error building JSON", e);
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

  // 2. JSON Export Mode (Full Config Per Line)
  if (options.outputFormat === 'json') {
      const fullConfigs = lines.map((line, index) => {
          let host: string | null = null;
          if (line.startsWith('vmess://')) host = getHostFromVmess(line);
          else host = getHostFromUrl(line);
          
          const loc = (host && hostLocationMap[host]) ? hostLocationMap[host] : undefined;
          
          return buildFullXrayConfig(line, options, index, loc);
      }).filter(o => o !== null);

      // Return Line-Delimited JSON of FULL CONFIGS
      const jsonLines = fullConfigs.map(o => JSON.stringify(o)).join('\n');
      
      // IMPORTANT: Clients expect the subscription FILE itself to be Base64 encoded, 
      // even if the contents are JSON objects. They decode the file, then read lines.
      return safeB64Encode(jsonLines);
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
