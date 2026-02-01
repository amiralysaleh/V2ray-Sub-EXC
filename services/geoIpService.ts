export interface LocationData {
  flag: string;
  country: string;
  city: string;
  isp?: string;
}

const CACHE_KEY = 'v2ray_geoip_robust_v4';

// Helper to get cache from localStorage
const getCache = (): Record<string, LocationData> => {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch { return {}; }
};

// Helper to save cache
const updateCache = (host: string, data: LocationData) => {
    const cache = getCache();
    cache[host] = data;
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        // Handle quota exceeded
        try { localStorage.clear(); } catch {}
    }
};

// Convert ISO country code to Emoji Flag
const getFlagEmoji = (countryCode: string) => {
    if (!countryCode) return '🏳️'; // Unknown flag
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
};

// Check if string is an IP address
const isIP = (str: string) => {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(str) || str.includes(':');
};

// Check if IP is private/local
const isPrivateIP = (ip: string) => {
    // If it's a domain name (not an IP), we assume it's public for now, 
    // unless it matches localhost.
    if (!isIP(ip)) return ip === 'localhost';

    return /^(::f{4}:)?10\.|\.|(?:^127\.)|(?:^169\.254\.)|(?:^192\.168\.)|(?:^172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(ip);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// DNS Resolver using Cloudflare (More robust than Google in restricted networks)
const resolveDns = async (domain: string): Promise<string | null> => {
    if (isIP(domain)) return domain; 
    
    try {
        const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, {
            headers: { 'Accept': 'application/dns-json' }
        });
        const data = await res.json();
        if (data.Answer && data.Answer.length > 0) {
            const rec = data.Answer.find((r: any) => r.type === 1);
            return rec ? rec.data : null;
        }
    } catch (e) {
        // Fallback to Google if Cloudflare fails
        try {
            const res = await fetch(`https://dns.google/resolve?name=${domain}&type=A`);
            const data = await res.json();
            if (data.Answer && data.Answer.length > 0) {
                const rec = data.Answer.find((r: any) => r.type === 1);
                return rec ? rec.data : null;
            }
        } catch (e2) {}
    }
    return null;
};

// Provider 1: ipwho.is (Detailed, strict rate limit)
const fetchIpWhoIs = async (target: string): Promise<LocationData | null> => {
    try {
        const res = await fetch(`https://ipwho.is/${target}?lang=en`);
        const data = await res.json();
        
        // Critical: ipwho.is returns the user's IP if the requested IP is invalid or rate limited.
        if (data.success) {
            // If we queried a specific IP, the response IP must match.
            // If we queried a domain, the response IP is the resolved IP. 
            // We can't strict match domain vs IP, but if we queried an IP, we MUST match.
            if (isIP(target) && data.ip !== target) {
                return null;
            }
            return {
                flag: getFlagEmoji(data.country_code),
                country: data.country || '',
                city: data.city || '',
                isp: data.connection?.isp || ''
            };
        }
    } catch {}
    return null;
};

// Provider 2: V2Fly GeoIP (Backup, very reliable, less info)
const fetchV2Fly = async (target: string): Promise<LocationData | null> => {
    try {
        // V2Fly API usually expects an IP, but sometimes handles hostnames. 
        // Best to feed it IP if possible.
        const res = await fetch(`https://api.v2fly.org/web/geoip?ip=${target}`);
        const data = await res.json();
        // data format: { country: "US", ip: "..." }
        if (data.country) {
            return {
                flag: getFlagEmoji(data.country),
                country: data.country,
                city: '', // This API often doesn't give city
                isp: ''
            };
        }
    } catch {}
    return null;
};

export const resolveLocation = async (host: string): Promise<LocationData | null> => {
    if (!host || host.length < 3) return null;
    
    // 1. Check Cache
    const cache = getCache();
    if (cache[host]) return cache[host];

    // 2. Resolve DNS
    // We try to resolve to IP to get accurate GeoIP and avoid rate-limit-redirect-to-localhost issues.
    let target = await resolveDns(host);
    
    // Fallback: If DNS blocked/fails, use the hostname directly
    if (!target) {
        target = host;
    }

    if (isPrivateIP(target)) return null;

    // Check cache with resolved IP
    if (target !== host && cache[target]) {
        updateCache(host, cache[target]);
        return cache[target];
    }

    // 3. Try Providers Sequentially
    
    // Attempt 1: ipwho.is
    let result = await fetchIpWhoIs(target);
    
    // Attempt 2: V2Fly (Fallback)
    if (!result) {
        await delay(500); 
        result = await fetchV2Fly(target);
    }

    if (result) {
        updateCache(host, result);
        if (target !== host) updateCache(target, result);
        return result;
    }

    return null; 
};

export const batchResolve = async (hosts: string[]): Promise<Record<string, LocationData>> => {
    const uniqueHosts = [...new Set(hosts.filter(h => !!h && h !== 'localhost' && h !== '127.0.0.1'))];
    const results: Record<string, LocationData> = {};
    
    for (const host of uniqueHosts) {
        const data = await resolveLocation(host);
        if (data) {
            results[host] = data;
        }
        
        // Adaptive Delay:
        const cache = getCache();
        // If it wasn't cached, we likely made a network request. Wait to respect rate limits.
        if (!cache[host]) {
            await delay(800); // 0.8s delay (ipwho.is allows ~3 req/sec burst but safe is lower)
        } else {
             await delay(20); // Negligible delay for cache
        }
    }
    
    return results;
};
