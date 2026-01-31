const CACHE_KEY = 'v2ray_geoip_cache_v1';

// Helper to get cache from localStorage
const getCache = (): Record<string, string> => {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch { return {}; }
};

// Helper to save cache
const updateCache = (host: string, flag: string) => {
    const cache = getCache();
    cache[host] = flag;
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

export const resolveLocation = async (host: string): Promise<string> => {
    if (!host) return '';
    
    // Check local cache first
    const cache = getCache();
    if (cache[host]) return cache[host];

    try {
        let ip = host;
        
        // 1. Resolve DNS if it's a domain (simple check: contains letters and not IPv6)
        // We use Google DNS over HTTPS because browsers can't do raw DNS lookups
        if (/[a-zA-Z]/.test(host) && !host.includes(':')) {
            try {
                const dnsRes = await fetch(`https://dns.google/resolve?name=${host}&type=A`);
                const dnsData = await dnsRes.json();
                if (dnsData.Answer && dnsData.Answer.length > 0) {
                    // Find first A record
                    const aRecord = dnsData.Answer.find((r: any) => r.type === 1);
                    if (aRecord) ip = aRecord.data;
                }
            } catch (dnsError) {
                console.warn(`DNS lookup failed for ${host}`, dnsError);
                // Fallback: try to resolve the domain directly with the GeoIP provider
            }
        }

        // 2. Get GeoIP using ipwho.is (Free, HTTPS, No API Key)
        // Using a controller to timeout after 3 seconds
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const geoRes = await fetch(`https://ipwho.is/${ip}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const geoData = await geoRes.json();

        if (geoData.success && geoData.country_code) {
            const flag = getFlagEmoji(geoData.country_code);
            updateCache(host, flag); // Cache by original host
            return flag;
        }
    } catch (e) {
        console.warn(`Failed to resolve location for ${host}`, e);
    }

    // Cache empty string to avoid retrying failed hosts repeatedly in same session? 
    // Maybe better not to cache failures permanently.
    return ''; 
};

export const batchResolve = async (hosts: string[]): Promise<Record<string, string>> => {
    const uniqueHosts = [...new Set(hosts.filter(h => !!h))];
    const results: Record<string, string> = {};
    
    // Concurrency control: process 3 hosts at a time to avoid rate limits
    const BATCH_SIZE = 3;
    for (let i = 0; i < uniqueHosts.length; i += BATCH_SIZE) {
        const batch = uniqueHosts.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (host) => {
            results[host] = await resolveLocation(host);
        }));
    }
    return results;
};