export interface LocationData {
  flag: string;
  country: string;
  city: string; // Kept for interface compatibility
}

const CACHE_KEY = 'v2ray_geoip_cache_v6'; // Bumped version again

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
    
    // Filter standard private ranges and localhost
    if (host === 'localhost') return false;
    
    // Regex for Private IPv4 addresses (10.x, 192.168.x, 172.16-31.x, 127.x)
    // Also matches specific test domains if needed
    const privateIpRegex = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|::1)/;
    if (privateIpRegex.test(host)) return false;

    return true;
};

// Check if string is an IP address
const isIpAddress = (host: string) => {
    // Simple check for IPv4 or IPv6 structure
    return /^[\d.]+$|:|\[.*\]/.test(host);
};

export const resolveLocation = async (host: string): Promise<LocationData | null> => {
    if (!isValidHost(host)) return null;
    
    // Check local cache first
    const cache = getCache();
    if (cache[host]) return cache[host];

    let targetIp = host;

    // 1. Resolve DNS if it's a domain
    if (!isIpAddress(host)) {
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 2000);
            const dnsRes = await fetch(`https://dns.google/resolve?name=${host}&type=A`, { 
                signal: controller.signal,
                cache: 'no-store' 
            });
            const dnsData = await dnsRes.json();
            if (dnsData.Answer && dnsData.Answer.length > 0) {
                const aRecord = dnsData.Answer.find((r: any) => r.type === 1);
                if (aRecord) targetIp = aRecord.data;
            }
        } catch (e) {
            // DNS failed, we proceed with the hostname. 
            // Note: If hostname is blocked/unresolvable by the next API, it might fail.
        }
    }

    // Double check resolved IP is valid
    if (!isValidHost(targetIp)) return null;

    // 2. Try Primary Provider: ipwho.is
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3500);
        
        const res = await fetch(`https://ipwho.is/${targetIp}?lang=en`, { 
            signal: controller.signal,
            referrerPolicy: 'no-referrer',
            cache: 'no-store'
        });
        const data = await res.json();

        if (data.success) {
            const result: LocationData = {
                flag: getFlagEmoji(data.country_code),
                country: data.country,
                city: "" 
            };
            updateCache(host, result);
            return result;
        }
    } catch (e) {
        // Fallthrough
    }

    // 3. Try Fallback Provider: geojs.io
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3500);

        const res = await fetch(`https://get.geojs.io/v1/ip/country/full/${targetIp}.json`, {
            signal: controller.signal,
            cache: 'no-store'
        });
        const data = await res.json();
        
        // CRITICAL CHECK: Ensure GeoJS returned info for the REQUESTED IP.
        // GeoJS returns {ip: "...", name: "..."}. We verify 'ip' matches targetIp.
        // If targetIp was a domain, we can't strict verify easily, but we assume it worked.
        // If targetIp was an IP, we match it.
        const returnedIp = data.ip;
        
        // Logic: If we sent an IP, the returned IP must match (or close enough if we allow it).
        // If we sent a domain, we accept whatever IP they resolved it to.
        let isMatch = true;
        if (isIpAddress(targetIp) && returnedIp && returnedIp !== targetIp) {
            // Strict check: if GeoJS returns a different IP, it likely fell back to requester IP.
            isMatch = false;
        }

        if (isMatch && data.name && data.alpha2) {
            const result: LocationData = {
                flag: getFlagEmoji(data.alpha2),
                country: data.name,
                city: ""
            };
            updateCache(host, result);
            return result;
        }
    } catch (e) {
        // Fallthrough
    }

    return null; 
};

export const batchResolve = async (hosts: string[]): Promise<Record<string, LocationData>> => {
    const uniqueHosts = [...new Set(hosts.filter(h => isValidHost(h)))];
    const results: Record<string, LocationData> = {};
    
    // Conservative Batch Size
    const BATCH_SIZE = 2;
    
    for (let i = 0; i < uniqueHosts.length; i += BATCH_SIZE) {
        const batch = uniqueHosts.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (host) => {
            const res = await resolveLocation(host);
            if (res) results[host] = res;
        }));
        
        if (i + BATCH_SIZE < uniqueHosts.length) {
            await new Promise(r => setTimeout(r, 1100));
        }
    }
    return results;
};
