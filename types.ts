export interface GistFile {
  filename: string;
  content: string;
  raw_url?: string;
}

export interface GistResponse {
  id: string;
  html_url: string;
  files: Record<string, GistFile>;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessingOptions {
  enableMux: boolean;
  muxConcurrency: number;
  enableFragment: boolean;
  fragmentLength: string;
  fragmentInterval: string;
  allowInsecure: boolean;
  enableALPN: boolean;
  addRandomAlias: boolean;
  addLocationFlag: boolean;
  enableCDNIP: boolean;
  customCDN: string;
  customBaseName: string;
  outputFormat: 'base64' | 'json'; // New field
}

export interface LogEntry {
  type: 'info' | 'success' | 'error';
  message: string;
  timestamp: Date;
}

export interface PingResult {
  id: string;
  alias: string;
  host: string;
  protocol: string;
  latency: number | 'timeout' | 'error';
  lastTested: Date;
}
