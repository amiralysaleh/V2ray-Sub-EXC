export interface LocationData {
  flag: string;
  country: string;
  city: string; // Kept for interface compatibility, but empty string is used if not needed
}

const CACHE_KEY = 'v2ray_geoip_cache_v5'; // Bumped version to force refresh

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
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
};

// Convert ISO country code to Emoji Flag
const getFlagEmoji = (countryCode: string) => {
    if (!countryCode) return '';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
};

// Validate if string is likely a resolvable host
const isValidHost = (host: string): boolean => {
    if (!host || host.length < 3) return false;
    if (host.includes('127.0.0.1') || host.includes('localhost') || host.includes('::1')) return false;
    return true;
};

export const resolveLocation = async (host: string): Promise<LocationData | null> => {
    if (!isValidHost(host)) return null;
    
    // Check local cache first
    const cache = getCache();
    if (cache[host]) return cache[host];

    let targetIp = host;

    // 1. Resolve DNS if it's a domain (to get accurate server location, not CDN edge sometimes)
    if (/[a-zA-Z]/.test(host) && !host.includes(':')) {
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 2000);
            const dnsRes = await fetch(`https://dns.google/resolve?name=${host}&type=A`, { signal: controller.signal });
            const dnsData = await dnsRes.json();
            if (dnsData.Answer && dnsData.Answer.length > 0) {
                const aRecord = dnsData.Answer.find((r: any) => r.type === 1);
                if (aRecord) targetIp = aRecord.data;
            }
        } catch (e) {
            // DNS failed, proceed with hostname directly
        }
    }

    // 2. Try Primary Provider: ipwho.is (Detailed)
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000);
        
        const res = await fetch(`https://ipwho.is/${targetIp}?lang=en`, { 
            signal: controller.signal,
            referrerPolicy: 'no-referrer' 
        });
        const data = await res.json();

        if (data.success) {
            const result: LocationData = {
                flag: getFlagEmoji(data.country_code),
                country: data.country,
                city: "" // Explicitly empty as requested
            };
            updateCache(host, result);
            return result;
        }
    } catch (e) {
        console.warn(`Primary GeoIP failed for ${host}, trying fallback...`);
    }

    // 3. Try Fallback Provider: geojs.io (Simple, Fast, HTTPS)
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000);

        const res = await fetch(`https://get.geojs.io/v1/ip/country/full/${targetIp}.json`, {
            signal: controller.signal
        });
        // Returns: {"name":"United States","alpha2":"US"}
        const data = await res.json();
        
        if (data.name && data.alpha2) {
            const result: LocationData = {
                flag: getFlagEmoji(data.alpha2),
                country: data.name,
                city: ""
            };
            updateCache(host, result);
            return result;
        }
    } catch (e) {
        console.warn(`Fallback GeoIP failed for ${host}`);
    }

    return null; 
};

export const batchResolve = async (hosts: string[]): Promise<Record<string, LocationData>> => {
    const uniqueHosts = [...new Set(hosts.filter(h => isValidHost(h)))];
    const results: Record<string, LocationData> = {};
    
    // REDUCED Batch size to 2 to match ipwho.is rate limits (approx 2 req/sec safe)
    const BATCH_SIZE = 2;
    
    for (let i = 0; i < uniqueHosts.length; i += BATCH_SIZE) {
        const batch = uniqueHosts.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (host) => {
            const res = await resolveLocation(host);
            if (res) results[host] = res;
        }));
        
        // Delay between batches
        if (i + BATCH_SIZE < uniqueHosts.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return results;
};
