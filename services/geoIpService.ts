export interface LocationData {
  flag: string;
  country: string;
  city: string;
  isp?: string;
}

const CACHE_KEY = 'v2ray_geoip_robust_v3';

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

// Check if IP is private/local
const isPrivateIP = (ip: string) => {
    return /^(::f{4}:)?10\.|\.|(?:^127\.)|(?:^169\.254\.)|(?:^192\.168\.)|(?:^172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(ip) || ip === 'localhost';
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// DNS Resolver using Cloudflare (more robust CORS headers than Google sometimes)
const resolveDns = async (domain: string): Promise<string | null> => {
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain) || domain.includes(':')) return domain; // Already an IP
    
    try {
        const res = await fetch(`https://dns.google/resolve?name=${domain}&type=A`);
        const data = await res.json();
        if (data.Answer && data.Answer.length > 0) {
            // Prefer type 1 (A Record)
            const rec = data.Answer.find((r: any) => r.type === 1);
            return rec ? rec.data : null;
        }
    } catch (e) {
        // console.warn('DNS Error', e);
    }
    return null;
};

// Provider 1: ipwho.is (Detailed, strict rate limit)
const fetchIpWhoIs = async (ip: string): Promise<LocationData | null> => {
    try {
        const res = await fetch(`https://ipwho.is/${ip}?lang=en`);
        const data = await res.json();
        
        // Critical: ipwho.is returns the user's IP if the requested IP is invalid or rate limited.
        // We MUST verify that the returned IP matches the requested IP.
        if (data.success && data.ip === ip) {
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
const fetchV2Fly = async (ip: string): Promise<LocationData | null> => {
    try {
        const res = await fetch(`https://api.v2fly.org/web/geoip?ip=${ip}`);
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

    // 2. Resolve DNS to IP
    // We resolve DNS first to ensure we are querying an IP. 
    // This helps avoid rate limits on "domain lookup" endpoints and allows verifying the response IP.
    const ip = await resolveDns(host);
    
    if (!ip || isPrivateIP(ip)) return null;

    // Check cache again with resolved IP (optional but good optimization)
    if (cache[ip]) {
        updateCache(host, cache[ip]); // Link host to the cached IP data
        return cache[ip];
    }

    // 3. Try Providers Sequentially
    
    // Attempt 1: ipwho.is
    let result = await fetchIpWhoIs(ip);
    
    // Attempt 2: V2Fly (Fallback)
    if (!result) {
        await delay(500); // Slight backoff before fallback
        result = await fetchV2Fly(ip);
    }

    if (result) {
        updateCache(host, result);
        updateCache(ip, result);
        return result;
    }

    return null; 
};

export const batchResolve = async (hosts: string[]): Promise<Record<string, LocationData>> => {
    const uniqueHosts = [...new Set(hosts.filter(h => !!h && h !== 'localhost' && h !== '127.0.0.1'))];
    const results: Record<string, LocationData> = {};
    
    // Strict Sequential Processing
    // Parallel requests trigger rate limits which cause "Same Flag" bug (API returning your own IP).
    // We process one by one with a delay.
    
    for (const host of uniqueHosts) {
        const data = await resolveLocation(host);
        if (data) {
            results[host] = data;
        }
        // Adaptive Delay:
        // If we hit cache, resolveLocation returns fast.
        // If we fetch API, we need to wait to respect rate limits (approx 1.5s for ipwho.is free tier safety).
        // Since we can't easily know if it was cached inside resolveLocation without refactoring return types,
        // we assume a safe delay for everyone not in localStorage.
        const cache = getCache();
        if (!cache[host]) {
            await delay(1200); // 1.2 seconds delay between network requests
        } else {
             await delay(50); // Minimal delay for cached items
        }
    }
    
    return results;
};
