import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import { Layers, Activity, Settings, UploadCloud, Trash2, ArrowLeft } from 'lucide-react';
import { navigateTo } from '../../utils/appNavigation.js';
import AppRouteNav from '../layout/AppRouteNav.jsx';

/**
 * PortfolioPage.jsx — Teralyn v2.0
 * 
 * High-end standalone Portfolio Management Page featuring:
 *   • Smooth glassmorphic transitions via framer-motion
 *   • Dedicated CSV Import zone
 *   • Account management / deletion
 *   • 2026 App-like Aesthetics
 */

export default function PortfolioPage() {
    const { accounts, activeAccountId, setActiveAccount, removeAccount, importCsvPositions } = usePortfolioStore();
    const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'accounts' | 'import'

    const tabs = [
        { id: 'overview', label: 'Performance Overview', icon: Activity, desc: 'Account state and open exposure' },
        { id: 'accounts', label: 'Manage Accounts', icon: Settings, desc: 'Execution contexts and balances' },
        { id: 'import', label: 'CSV Data Import', icon: UploadCloud, desc: 'Bring external fills into the journal' }
    ];

    return (
        <motion.div 
            className="flex h-screen w-screen flex-col overflow-hidden bg-bg-main text-gray-200"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        >
            <AppRouteNav
                activeApp="portfolio"
                title="Portfolio"
                actions={
                    <button
                        onClick={() => navigateTo('/app/terminal')}
                        className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-300 hover:bg-white/[0.06]"
                    >
                        Back to Terminal
                    </button>
                }
            />

            <div className="flex min-h-0 flex-1 gap-2.5 p-2.5">
                <aside className="hidden w-[200px] shrink-0 lg:flex lg:flex-col border-r border-white/6 pr-3">
                    <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Portfolio</div>
                        <div className="mt-1 text-[13px] font-semibold tracking-tight text-white">Capital Workspace</div>
                    </div>

                    <nav className="mt-3 flex flex-1 flex-col gap-1.5">
                        {tabs.map(tab => (
                            <NavBtn key={tab.id} id={tab.id} label={tab.label} icon={tab.icon} desc={tab.desc} activeTab={activeTab} setTab={setActiveTab} />
                        ))}
                    </nav>

                    <div className="mt-3 border-t border-white/6 pt-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Route</div>
                        <div className="mt-1 text-[11px] font-semibold text-white">Use terminal to trade.</div>
                        <button
                            onClick={() => navigateTo('/app/terminal')}
                            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-white/8 bg-black/20 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-300 hover:bg-white/[0.05]"
                        >
                            <ArrowLeft size={14} />
                            Terminal
                        </button>
                    </div>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
                    <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3 lg:hidden">
                        {tabs.map(tab => (
                            <NavBtn key={tab.id} id={tab.id} label={tab.label} icon={tab.icon} desc={tab.desc} activeTab={activeTab} setTab={setActiveTab} compact />
                        ))}
                    </div>

                    <div className="chrome-panel-soft min-h-0 rounded-[18px] p-4">
                        <AnimatePresence mode="wait">
                            {activeTab === 'overview' && <OverviewTab key="overview" />}
                            {activeTab === 'accounts' && <AccountsTab key="accounts" />}
                            {activeTab === 'import' && <ImportTab key="import" />}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

// -------------------------------------------------------------
// Sidebar Button
// -------------------------------------------------------------
function NavBtn({ id, label, icon: Icon, desc, activeTab, setTab, compact = false }) {
    const isActive = activeTab === id;
    return (
        <button
            onClick={() => setTab(id)}
            className={`w-full relative flex items-center gap-2 rounded-md border px-2.5 py-2 text-[11px] font-medium transition-colors duration-300 ${
                isActive
                    ? 'border-blue-400/25 bg-blue-500/10 text-white'
                    : 'border-white/8 bg-black/20 text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
            }`}
        >
            <Icon size={16} className={`${isActive ? 'text-blue-300' : 'text-gray-500'}`} />
            <span className="min-w-0 text-left">
                <span className="block tracking-wide">{label}</span>
                {!compact && desc && (
                    <span className="mt-0.5 block text-[10px] font-normal leading-relaxed text-gray-500">{desc}</span>
                )}
            </span>
        </button>
    );
}

// -------------------------------------------------------------
// Sub-views
// -------------------------------------------------------------

function OverviewTab() {
    const { accounts, activeAccountId, positions } = usePortfolioStore();
    
    // Calculate metrics for the active account
    const activeAccount = (accounts || []).find(a => a.id === activeAccountId) || (accounts || [])[0];
    const balance = activeAccount ? activeAccount.balance : 0;
    
    // Open positions
    const activePositions = (positions || []).filter(p => p.accountId === activeAccountId && p.status === 'open');
    const openCount = activePositions.length;
    
    // Win Rate (from closed positions)
    const closedPositions = (positions || []).filter(p => p.accountId === activeAccountId && p.status === 'closed');
    const winningTrades = closedPositions.filter(p => p.realizedPnl > 0).length;
    const winRate = closedPositions.length > 0 ? (winningTrades / closedPositions.length) * 100 : 0;

    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="flex flex-col gap-3"
        >
            <h2 className="text-[16px] font-semibold tracking-tight">Performance Overview</h2>
            <div className="grid grid-cols-3 gap-3">
                 {/* Total Equity */}
                 <div className="border border-white/10 rounded-[14px] px-3 py-3">
                     <span className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.12em] mb-1 block">Account Balance</span>
                     <span className="text-[20px] font-light font-mono text-white tracking-tight">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                 </div>
                 {/* Open Positions */}
                 <div className="border border-white/10 rounded-[14px] px-3 py-3">
                     <span className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.12em] mb-1 block">Open Positions</span>
                     <span className="text-[20px] font-light font-mono text-white tracking-tight">{openCount}</span>
                 </div>
                 {/* Win Rate */}
                 <div className="border border-white/10 rounded-[14px] px-3 py-3">
                     <span className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.12em] mb-1 block">Est. Win Rate</span>
                     <span className="text-[20px] font-light font-mono text-emerald-400 tracking-tight">{winRate.toFixed(1)}%</span>
                 </div>
            </div>
            
            {/* Active Positions Mini-List */}
            <div className="mt-1 border border-white/5 bg-white/[0.02] rounded-[14px] p-3">
                <h3 className="text-[12px] font-semibold text-gray-400 mb-2">Current Active Positions</h3>
                {openCount === 0 ? (
                    <div className="text-[11px] text-gray-600 font-mono py-4 text-center border border-dashed border-white/5 rounded-lg">No open positions in this account.</div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {activePositions.map(pos => (
                            <div key={pos.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl text-[13px] font-mono">
                                <span className="flex items-center gap-3">
                                    <span className={`w-2 h-2 rounded-full ${pos.side === 'LONG' ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                                    <span className="font-bold">{pos.symbol}</span>
                                    <span className="text-gray-500">{pos.quantity} @ {pos.entryPrice}</span>
                                </span>
                                <span className={pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>{pos.side} {pos.leverage}x</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function AccountsTab() {
    const { accounts, activeAccountId, setActiveAccount, removeAccount, addAccount } = usePortfolioStore();
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const handleDelete = (id, e) => {
        e.stopPropagation();
        if (confirmDeleteId === id) {
            removeAccount(id);
            if (activeAccountId === id && (accounts || []).length > 1) {
                const nextId = (accounts || []).find(a => a.id !== id)?.id;
                if (nextId) setActiveAccount(nextId);
            }
            setConfirmDeleteId(null);
        } else {
            setConfirmDeleteId(id);
            setTimeout(() => setConfirmDeleteId(null), 3000); // Reset confirm state after 3s
        }
    };

    const handleAddAccount = () => {
        const name = window.prompt("Enter new account name (e.g. Prop Firm 1):", "New Account");
        if (!name) return;
        const balanceStr = window.prompt("Enter initial capital:", "10000");
        const balance = parseFloat(balanceStr) || 10000;
        addAccount({ name, balance, exchange: 'binance_futures' });
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="flex flex-col h-full max-w-4xl"
        >
            <div className="flex justify-between items-end mb-3">
                <div>
                    <h2 className="text-[16px] font-semibold tracking-tight text-white/90">Account Management</h2>
                    <p className="text-[11px] text-gray-500 mt-1">Select your active execution context or remove unused environments.</p>
                </div>
                <button 
                    onClick={handleAddAccount}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded-md shadow-lg shadow-blue-500/20 transition-colors"
                >
                    + New Account
                </button>
            </div>
            
            <div className="flex flex-col gap-1.5">
                <AnimatePresence>
                    {(accounts || []).map(acc => (
                        <motion.div 
                            key={acc.id}
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95, x: -20 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            onClick={() => setActiveAccount(acc.id)}
                            className={`group relative flex items-center justify-between px-3 py-2 rounded-[4px] border transition-all cursor-pointer ${
                                activeAccountId === acc.id 
                                    ? 'bg-blue-500/10 border-blue-500/30' 
                                    : 'bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-7 h-7 rounded-[4px] flex items-center justify-center font-bold text-[11px] transition-colors ${
                                    activeAccountId === acc.id ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-gray-400 group-hover:text-white'
                                }`}>
                                    {acc.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                    <span className={`text-[12px] font-medium tracking-wide transition-colors ${activeAccountId === acc.id ? 'text-blue-100' : 'text-gray-200'}`}>
                                        {acc.name}
                                    </span>
                                    <span className="text-[10px] text-gray-500">
                                        Initial Capital: ${acc.balance?.toLocaleString()}
                                    </span>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-3">
                                {activeAccountId === acc.id && (
                                    <span className="px-1.5 py-0.5 text-[8px] uppercase font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-sm">
                                        Active
                                    </span>
                                )}

                                <button 
                                    onClick={(e) => handleDelete(acc.id, e)}
                                    className={`w-7 h-7 flex items-center justify-center rounded-[4px] transition-all ${
                                        confirmDeleteId === acc.id 
                                            ? 'bg-red-500 text-white hover:bg-red-600 scale-110 shadow-lg shadow-red-500/20' 
                                            : 'text-gray-500 hover:bg-red-500/10 hover:text-red-400'
                                    }`}
                                    title={confirmDeleteId === acc.id ? "Click again to confirm" : "Remove Account"}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}

function ImportTab() {
    const { importCsvPositions } = usePortfolioStore();
    const [isDraggingCsv, setIsDraggingCsv] = useState(false);
    const [isDraggingImg, setIsDraggingImg] = useState(false);
    const [importStatus, setImportStatus] = useState(null); // { type: 'success'|'error', msg: string }
    const [isAiProcessing, setIsAiProcessing] = useState(false);

    const processFile = (file) => {
        if (!file || !file.name.endsWith('.csv')) {
            setImportStatus({ type: 'error', msg: 'Please drop a valid .csv file' });
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            try {
                // Better CSV Parser (respects quotes)
                const parseCSVLine = (lineText) => {
                    const row = [];
                    let inQuotes = false;
                    let currentValue = '';
                    for (let i = 0; i < lineText.length; i++) {
                        const char = lineText[i];
                        if (char === '"' && lineText[i+1] === '"') {
                            currentValue += '"'; i++;
                        } else if (char === '"') {
                            inQuotes = !inQuotes;
                        } else if (char === ',' && !inQuotes) {
                            row.push(currentValue.trim());
                            currentValue = '';
                        } else {
                            currentValue += char;
                        }
                    }
                    row.push(currentValue.trim());
                    return row;
                };

                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length < 2) throw new Error('File is empty or missing data rows');
                
                const headers = parseCSVLine(lines[0]);
                const parsedRows = [];

                for (let i = 1; i < lines.length; i++) {
                    const cols = parseCSVLine(lines[i]);
                    const rowObj = {};
                    headers.forEach((h, idx) => { rowObj[h] = cols[idx] || ''; });
                    parsedRows.push(rowObj);
                }

                importCsvPositions(parsedRows);
                setImportStatus({ type: 'success', msg: `Successfully imported ${parsedRows.length} positions.` });
                setTimeout(() => setImportStatus(null), 4000);
            } catch (err) {
                setImportStatus({ type: 'error', msg: 'Failed to parse CSV format. Ensure it has headers like Symbol, Side, Entry Price, Quantity.' });
            }
        };
        reader.readAsText(file);
    };

    const processImage = async (file) => {
        if (!file || !file.type.startsWith('image/')) {
            setImportStatus({ type: 'error', msg: 'Please drop a valid image file (PNG/JPG/WEBP)' });
            return;
        }

        setIsAiProcessing(true);
        setImportStatus({ type: 'success', msg: 'AI Vision extracting positions... please wait.' });

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                // Extract base64 without data type prefix
                const base64String = e.target.result.split(',')[1];
                let mimeType = file.type;
                if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

                const response = await fetch('/api/ai/positions/extract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        imageBase64: base64String,
                        mimeType
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error("AI extraction endpoint error response:", errorText);
                    throw new Error(`API Error: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                const parsedRows = data.positions;

                if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
                    throw new Error('No positions found in the image');
                }

                importCsvPositions(parsedRows);
                setImportStatus({ type: 'success', msg: `AI successfully imported ${parsedRows.length} positions.` });
                setTimeout(() => setImportStatus(null), 4000);

            } catch (err) {
                console.error("Vision AI Error:", err);
                const isApiError = err.message.includes('API Error');
                setImportStatus({ 
                    type: 'error', 
                    msg: isApiError ? err.message : 'AI failed to parse image. Please ensure positions are clearly visible.' 
                });
                setTimeout(() => setImportStatus(null), 5000);
            } finally {
                setIsAiProcessing(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleCsvDrop = (e) => {
        e.preventDefault();
        setIsDraggingCsv(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFile(e.dataTransfer.files[0]);
        }
    };

    const handleImgDrop = (e) => {
        e.preventDefault();
        setIsDraggingImg(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processImage(e.dataTransfer.files[0]);
        }
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="flex flex-col h-full max-w-5xl"
        >
            <div className="flex justify-between items-end mb-4">
                <div>
                    <h2 className="text-[16px] font-semibold tracking-tight text-white/90">Data Import</h2>
                    <p className="text-[11px] text-gray-500 mt-1">Upload external portfolio histories via CSV or AI image sync.</p>
                </div>
                <div className="text-[10px] text-gray-500 font-mono bg-white/5 border border-white/10 px-2.5 py-1 rounded-md flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Ready for Data
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 w-full relative">
                
                {/* Status Toast Overlay */}
                <AnimatePresence>
                    {importStatus && (
                        <motion.div
                            initial={{ opacity: 0, y: -20, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: -20, x: '-50%' }}
                            className={`absolute top-[-52px] left-1/2 z-50 px-4 py-2 rounded-md border text-[11px] font-medium shadow-2xl flex items-center gap-2 ${
                                importStatus.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-red-500/20 text-red-300 border-red-500/30'
                            }`}
                        >
                            {importStatus.type === 'success' ? <Activity size={18} /> : <Target size={18} />}
                            {importStatus.msg}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* CSV Sync Dropzone */}
                <div 
                    className={`relative h-64 border border-dashed rounded-[6px] flex items-center justify-center flex-col transition-all duration-300 ${
                        isDraggingCsv ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-white/10 bg-white/[0.02] hover:bg-white/5 hover:border-white/20'
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingCsv(true); }}
                    onDragLeave={() => setIsDraggingCsv(false)}
                    onDrop={handleCsvDrop}
                >
                    <div className={`p-2.5 rounded-full mb-2.5 transition-colors ${isDraggingCsv ? 'bg-blue-500 text-white shadow-xl shadow-blue-500/30' : 'bg-white/5 text-gray-400'}`}>
                        <UploadCloud size={20} />
                    </div>
                    <p className="text-[13px] font-medium text-gray-200 mb-1">Standard CSV Sync</p>
                    <p className="text-[10px] text-gray-500 mb-5 font-mono max-w-[160px] text-center">Schema detection for standard table formats</p>
                    
                    <label className="cursor-pointer px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-[11px] font-bold rounded-md transition-colors shadow-sm">
                        Browse CSV
                        <input type="file" className="hidden" accept=".csv" onChange={(e) => { if(e.target.files?.length) processFile(e.target.files[0]) }} />
                    </label>
                </div>

                {/* AI Image Sync Dropzone */}
                <div 
                    className={`relative h-64 border border-dashed rounded-[6px] flex items-center justify-center flex-col transition-all duration-300 ${
                        isDraggingImg ? 'border-purple-500 bg-purple-500/10 scale-[1.02]' : 'border-white/10 bg-white/[0.02] hover:bg-white/5 hover:border-white/20'
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingImg(true); }}
                    onDragLeave={() => setIsDraggingImg(false)}
                    onDrop={handleImgDrop}
                >
                    {isAiProcessing && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-10 rounded-[6px] flex flex-col items-center justify-center">
                            <Sparkles size={24} className="text-purple-400 animate-pulse mb-3" />
                            <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                                <motion.div 
                                    className="h-full bg-purple-500 rounded-full"
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 4, ease: "linear" }}
                                />
                            </div>
                        </div>
                    )}

                    <div className={`p-2.5 rounded-full mb-2.5 transition-colors ${isDraggingImg ? 'bg-purple-500 text-white shadow-xl shadow-purple-500/30' : 'bg-white/5 text-gray-400'}`}>
                        <ImageIcon size={20} />
                    </div>
                    <p className="text-[13px] font-medium text-purple-200 mb-1 flex items-center gap-2">Gemini AI Vision <Sparkles size={12}/></p>
                    <p className="text-[10px] text-gray-500 mb-5 font-mono max-w-[160px] text-center">Screenshot your exchange and drop image here</p>
                    
                    <label className="cursor-pointer px-4 py-2 bg-purple-500 hover:bg-purple-400 text-white text-[11px] font-bold rounded-md shadow-lg shadow-purple-500/20 transition-all">
                        Upload Image
                        <input type="file" className="hidden" accept="image/*" onChange={(e) => { if(e.target.files?.length) processImage(e.target.files[0]) }} />
                    </label>
                </div>

            </div>
        </motion.div>
    );
}
