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
        // Alias is calculated for naming, but removed from JSON body as per request
        // const alias = generateNewAlias(...) 
        
        // Parsing Logic
        if (link.startsWith('vmess://')) {
            protocol = 'vmess';
            const b64 = link.replace('vmess://', '');
            const config = JSON.parse(safeB64Decode(b64));
            
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
            
        } else if (link.startsWith('vless://') || link.startsWith('trojan://')) {
            protocol = link.startsWith('vless://') ? 'vless' : 'trojan';
            const url = new URL(link);
            
            address = url.hostname;
            port = parseInt(url.port);
            id = url.username;
            
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

        // --- 2. Apply Customizations ---
        
        // CDN Override
        if (options.enableCDNIP && options.customCDN && (net === 'ws' || net === 'grpc')) {
             if (!host) host = address;
             if (!sni && (security === 'tls' || security === 'reality')) sni = address;
             address = options.customCDN;
        }

        // ALPN
        if (options.enableALPN && (security === 'tls' || security === 'reality')) {
            alpn = ['http/1.1']; // Matches user template which used "http/1.1" inside array
        }

        // --- 3. Build Proxy Outbound ---
        
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
                    encryption: encryption, // 'none' in template usually comes first or is irrelevant order
                    id: id,
                    flow: flow || undefined // Only add flow if present
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

        // Stream Settings
        const streamSettings: any = {
            network: net,
            security: security,
            sockopt: {}
        };

        // TCP
        if (net === 'tcp' && type === 'http') {
             streamSettings.tcpSettings = {
                 header: {
                     type: 'http',
                     request: {
                         headers: { Host: [host] },
                         path: [path]
                     }
                 }
             };
        }

        // WS
        if (net === 'ws') {
            streamSettings.wsSettings = {
                host: host, // Template uses 'host' not headers.Host
                path: path
            };
        }

        // GRPC
        if (net === 'grpc') {
            streamSettings.grpcSettings = {
                serviceName: path,
                multiMode: false
            };
        }

        // TLS
        if (security === 'tls') {
            streamSettings.tlsSettings = {
                alpn: alpn,
                fingerprint: fingerprint || 'chrome',
                serverName: sni
            };
        } else if (security === 'reality') {
            streamSettings.realitySettings = {
                fingerprint: fingerprint || 'chrome',
                serverName: sni,
                publicKey: pbk,
                shortId: sid,
                spiderX: spx
            };
        }

        // Fragment Logic (Dialer Proxy)
        if (options.enableFragment && (security === 'tls' || security === 'reality')) {
            streamSettings.sockopt.dialerProxy = "fragment";
        }

        const proxyOutbound: any = {
            mux: {
                concurrency: options.enableMux ? (options.muxConcurrency > 0 ? options.muxConcurrency : 8) : 8,
                enabled: options.enableMux
            },
            protocol: protocol,
            settings: proxySettings,
            streamSettings: streamSettings,
            tag: "proxy"
        };

        // --- 4. Build Outbounds Array ---
        const outbounds: any[] = [proxyOutbound];

        if (options.enableFragment) {
            outbounds.push({
                protocol: "freedom",
                settings: {
                    fragment: {
                        interval: options.fragmentInterval,
                        length: options.fragmentLength
                    }
                },
                streamSettings: {
                    sockopt: {
                        penetrate: true
                    }
                },
                tag: "fragment"
            });
        }

        outbounds.push({ protocol: "freedom", tag: "direct" });
        outbounds.push({ protocol: "blackhole", tag: "block" });

        // --- 5. Final JSON Structure (Strict Match) ---
        return {
            dns: {
                hosts: {
                    "dns.google": ["8.8.8.8", "8.8.4.4"]
                },
                servers: [
                    "fakedns",
                    "https://dns.google/dns-query"
                ]
            },
            fakedns: [
                {
                    ipPool: "198.20.0.0/15",
                    poolSize: 128
                },
                {
                    ipPool: "fc00::/64",
                    poolSize: 128
                }
            ],
            inbounds: [
                {
                    listen: "127.0.0.1",
                    port: 1080,
                    protocol: "socks",
                    settings: {
                        auth: "noauth",
                        udp: true
                    },
                    sniffing: {
                        destOverride: ["http", "tls", "quic"],
                        enabled: true,
                        routeOnly: true
                    },
                    tag: "socks"
                }
            ],
            outbounds: outbounds,
            routing: {
                domainMatcher: "hybrid",
                domainStrategy: "IPIfNonMatch",
                rules: [
                    {
                        domain: ["geosite:category-ir", "regexp:.*\\.ir$"],
                        domainMatcher: "hybrid",
                        ip: ["geoip:ir", "geoip:private"],
                        network: "TCP, UDP, HTTP, HTTPS, SSH, SMTP, SNMP, NTP, FTP, POP3, IMAP, Telnet",
                        outboundTag: "direct",
                        type: "field"
                    },
                    {
                        domain: [
                            "geosite:category-ads-all", "geosite:category-ads", "geosite:yahoo-ads",
                            "geosite:spotify-ads", "geosite:google-ads", "geosite:apple-ads",
                            "geosite:amazon-ads", "geosite:adobe-ads"
                        ],
                        domainMatcher: "hybrid",
                        network: "TCP, UDP, HTTP, HTTPS, SSH, SMTP, SNMP, NTP, FTP, POP3, IMAP, Telnet",
                        outboundTag: "block",
                        type: "field"
                    }
                ]
            }
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
