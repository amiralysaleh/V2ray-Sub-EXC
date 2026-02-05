export interface LocationData {
  flag: string;
  country: string;
  city: string; // Kept for interface compatibility
}

const CACHE_KEY = 'v2ray_geoip_cache_v7'; // Bumped version for cache refresh

// Helper to get cache from localStorage
const getCache = (): Record<string, LocationData> => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch { 
    return {}; 
  }
};

// Helper to save cache
const updateCache = (host: string, data: LocationData) => {
  const cache = getCache();
  cache[host] = data;
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
};

// Convert ISO country code to Emoji Flag
const getFlagEmoji = (countryCode: string): string => {
  if (!countryCode || typeof countryCode !== 'string') return '🏳️';
  
  const code = countryCode.trim().toUpperCase();
  
  // Must be exactly 2 characters A-Z
  if (code.length !== 2 || !/^[A-Z]{2}$/.test(code)) {
    return '🏳️';
  }
  
  try {
    const codePoints = code.split('').map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch (e) {
    return '🏳️';
  }
};

// Country code to name mapping for common countries (fallback)
const COUNTRY_NAMES: Record<string, string> = {
  'US': 'United States', 'GB': 'United Kingdom', 'DE': 'Germany', 'FR': 'France',
  'IT': 'Italy', 'ES': 'Spain', 'NL': 'Netherlands', 'CA': 'Canada',
  'AU': 'Australia', 'JP': 'Japan', 'KR': 'South Korea', 'SG': 'Singapore',
  'HK': 'Hong Kong', 'IN': 'India', 'BR': 'Brazil', 'RU': 'Russia',
  'TR': 'Turkey', 'AE': 'UAE', 'SE': 'Sweden', 'NO': 'Norway', 'FI': 'Finland',
  'PL': 'Poland', 'UA': 'Ukraine', 'CH': 'Switzerland', 'AT': 'Austria',
  'BE': 'Belgium', 'DK': 'Denmark', 'IE': 'Ireland', 'PT': 'Portugal',
  'CZ': 'Czech Republic', 'HU': 'Hungary', 'RO': 'Romania', 'BG': 'Bulgaria',
  'HR': 'Croatia', 'GR': 'Greece', 'IL': 'Israel', 'ZA': 'South Africa',
  'MX': 'Mexico', 'AR': 'Argentina', 'CL': 'Chile', 'CO': 'Colombia',
  'PE': 'Peru', 'VE': 'Venezuela', 'TH': 'Thailand', 'VN': 'Vietnam',
  'MY': 'Malaysia', 'ID': 'Indonesia', 'PH': 'Philippines', 'TW': 'Taiwan',
  'CN': 'China', 'PK': 'Pakistan', 'BD': 'Bangladesh', 'NG': 'Nigeria',
  'EG': 'Egypt', 'SA': 'Saudi Arabia', 'QA': 'Qatar', 'KW': 'Kuwait',
  'OM': 'Oman', 'BH': 'Bahrain', 'JO': 'Jordan', 'LB': 'Lebanon', 'IQ': 'Iraq',
  'IR': 'Iran', 'AF': 'Afghanistan', 'KZ': 'Kazakhstan', 'UZ': 'Uzbekistan',
  'AZ': 'Azerbaijan', 'AM': 'Armenia', 'GE': 'Georgia', 'MD': 'Moldova',
  'BY': 'Belarus', 'LT': 'Lithuania', 'LV': 'Latvia', 'EE': 'Estonia',
  'SK': 'Slovakia', 'SI': 'Slovenia', 'LU': 'Luxembourg', 'MT': 'Malta',
  'CY': 'Cyprus', 'IS': 'Iceland', 'AL': 'Albania', 'BA': 'Bosnia',
  'ME': 'Montenegro', 'MK': 'North Macedonia', 'RS': 'Serbia', 'XK': 'Kosovo',
  'LI': 'Liechtenstein', 'MC': 'Monaco', 'AD': 'Andorra', 'SM': 'San Marino',
  'VA': 'Vatican', 'GI': 'Gibraltar', 'FO': 'Faroe Islands', 'GL': 'Greenland',
  'SJ': 'Svalbard', 'AX': 'Aland Islands', 'NC': 'New Caledonia', 'PF': 'French Polynesia',
  'WF': 'Wallis and Futuna', 'TF': 'French Southern Territories', 'GP': 'Guadeloupe',
  'MQ': 'Martinique', 'RE': 'Reunion', 'YT': 'Mayotte', 'PM': 'Saint Pierre and Miquelon',
  'BL': 'Saint Barthelemy', 'MF': 'Saint Martin', 'SX': 'Sint Maarten', 'AW': 'Aruba',
  'CW': 'Curacao', 'BQ': 'Bonaire', 'AI': 'Anguilla', 'BM': 'Bermuda', 'VG': 'British Virgin Islands',
  'KY': 'Cayman Islands', 'FK': 'Falkland Islands', 'GS': 'South Georgia', 'MS': 'Montserrat',
  'PN': 'Pitcairn', 'SH': 'Saint Helena', 'TC': 'Turks and Caicos', 'GG': 'Guernsey',
  'JE': 'Jersey', 'IM': 'Isle of Man', 'CK': 'Cook Islands', 'NU': 'Niue', 'TK': 'Tokelau',
  'AS': 'American Samoa', 'GU': 'Guam', 'MP': 'Northern Mariana Islands', 'PR': 'Puerto Rico',
  'VI': 'US Virgin Islands', 'UM': 'US Minor Outlying Islands', 'FM': 'Micronesia',
  'MH': 'Marshall Islands', 'PW': 'Palau', 'NR': 'Nauru', 'KI': 'Kiribati', 'TV': 'Tuvalu',
  'TO': 'Tonga', 'WS': 'Samoa', 'FJ': 'Fiji', 'VU': 'Vanuatu', 'SB': 'Solomon Islands',
  'PG': 'Papua New Guinea', 'KI': 'Kiribati', 'NR': 'Nauru', 'PW': 'Palau', 'TV': 'Tuvalu',
  'TO': 'Tonga', 'WS': 'Samoa', 'FJ': 'Fiji', 'VU': 'Vanuatu', 'SB': 'Solomon Islands',
  'PG': 'Papua New Guinea', 'TL': 'Timor-Leste', 'BN': 'Brunei', 'KH': 'Cambodia',
  'LA': 'Laos', 'MM': 'Myanmar', 'NP': 'Nepal', 'LK': 'Sri Lanka', 'MV': 'Maldives',
  'BT': 'Bhutan', 'MN': 'Mongolia', 'KP': 'North Korea', 'MO': 'Macau', 'KG': 'Kyrgyzstan',
  'TJ': 'Tajikistan', 'TM': 'Turkmenistan', 'MN': 'Mongolia', 'NP': 'Nepal', 'LK': 'Sri Lanka',
  'MV': 'Maldives', 'BT': 'Bhutan', 'BN': 'Brunei', 'KH': 'Cambodia', 'LA': 'Laos',
  'MM': 'Myanmar', 'TL': 'Timor-Leste', 'MN': 'Mongolia', 'KG': 'Kyrgyzstan',
  'TJ': 'Tajikistan', 'TM': 'Turkmenistan'
};

// Validate if string is likely a resolvable host
const isValidHost = (host: string): boolean => {
  if (!host || host.length < 3) return false;
  
  // Filter standard private ranges and localhost
  if (host === 'localhost') return false;
  
  // Regex for Private IPv4 addresses (10.x, 192.168.x, 172.16-31.x, 127.x)
  const privateIpRegex = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|::1)/;
  if (privateIpRegex.test(host)) return false;

  return true;
};

