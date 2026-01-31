import React, { useState, useEffect } from 'react';
import { processConfigs, getTehranDate, parseSubscription } from './services/v2rayService';
import { createOrUpdateGist } from './services/githubService';
import { generateSmartDescription } from './services/geminiService';
import { Toggle } from './components/Toggle';
import { ProcessingOptions, LogEntry } from './types';
import { Activity, Link as LinkIcon, Terminal, Zap, AlertTriangle, Download, GitMerge, RefreshCw, Trash2, Settings2, Globe, Cloud, Network, Search, Plus } from 'lucide-react';

const App: React.FC = () => {
  const githubToken = (import.meta as any).env?.VITE_GITHUB_TOKEN || '';

  // App State
  const [filename] = useState('sub.txt');
  const [inputConfigs, setInputConfigs] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  
  // Import/Edit State
  const [importUrl, setImportUrl] = useState('');
  const [gistId, setGistId] = useState<string | undefined>(undefined);
  
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
    addLocationFlag: true,
    enableDNS: false,
    customDNS: '8.8.8.8',
    enableCDNIP: false,
    customCDN: ''
  });

  // Automatically detect Gist ID when URL changes
  useEffect(() => {
    if (!importUrl.trim()) {
        setGistId(undefined);
        return;
    }
    
    // Look for standard 32-char hex ID in Gist URLs
    if (importUrl.includes('gist.github')) {
        const match = importUrl.match(/([0-9a-f]{32})/i);
        if (match) {
            const detectedId = match[1];
            if (gistId !== detectedId) {
                setGistId(detectedId);
                // Optional: We can't log inside render/effect loop easily without cluttering, 
                // but the UI badge updates immediately.
            }
        }
    }
  }, [importUrl, gistId]);

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [{ type, message, timestamp: new Date() }, ...prev]);
  };

  const handleImport = async () => {
    if (!importUrl) return;
    setLoading(true);
    addLog('info', 'در حال دریافت کانفیگ‌ها از لینک...');
    try {
      const response = await fetch(importUrl);
      if (!response.ok) throw new Error('خطا در دریافت فایل');
      const text = await response.text();
      const decoded = parseSubscription(text);
      setInputConfigs(decoded);
      addLog('success', 'کانفیگ‌ها با موفقیت دریافت شدند.');
      
      if (gistId) {
        addLog('info', `شناسایی سابسکریپشن قدیمی (ID: ${gistId.substring(0,6)}...)`);
      }
    } catch (e: any) {
      addLog('error', `خطا در ورود: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async (forceNew: boolean = false) => {
    if (!githubToken) {
      addLog('error', 'توکن گیت‌هاب تنظیم نشده است.');
      return;
    }
    if (!inputConfigs.trim()) {
      addLog('error', 'لیست کانفیگ‌ها خالی است.');
      return;
    }

    setLoading(true);
    const targetId = forceNew ? undefined : gistId;
    const actionType = targetId ? 'UPDATE' : 'CREATE';

    addLog('info', `شروع عملیات: ${actionType === 'UPDATE' ? 'بروزرسانی Gist فعلی' : 'ساخت Gist جدید'}...`);
    
    if (options.addLocationFlag) {
        addLog('info', 'در حال تشخیص موقعیت جغرافیایی سرورها (DNS + GeoIP)...');
    }

    try {
      // Process Configs (now async due to GeoIP)
      const processed = await processConfigs(inputConfigs, options);
      const count = inputConfigs.split('\n').filter(l => l.trim()).length;
      const tehranTime = getTehranDate();
      
      addLog('info', 'در حال تولید توضیحات هوشمند توسط Gemini...');
      const desc = await generateSmartDescription(count, tehranTime);
      
      addLog('info', 'در حال ارسال به GitHub...');
      const res = await createOrUpdateGist(githubToken, filename, processed, desc, targetId);
      
      if (res.files[filename]?.raw_url) {
        setResultUrl(res.files[filename].raw_url);
        // If we forced a new one, update the current ID to the new one
        if (!targetId || forceNew) {
            setGistId(res.id);
            // Optionally update import URL to the new one? Maybe not to avoid confusion.
        }
        addLog('success', targetId ? 'اشتراک با موفقیت بروزرسانی شد.' : 'اشتراک جدید با موفقیت ساخته شد.');
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
          <div className="flex items-center gap-4 mb-4 md:mb-0">
            <div className="p-4 bg-gradient-to-br from-primary-600 to-blue-700 rounded-2xl shadow-xl shadow-primary-500/20">
              <Zap className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-500 tracking-tight">
                V2Ray SubManager
              </h1>
              <p className="text-sm text-gray-500 font-medium">Serverless Subscription Generator</p>
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
                      className="flex items-center justify-center gap-2 w-full py-2 bg-yellow-900/20 hover:bg-yellow-900/30 border border-yellow-800/30 rounded text-yellow-500 text-[10px] font-bold transition-colors"
                    >
                      <Search size={12} />
                      FIND CLEAN IP (SCANNER)
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

              <div className="py-1">
                <Toggle label="Global DNS" description="Custom DNS for nodes" checked={options.enableDNS} onChange={(v) => setOptions({...options, enableDNS: v})} />
                {options.enableDNS && (
                  <div className="pb-3 px-2">
                    <input 
                        type="text" 
                        value={options.customDNS} 
                        onChange={(e) => setOptions({...options, customDNS: e.target.value})} 
                        className="w-full bg-gray-950/50 border border-gray-800 rounded px-2 py-1 text-xs text-primary-400 font-mono outline-none focus:border-primary-500/50"
                      />
                  </div>
                )}
              </div>
              
              <Toggle label="Add Location Flags" description="Detect country & add emoji" checked={options.addLocationFlag} onChange={(v) => setOptions({...options, addLocationFlag: v})} />
              <Toggle label="Alias Indexing" description="Add index to names" checked={options.addRandomAlias} onChange={(v) => setOptions({...options, addRandomAlias: v})} />
            </div>
          </div>

          <div className="p-6 bg-blue-900/10 rounded-2xl border border-blue-800/30 text-xs text-blue-300 leading-relaxed">
            <h3 className="font-bold mb-2 flex items-center gap-1"><Settings2 size={14}/> Parameters</h3>
            <p className="opacity-70 flex items-center gap-1 mb-2"><Cloud size={10}/> Custom CDN: Replaces server address with clean IP, moves original address to Host/SNI (WS/GRPC only).</p>
            <p className="opacity-70 flex items-center gap-1 mb-2"><Network size={10}/> Optimize ALPN: Enforces HTTP/2 multiplexing for TLS connections.</p>
            <p className="opacity-70 mb-2">Mux Concurrency: 1-1024</p>
            <p className="opacity-70 flex items-center gap-1"><Globe size={10}/> Location Flags: Adds 🇩🇪, 🇺🇸, etc. to config names based on server IP.</p>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-gray-900/50 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-xl flex flex-col min-h-[480px]">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold flex items-center gap-2 text-gray-100">
                <Terminal className="text-primary-500" size={24} /> Input Source
                </h2>
                {gistId && (
                <div className="flex items-center gap-2 text-[10px] font-bold text-blue-400 bg-blue-900/20 px-3 py-1.5 rounded-full border border-blue-900/50">
                    <GitMerge size={12} />
                    <span>TARGET: {gistId.substring(0, 8)}...</span>
                    <button onClick={() => { setGistId(undefined); setImportUrl(''); setResultUrl(''); }} className="hover:text-white"><Trash2 size={12} /></button>
                </div>
                )}
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
                {gistId ? (
                   <>
                     <button
                        onClick={() => handlePublish(true)}
                        disabled={loading || !githubToken || !inputConfigs.trim()}
                        className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 font-bold py-3 px-6 rounded-2xl transition-all active:scale-95 disabled:opacity-30 text-xs sm:text-sm whitespace-nowrap"
                      >
                         <Plus size={18} />
                         Create New
                      </button>
                      <button
                        onClick={() => handlePublish(false)}
                        disabled={loading || !githubToken || !inputConfigs.trim()}
                        className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-black py-3 px-8 rounded-2xl shadow-xl shadow-green-900/20 transition-all active:scale-95 disabled:opacity-30 text-xs sm:text-sm whitespace-nowrap"
                      >
                        {loading ? <RefreshCw className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                        Update Existing
                      </button>
                   </>
                ) : (
                  <button
                    onClick={() => handlePublish(false)}
                    disabled={loading || !githubToken || !inputConfigs.trim()}
                    className="w-full sm:w-auto flex items-center justify-center gap-3 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white font-black py-4 px-10 rounded-2xl shadow-xl shadow-primary-900/40 transition-all active:scale-95 disabled:opacity-30"
                  >
                    {loading ? <RefreshCw className="animate-spin" size={20} /> : <Zap size={20} />}
                    PUBLISH TO GITHUB
                  </button>
                )}
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
                    <label className="text-[10px] text-green-500 font-black uppercase tracking-widest block mb-2">Permanent Subscription URL</label>
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
