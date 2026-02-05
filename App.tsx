import React, { useState, useEffect } from 'react';
import { processConfigs, getTehranDate, parseSubscription } from './services/v2rayService';
import { createOrUpdateGist } from './services/githubService';
import { generateSmartDescription } from './services/geminiService';
import { Toggle } from './components/Toggle';
import { ProcessingOptions, LogEntry } from './types';
import { Activity, Link as LinkIcon, Terminal, AlertTriangle, Download, GitMerge, RefreshCw, Trash2, Settings2, Globe, Cloud, Network, Search, Plus, Save, PenTool, X } from 'lucide-react';

const App: React.FC = () => {
  const githubToken = (import.meta as any).env?.VITE_GITHUB_TOKEN || '';

  // App State
  const [filename, setFilename] = useState('sub.txt'); // Changed to mutable state
  const [inputConfigs, setInputConfigs] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  
  // Import/Edit State
  const [importUrl, setImportUrl] = useState('');
  const [gistId, setGistId] = useState(''); 
  const [isManualGistId, setIsManualGistId] = useState(false); // Toggle for Gist ID input
  
  // Processing Options
  const [options, setOptions] = useState<ProcessingOptions>({
    enableMux: false,
    muxConcurrency: 8,
    enableFragment: false,
    fragmentLength: '10-20',
    fragmentInterval: '10-20',
    allowInsecure: false,
    enableALPN: false,
    addRandomAlias: true,
    addLocationFlag: true, // Master switch for GeoIP Naming
    enableCDNIP: false,
    customCDN: '',
    customBaseName: ''
  });

  // Helper to extract Gist ID robustly
  const extractGistId = (url: string): string | null => {
    const regex = /(?:gist\.github(?:usercontent)?\.com)(?:\/[^/]+)?\/([0-9a-f]{32})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  // Helper to extract Filename from URL
  const extractFilename = (url: string): string => {
    try {
        const cleanUrl = url.split('?')[0].split('#')[0];
        const parts = cleanUrl.split('/');
        const possibleName = parts[parts.length - 1];
        if (possibleName && possibleName.includes('.')) {
            return possibleName;
        }
        return 'sub.txt';
    } catch {
        return 'sub.txt';
    }
  };

  // Automatically detect Gist ID when URL changes
  useEffect(() => {
    if (!importUrl.trim()) return;
    
    const detectedId = extractGistId(importUrl);
    if (detectedId && detectedId !== gistId) {
        setGistId(detectedId);
    }
  }, [importUrl]);

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [{ type, message, timestamp: new Date() }, ...prev]);
  };

  const handleImport = async () => {
    if (!importUrl) return;
    setLoading(true);
    addLog('info', 'در حال دریافت کانفیگ‌ها از لینک...');
    try {
      const detectedId = extractGistId(importUrl);
      if (detectedId) setGistId(detectedId);

      // Extract and set filename so we overwrite the correct file
      const detectedFilename = extractFilename(importUrl);
      setFilename(detectedFilename);
      
      // Add Cache Busting timestamp
      const fetchUrl = `${importUrl}${importUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
      
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('خطا در دریافت فایل');
      const text = await response.text();
      
      // Try to detect format
      if (text.trim().startsWith('{') && text.includes('outbounds')) {
          // If importing a JSON config, we try to extract links back if possible, 
          // or just warn user. Currently we only support importing standard subs.
          addLog('info', 'وارد کردن فایل JSON پشتیبانی نمی‌شود. لطفا لینک‌های استاندارد وارد کنید.');
      } else {
          const decoded = parseSubscription(text);
          setInputConfigs(decoded);
          addLog('success', `کانفیگ‌ها دریافت شدند. (فایل هدف: ${detectedFilename})`);
      }
      
      if (detectedId) {
        addLog('info', `شناسایی سابسکریپشن قدیمی (ID: ${detectedId.substring(0,6)}...)`);
      }
    } catch (e: any) {
      addLog('error', `خطا در ورود: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async (isUpdate: boolean) => {
    if (!githubToken) {
      addLog('error', 'توکن گیت‌هاب تنظیم نشده است.');
      return;
    }
    if (!inputConfigs.trim()) {
      addLog('error', 'لیست کانفیگ‌ها خالی است.');
      return;
    }

    if (isUpdate && !gistId.trim()) {
        addLog('error', 'برای آپدیت، شناسه Gist ID الزامی است. لطفا آن را وارد کنید یا گزینه "Create New" را بزنید.');
        setIsManualGistId(true); // Auto open the field if missing
        return;
    }

    setLoading(true);
    const targetId = isUpdate ? gistId : undefined;
    const actionType = isUpdate ? 'UPDATE' : 'CREATE';

    addLog('info', `شروع عملیات: ${actionType === 'UPDATE' ? `بروزرسانی Gist (${gistId.substring(0,6)}...)` : 'ساخت Gist جدید'}...`);
    addLog('info', `فایل هدف: ${filename}`);

    if (options.addLocationFlag) {
        addLog('info', 'در حال تشخیص موقعیت جغرافیایی و نام‌گذاری مجدد سرورها...');
    }

    try {
      const processed = await processConfigs(inputConfigs, options);
      const count = inputConfigs.split('\n').filter(l => l.trim()).length;
      const tehranTime = getTehranDate();
      
      addLog('info', 'در حال تولید توضیحات');
      const desc = await generateSmartDescription(count, tehranTime);
      
      addLog('info', 'در حال ارسال به GitHub...');
      const res = await createOrUpdateGist(githubToken, filename, processed, desc, targetId);
      
      if (res.files[filename]?.raw_url) {
        const rawUrl = res.files[filename].raw_url;
        // Strip commit hash for permanent link
        const permanentUrl = rawUrl.replace(/\/raw\/[a-z0-9]+\//i, '/raw/');

        setResultUrl(permanentUrl);
        
        if (!targetId) {
            setGistId(res.id);
        }
        addLog('success', isUpdate ? 'اشتراک با موفقیت بروزرسانی شد.' : 'اشتراک جدید با موفقیت ساخته شد.');
        
        if (isUpdate) {
             addLog('info', 'توجه: به دلیل کش CDN گیت‌هاب، تغییرات ممکن است تا ۵ دقیقه روی لینک ثابت اعمال نشود.');
        }
      }
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8 font-sans selection:bg-primary-500/30">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Header Section */}
        <div className="lg:col-span-3 flex flex-col md:flex-row items-center justify-between mb-2 border-b border-gray-800 pb-6">
          <div className="flex items-center gap-6 mb-4 md:mb-0">
            {/* Custom Logo */}
            <div className="relative w-24 h-16 rounded-xl overflow-hidden shadow-2xl shadow-green-900/40 border border-white/10 group hover:scale-105 transition-transform duration-500">
                <img 
                  src="https://flagofiran.com/files/Flag_of_Iran.svg" 
                  alt="Flag of Iran" 
                  className="w-full h-full object-cover" 
                />
                {/* Gloss Effect */}
                <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none"></div>
            </div>
            <div>
              <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-green-400 via-white to-red-500 tracking-tight drop-shadow-sm">
                V2Ray SubManager
              </h1>
              <p className="text-xs md:text-sm text-gray-400 font-bold mt-1 tracking-wide">به امید ایرانی آزاد 🕊️</p>
            </div>
          </div>
          
          {!githubToken && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/50 text-red-400 px-4 py-2 rounded-xl text-xs font-bold animate-pulse">
              <AlertTriangle size={16} />
              <span>GITHUB TOKEN NOT FOUND</span>
            </div>
          )}
        </div>

        {/* Sidebar: Optimization Settings */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gray-900/50 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-xl">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 text-gray-100">
              <Activity className="text-primary-500" size={22} /> Settings
            </h2>
            <div className="space-y-1 divide-y divide-gray-800/50">
              
              {/* Naming Settings */}
              <div className="py-3">
                 <div className="flex items-center gap-2 mb-2 text-sm font-bold text-gray-200">
                     <PenTool size={16} className="text-purple-400"/>
                     Config Naming
                 </div>
                 <Toggle label="Auto Rename" description="Format: Flag Country City Name #N" checked={options.addLocationFlag} onChange={(v) => setOptions({...options, addLocationFlag: v})} />
                 
                 <div className="mt-2 px-2">
                     <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Custom Base Name</label>
                     <input 
                       type="text" 
                       placeholder="Default: VS (e.g. MyVPN)" 
                       value={options.customBaseName} 
                       onChange={(e) => setOptions({...options, customBaseName: e.target.value})} 
                       className="w-full bg-gray-950/50 border border-gray-800 rounded px-2 py-1.5 text-xs text-purple-300 font-mono outline-none focus:border-purple-500/50 placeholder:text-gray-700"
                     />
                 </div>
              </div>

              {/* Custom CDN/IP Section */}
              <div className="py-1">
                <Toggle label="Custom Cloudflare IP" description="Revive broken configs (WS/GRPC)" checked={options.enableCDNIP} onChange={(v) => setOptions({...options, enableCDNIP: v})} />
                {options.enableCDNIP && (
                  <div className="pb-3 px-2 space-y-2">
                    <input 
                        type="text" 
                        placeholder="e.g., 104.16.x.x or clean.domain"
                        value={options.customCDN} 
                        onChange={(e) => setOptions({...options, customCDN: e.target.value})} 
                        className="w-full bg-gray-950/50 border border-yellow-800/50 rounded px-2 py-1.5 text-xs text-yellow-300 font-mono outline-none focus:border-yellow-500/50"
                      />
                    <a 
                      href="https://drunkleen.github.io/ip-scanner/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-2 bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700/50 rounded-lg text-xs text-yellow-500 font-bold transition-all"
                    >
                      <Search size={14} />
                      Find Clean Cloudflare IPs
                    </a>
                  </div>
                )}
              </div>

              {/* MUX Section */}
              <div className="py-1">
                <Toggle label="Multiplexing (Mux)" description="Handshake optimization" checked={options.enableMux} onChange={(v) => setOptions({...options, enableMux: v})} />
                {options.enableMux && (
                  <div className="pb-3 px-2 flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">Concurrency:</span>
                    <input 
                      type="number" 
                      min="1" max="1024"
                      value={options.muxConcurrency} 
                      onChange={(e) => setOptions({...options, muxConcurrency: parseInt(e.target.value) || 8})} 
                      className="w-16 bg-gray-950/50 border border-gray-800 rounded px-2 py-1 text-xs text-primary-400 font-mono outline-none focus:border-primary-500/50"
                    />
                  </div>
                )}
              </div>

              {/* Fragment Section */}
              <div className="py-1">
                <Toggle label="Packet Fragment" description="Bypass DPI filtering" checked={options.enableFragment} onChange={(v) => setOptions({...options, enableFragment: v})} />
                {options.enableFragment && (
                  <div className="pb-3 px-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Length:</span>
                      <input 
                        type="text" 
                        placeholder="10-20"
                        value={options.fragmentLength} 
                        onChange={(e) => setOptions({...options, fragmentLength: e.target.value})} 
                        className="flex-1 bg-gray-950/50 border border-gray-800 rounded px-2 py-1 text-xs text-primary-400 font-mono outline-none focus:border-primary-500/50 text-right"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Interval:</span>
                      <input 
                        type="text" 
                        placeholder="10-20"
                        value={options.fragmentInterval} 
                        onChange={(e) => setOptions({...options, fragmentInterval: e.target.value})} 
                        className="flex-1 bg-gray-950/50 border border-gray-800 rounded px-2 py-1 text-xs text-primary-400 font-mono outline-none focus:border-primary-500/50 text-right"
                      />
                    </div>
                  </div>
                )}
              </div>

              <Toggle label="Allow Insecure" description="Skip TLS verification" checked={options.allowInsecure} onChange={(v) => setOptions({...options, allowInsecure: v})} />
              <Toggle label="Optimize ALPN" description="Force h2,http/1.1 (TLS only)" checked={options.enableALPN} onChange={(v) => setOptions({...options, enableALPN: v})} />
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-gray-900/50 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-xl flex flex-col min-h-[480px]">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
                <h2 className="text-xl font-bold flex items-center gap-2 text-gray-100">
                  <Terminal className="text-primary-500" size={24} /> Input Source
                </h2>
                
                {/* Gist ID Input / Auto Toggle */}
                <div className="w-full sm:w-auto flex justify-end">
                    {isManualGistId ? (
                        <div className="flex items-center gap-2 w-full sm:w-auto bg-gray-950/80 rounded-lg border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.15)] px-2 py-1.5 transition-all">
                            <GitMerge size={14} className="text-blue-500" />
                            <input 
                                type="text" 
                                placeholder="Paste Gist ID here..." 
                                value={gistId}
                                onChange={(e) => setGistId(e.target.value.trim())}
                                className="bg-transparent border-none text-[11px] font-mono text-blue-300 placeholder:text-gray-600 focus:outline-none w-full sm:w-48"
                                autoFocus
                            />
                            <button 
                                onClick={() => setIsManualGistId(false)} 
                                className="text-gray-500 hover:text-gray-300 text-[10px] bg-gray-800/50 px-1.5 py-0.5 rounded"
                                title="Switch back to Auto Mode"
                            >
                                Auto
                            </button>
                        </div>
                    ) : (
                        <button 
                          onClick={() => setIsManualGistId(true)}
                          className="group flex items-center gap-2 bg-gray-900/50 hover:bg-gray-900 border border-gray-800 hover:border-blue-500/30 rounded-lg px-3 py-1.5 transition-all"
                          title="Click to manually set Gist ID"
                        >
                            <div className={`w-2 h-2 rounded-full ${gistId ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-600'}`}></div>
                            <span className="text-[11px] font-mono text-gray-400 group-hover:text-blue-300">
                                {gistId ? `ID: ${gistId.substring(0, 6)}...` : 'Gist ID: Auto'}
                            </span>
                            <Settings2 size={12} className="text-gray-600 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                    )}
                </div>
            </div>

            <div className="flex gap-2 mb-4 p-2 bg-gray-950/80 rounded-xl border border-gray-800 focus-within:border-primary-500 transition-all">
               <input 
                 type="text" 
                 placeholder="Import existing subscription URL..." 
                 className="flex-1 bg-transparent border-none rounded px-3 py-1.5 text-xs text-gray-300 focus:outline-none font-mono"
                 value={importUrl}
                 onChange={e => setImportUrl(e.target.value)}
               />
               <button onClick={handleImport} disabled={loading || !importUrl} className="bg-primary-600 hover:bg-primary-500 text-white p-2.5 rounded-lg transition-all disabled:opacity-30"><Download size={16} /></button>
            </div>

            <textarea
              value={inputConfigs}
              onChange={(e) => setInputConfigs(e.target.value)}
              placeholder="Paste Vmess, Vless, Trojan, SS, SSR links..."
              className="flex-1 w-full bg-gray-950/50 border border-gray-800 rounded-xl p-4 font-mono text-sm text-gray-300 focus:ring-2 focus:ring-primary-500/50 outline-none resize-none placeholder:text-gray-700"
            />
            
            <div className="mt-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="text-xs text-gray-500 font-medium italic">
                {inputConfigs.split('\n').filter(l => l.trim()).length} servers detected in list
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                 <button
                    onClick={() => handlePublish(false)}
                    disabled={loading || !githubToken || !inputConfigs.trim()}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 font-bold py-3 px-6 rounded-2xl transition-all active:scale-95 disabled:opacity-30 text-xs sm:text-sm whitespace-nowrap"
                  >
                     <Plus size={18} />
                     Create New
                  </button>
                  <button
                    onClick={() => handlePublish(true)}
                    disabled={loading || !githubToken || !inputConfigs.trim() || !gistId}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-700 disabled:to-gray-700 text-white font-black py-3 px-8 rounded-2xl shadow-xl shadow-green-900/20 disabled:shadow-none transition-all active:scale-95 disabled:opacity-50 text-xs sm:text-sm whitespace-nowrap"
                    title={!gistId ? 'Requires Gist ID' : 'Update this Gist'}
                  >
                    {loading ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
                    Update Existing
                  </button>
              </div>
            </div>
          </div>

          {/* Activity Logs */}
          <div className="bg-gray-900/50 backdrop-blur-md rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/80">
               <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">Activity Log</h2>
            </div>
            <div className="h-48 overflow-y-auto font-mono text-[11px] p-5 space-y-2 bg-black/20">
              {logs.length === 0 && <div className="text-gray-700 italic flex items-center justify-center h-full gap-2"><Terminal size={32} opacity={0.1}/><p>Waiting for actions...</p></div>}
              {logs.map((log, i) => (
                <div key={i} className={`flex gap-3 leading-relaxed ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-blue-300'}`}>
                  <span className="text-gray-600 flex-shrink-0">[{log.timestamp.toLocaleTimeString()}]</span>
                  <span className="font-medium">{log.message}</span>
                </div>
              ))}
            </div>

            {resultUrl && (
              <div className="p-6 bg-green-500/5 border-t border-green-500/20">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex-1 w-full">
                    <label className="text-[10px] text-green-500 font-black uppercase tracking-widest block mb-2">Permanent Subscription URL (Static)</label>
                    <input 
                        readOnly 
                        value={resultUrl} 
                        className="w-full bg-gray-950/80 border border-green-900/30 rounded-xl py-3 px-4 text-[10px] text-green-300 font-mono focus:outline-none" 
                    />
                  </div>
                  <button 
                    onClick={() => {
                        navigator.clipboard.writeText(resultUrl);
                        addLog('success', 'لینک در کلیپ‌بورد کپی شد.');
                    }} 
                    className="w-full sm:w-auto p-4 bg-green-600 hover:bg-green-500 text-white rounded-2xl shadow-lg transition-all active:scale-95"
                  >
                    <LinkIcon size={20}/>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