// Check if string is an IP address
const isIpAddress = (host: string): boolean => {
  // Simple check for IPv4 or IPv6 structure
  return /^[\d.]+$|:|\[.*\]/.test(host);
};

// Get country name from code
const getCountryName = (code: string): string => {
  if (!code) return 'Unknown';
  const upperCode = code.toUpperCase();
  return COUNTRY_NAMES[upperCode] || upperCode;
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
      // DNS failed, proceed with hostname
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
      const countryCode = data.country_code || '';
      const countryName = data.country || getCountryName(countryCode);
      
      const result: LocationData = {
        flag: getFlagEmoji(countryCode),
        country: countryName,
        city: data.city || ''
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
    
    const returnedIp = data.ip;
    
    let isMatch = true;
    if (isIpAddress(targetIp) && returnedIp && returnedIp !== targetIp) {
      isMatch = false;
    }

    if (isMatch && (data.name || data.alpha2)) {
      const countryCode = data.alpha2 || '';
      const countryName = data.name || getCountryName(countryCode);
      
      const result: LocationData = {
        flag: getFlagEmoji(countryCode),
        country: countryName,
        city: ''
      };
      updateCache(host, result);
      return result;
    }
  } catch (e) {
    // Fallthrough
  }

  // 4. Try ipapi.co as second fallback
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`https://ipapi.co/${targetIp}/json/`, {
      signal: controller.signal,
      cache: 'no-store'
    });
    const data = await res.json();
    
    if (data.country_code) {
      const countryCode = data.country_code;
      const countryName = data.country_name || getCountryName(countryCode);
      
      const result: LocationData = {
        flag: getFlagEmoji(countryCode),
        country: countryName,
        city: data.city || ''
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
