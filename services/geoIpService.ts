export interface LocationData {
  flag: string;
  country: string;
  city: string;
  isp?: string;
}

const CACHE_KEY = 'v2ray_geoip_robust_v5';

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
        try { localStorage.clear(); } catch {}
    }
};

// Convert ISO country code to Emoji Flag
const getFlagEmoji = (countryCode: string) => {
    if (!countryCode) return '🏳️';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
};

const isIP = (str: string) => {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(str) || str.includes(':');
};

const isPrivateIP = (ip: string) => {
    if (!isIP(ip)) return ip === 'localhost';
    return /^(::f{4}:)?10\.|\.|(?:^127\.)|(?:^169\.254\.)|(?:^192\.168\.)|(?:^172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(ip);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// DNS Resolver (Cloudflare -> Google -> Fallback)
const resolveDns = async (domain: string): Promise<string> => {
    if (isIP(domain)) return domain; 
    
    try {
        const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, {
            headers: { 'Accept': 'application/dns-json' }
        });
        const data = await res.json();
        if (data.Answer?.[0]?.data) return data.Answer[0].data;
    } catch {}

    try {
        const res = await fetch(`https://dns.google/resolve?name=${domain}&type=A`);
        const data = await res.json();
        if (data.Answer?.[0]?.data) return data.Answer[0].data;
    } catch {}

    return domain; // Return original if resolve fails
};

// Provider 1: IpWhoIs (Best data, Strict Rate Limit)
const fetchIpWhoIs = async (target: string): Promise<LocationData | null> => {
    try {
        const res = await fetch(`https://ipwho.is/${target}?lang=en`);
        const data = await res.json();
        if (data.success) {
            // Check if returned IP matches targeted IP (anti-spoofing)
            if (isIP(target) && data.ip !== target) return null;
            
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

// Provider 2: GeoJS (Permissive, Fast, Good Fallback)
const fetchGeoJS = async (target: string): Promise<LocationData | null> => {
    try {
        const res = await fetch(`https://get.geojs.io/v1/ip/geo/${target}.json`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.country_code) {
             return {
                flag: getFlagEmoji(data.country_code),
                country: data.country || data.country_code,
                city: data.city || '',
                isp: data.organization_name || ''
            };
        }
    } catch {}
    return null;
};

// Provider 3: V2Fly (V2Ray Specific, Reliable)
const fetchV2Fly = async (target: string): Promise<LocationData | null> => {
    try {
        const res = await fetch(`https://api.v2fly.org/web/geoip?ip=${target}`);
        const data = await res.json();
        if (data.country) {
            return {
                flag: getFlagEmoji(data.country),
                country: data.country,
                city: '', 
                isp: ''
            };
        }
    } catch {}
    return null;
};

export const resolveLocation = async (host: string): Promise<LocationData | null> => {
    if (!host || host.length < 3) return null;
    
    // Cache Hit?
    const cache = getCache();
    if (cache[host]) return cache[host];

    // Resolve IP
    const ip = await resolveDns(host);
    if (isPrivateIP(ip)) return null;

    // Check Cache with IP
    if (ip !== host && cache[ip]) {
        updateCache(host, cache[ip]);
        return cache[ip];
    }

    // Try Providers
    let result = await fetchGeoJS(ip); // Try GeoJS first (fastest/least restriction)
    
    if (!result) {
        await delay(200);
        result = await fetchIpWhoIs(ip); // Try IpWhoIs (better data)
    }
    
    if (!result) {
        await delay(200);
        result = await fetchV2Fly(ip); // Last resort
    }

    if (result) {
        updateCache(host, result);
        if (ip !== host) updateCache(ip, result);
        return result;
    }

    return null; 
};

export const batchResolve = async (hosts: string[]): Promise<Record<string, LocationData>> => {
    const uniqueHosts = [...new Set(hosts.filter(h => !!h && !h.includes('localhost') && !h.includes('127.0.0.1')))];
    const results: Record<string, LocationData> = {};
    
    // Process in smaller chunks to avoid total blocking but respect limits
    // GeoJS handles concurrency well.
    const CHUNK_SIZE = 3; 
    
    for (let i = 0; i < uniqueHosts.length; i += CHUNK_SIZE) {
        const chunk = uniqueHosts.slice(i, i + CHUNK_SIZE);
        const promises = chunk.map(async (host) => {
            const data = await resolveLocation(host);
            if (data) results[host] = data;
        });
        
        await Promise.all(promises);
        
        // Small delay between chunks to be polite
        if (i + CHUNK_SIZE < uniqueHosts.length) {
            await delay(300);
        }
    }
    
    return results;
};
