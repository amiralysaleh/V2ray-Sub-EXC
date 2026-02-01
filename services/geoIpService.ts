export interface LocationData {
  flag: string;
  country: string;
  city: string;
}

const CACHE_KEY = 'v2ray_geoip_full_cache_v2';

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

export const resolveLocation = async (host: string): Promise<LocationData | null> => {
    if (!host) return null;
    
    // Check local cache first
    const cache = getCache();
    if (cache[host]) return cache[host];

    try {
        let ip = host;
        
        // 1. Resolve DNS if it's a domain
        if (/[a-zA-Z]/.test(host) && !host.includes(':')) {
            try {
                const dnsRes = await fetch(`https://dns.google/resolve?name=${host}&type=A`);
                const dnsData = await dnsRes.json();
                if (dnsData.Answer && dnsData.Answer.length > 0) {
                    const aRecord = dnsData.Answer.find((r: any) => r.type === 1);
                    if (aRecord) ip = aRecord.data;
                }
            } catch (dnsError) {
                console.warn(`DNS lookup failed for ${host}`, dnsError);
            }
        }

        // 2. Get GeoIP using ipwho.is
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        
        // Add random param to avoid cache hits on the API side if needed
        const geoRes = await fetch(`https://ipwho.is/${ip}?lang=en`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const geoData = await geoRes.json();

        if (geoData.success) {
            const data: LocationData = {
                flag: getFlagEmoji(geoData.country_code),
                country: geoData.country || '',
                city: geoData.city || ''
            };
            updateCache(host, data); 
            return data;
        }
    } catch (e) {
        console.warn(`Failed to resolve location for ${host}`, e);
    }

    return null; 
};

export const batchResolve = async (hosts: string[]): Promise<Record<string, LocationData>> => {
    const uniqueHosts = [...new Set(hosts.filter(h => !!h))];
    const results: Record<string, LocationData> = {};
    
    // Reduced batch size and added delay to avoid rate limits (which cause incorrect location data)
    const BATCH_SIZE = 2;
    for (let i = 0; i < uniqueHosts.length; i += BATCH_SIZE) {
        const batch = uniqueHosts.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (host) => {
            // Small jitter
            await new Promise(r => setTimeout(r, Math.random() * 300));
            const res = await resolveLocation(host);
            if (res) results[host] = res;
        }));
        // Delay between batches
        await new Promise(r => setTimeout(r, 800));
    }
    return results;
};
