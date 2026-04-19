import { useState, useRef, useCallback } from 'react';
import { UploadCloud, CheckCircle2, XCircle, RotateCcw, ExternalLink, Github, Loader2 } from 'lucide-react';

type AppState = 'ready' | 'processing' | 'success' | 'error';

interface LogLine {
  status: 'ok' | 'pending' | 'error';
  text: string;
}

interface SuccessData {
  repoUrl: string;
  repoName: string;
  filesCount: number;
}

interface ErrorData {
  failedAt: string;
  error: string;
}

function LogIcon({ status }: { status: LogLine['status'] }) {
  if (status === 'ok') return <span className="text-emerald-400 font-mono">[✓]</span>;
  if (status === 'pending') return <span className="text-cyan-400 font-mono animate-pulse">[→]</span>;
  return <span className="text-red-400 font-mono">[✗]</span>;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('ready');
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);
  const [errorData, setErrorData] = useState<ErrorData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((text: string, status: LogLine['status'] = 'ok') => {
    setLogLines(prev => [...prev, { text, status }]);
  }, []);

  const updateLastLog = useCallback((text: string, status: LogLine['status']) => {
    setLogLines(prev => {
      const updated = [...prev];
      if (updated.length > 0) updated[updated.length - 1] = { text, status };
      return updated;
    });
  }, []);

  const handleFileSelect = (selectedFile: File | null) => {
    if (!selectedFile) return;
    if (!selectedFile.name.endsWith('.zip')) {
      alert('Please select a .zip file.');
      return;
    }
    setFile(selectedFile);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files[0] ?? null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const repoNameFromFile = file ? file.name.replace(/\.zip$/i, '') : '';

  const handlePush = async () => {
    if (!file) return;
    setAppState('processing');
    setLogLines([]);

    const repoName = repoNameFromFile;

    addLog(`ZIP received: ${file.name}`);
    addLog(`Repo name detected: ${repoName}`);

    let zipBase64: string;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const CHUNK = 8192;
      let binary = '';
      for (let i = 0; i < uint8Array.length; i += CHUNK) {
        binary += String.fromCharCode(...uint8Array.subarray(i, i + CHUNK));
      }
      zipBase64 = btoa(binary);
    } catch {
      addLog('Failed to read ZIP file', 'error');
      setErrorData({ failedAt: 'Reading ZIP', error: 'Could not read the file from disk.' });
      setAppState('error');
      return;
    }

    addLog(`Creating GitHub repo: newM1k3/${repoName}...`, 'pending');

    let result: {
      success: boolean;
      repoUrl?: string;
      repoName?: string;
      filesCount?: number;
      failedAt?: string;
      error?: string;
    };

    try {
      const response = await fetch('/.netlify/functions/push-to-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoName, description: description.trim(), zipBase64 }),
      });
      result = await response.json();
    } catch (err) {
      updateLastLog('Network error — could not reach function', 'error');
      setErrorData({
        failedAt: 'Calling Netlify function',
        error: err instanceof Error ? err.message : 'Network request failed',
      });
      setAppState('error');
      return;
    }

    if (!result.success) {
      updateLastLog(`Failed at: ${result.failedAt ?? 'Unknown step'}`, 'error');
      setErrorData({
        failedAt: result.failedAt ?? 'Unknown step',
        error: result.error ?? 'An unknown error occurred.',
      });
      setAppState('error');
      return;
    }

    updateLastLog(`GitHub repo created (private): ${repoName}`, 'ok');
    await delay(200);
    addLog(`Pushing ${result.filesCount} files to main branch...`, 'pending');
    await delay(300);
    updateLastLog(`Code pushed successfully — ${result.filesCount} files`, 'ok');
    await delay(200);
    addLog('Logging to PocketBase registry...', 'pending');
    await delay(300);
    updateLastLog('Registry updated', 'ok');

    setSuccessData({ repoUrl: result.repoUrl!, repoName: result.repoName!, filesCount: result.filesCount! });
    setAppState('success');
  };

  const handleReset = () => {
    setAppState('ready');
    setFile(null);
    setDescription('');
    setLogLines([]);
    setSuccessData(null);
    setErrorData(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[640px]">
        <div className="flex items-center gap-3 mb-8">
          <Github className="w-6 h-6 text-cyan-400" />
          <div>
            <h1 className="text-white font-semibold text-lg leading-tight">Bolt → GitHub Bridge</h1>
            <p className="text-slate-500 text-xs font-mono">MJW Platform · Internal Tool</p>
          </div>
        </div>

        {appState === 'ready' && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-5">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-cyan-400 bg-cyan-400/5'
                  : file
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/30'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={e => handleFileSelect(e.target.files?.[0] ?? null)}
              />
              <UploadCloud className={`w-10 h-10 mx-auto mb-3 ${file ? 'text-emerald-400' : 'text-slate-500'}`} />
              {file ? (
                <>
                  <p className="text-emerald-400 font-mono text-sm font-semibold">{file.name}</p>
                  <p className="text-slate-500 text-xs mt-1">
                    Repo name: <span className="text-cyan-400 font-mono">{repoNameFromFile}</span>
                  </p>
                  <p className="text-slate-600 text-xs mt-1">Click or drop to replace</p>
                </>
              ) : (
                <>
                  <p className="text-slate-300 text-sm font-medium">Drop your renamed Bolt ZIP here</p>
                  <p className="text-slate-500 text-xs mt-1">
                    File name becomes the repo name — e.g.{' '}
                    <span className="font-mono text-slate-400">mjw-my-app.zip</span>
                  </p>
                  <p className="text-slate-600 text-xs mt-3">or click to browse</p>
                </>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Repo Description <span className="text-slate-600">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What does this app do?"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
            </div>

            <button
              onClick={handlePush}
              disabled={!file}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-cyan-500 hover:bg-cyan-400 text-slate-950"
            >
              <Github className="w-4 h-4" />
              Push to GitHub
            </button>
          </div>
        )}

        {appState === 'processing' && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              <span className="text-slate-300 text-sm font-medium">Pushing to GitHub…</span>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs space-y-1.5 min-h-[160px]">
              {logLines.length === 0 ? (
                <span className="text-slate-700">Initialising…</span>
              ) : (
                logLines.map((line, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <LogIcon status={line.status} />
                    <span className={
                      line.status === 'ok' ? 'text-slate-300' :
                      line.status === 'pending' ? 'text-cyan-300' : 'text-red-400'
                    }>
                      {line.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {appState === 'success' && successData && (
          <div className="bg-slate-800 border border-emerald-500/40 rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-emerald-400 font-semibold text-sm">Push complete</p>
                <p className="text-slate-500 text-xs">{successData.filesCount} files committed to main</p>
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-3">
              <p className="text-slate-400 text-xs mb-1">Repository</p>
              <p className="text-white font-mono text-sm font-semibold">{successData.repoName}</p>
            </div>
            <a
              href={successData.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View on GitHub
            </a>
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Push Another
            </button>
          </div>
        )}

        {appState === 'error' && errorData && (
          <div className="bg-slate-800 border border-red-500/40 rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <XCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-400 font-semibold text-sm">Push failed</p>
                <p className="text-slate-500 text-xs">Failed at: {errorData.failedAt}</p>
              </div>
            </div>
            <div className="bg-red-950/30 border border-red-900/50 rounded-lg px-4 py-3">
              <p className="text-red-300 text-sm font-mono">{errorData.error}</p>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
