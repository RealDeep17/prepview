import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import useMarketStore from '../../store/useMarketStore.js';
import PortfolioComputeContext from '../../services/portfolio/PortfolioComputeContext.js';
import { Settings, ChevronDown, ChevronUp, AlertCircle, TrendingUp, X, Edit2, Maximize2 } from 'lucide-react';

/**
 * PositionTable.jsx — Teralyn v2.0
 * Institutional grade position table with inline editing, deep row expansion,
 * margin usage visualizations, and advanced sorting capabilities.
 */

// Define explicit column architectures
const COLUMNS = [
    { key: 'expander', label: '', w: 'w-[30px]', noSort: true },
    { key: 'symbol', label: 'Symbol', w: 'w-[100px]' },
    { key: 'side', label: 'Side', w: 'w-[60px]' },
    { key: 'quantity', label: 'Size', w: 'w-[80px]' },
    { key: 'entryPrice', label: 'Entry', w: 'w-[90px]' },
    { key: 'currentPrice', label: 'Mark', w: 'w-[90px]' },
    { key: 'leverage', label: 'Lev', w: 'w-[50px]' },
    { key: 'margin', label: 'Margin (Bars)', w: 'w-[140px]', noSort: true },
    { key: 'unrealizedPnl', label: 'Unrl. PnL', w: 'w-[100px]' },
    { key: 'roe', label: 'ROE%', w: 'w-[80px]' },
    { key: 'liqPrice', label: 'Liq. Price', w: 'w-[90px]' },
    { key: 'stopLoss', label: 'SL', w: 'w-[80px]' },
    { key: 'takeProfit', label: 'TP', w: 'w-[80px]' },
    { key: 'actions', label: '', w: 'w-[120px]', noSort: true }
];

export default function PositionTable({ filter = 'open', onSelectPosition, onScalePosition, onClosePosition }) {
    const { positions, activeAccountId, closePosition, removePosition, updatePosition } = usePortfolioStore();
    const prices = useMarketStore(s => s.prices);
    
    // UI State
    const [sortKey, setSortKey] = useState('unrealizedPnl');
    const [sortDir, setSortDir] = useState(-1);
    const [expandedRow, setExpandedRow] = useState(null);
    const [editingCell, setEditingCell] = useState(null); // { id, field }

    // PortfolioComputeContext default export is already a singleton instance — do NOT use `new`
    const computeEngine = PortfolioComputeContext;

    // Reactive computation layer
    const filteredPositions = useMemo(() => {
        PortfolioComputeContext.updatePrices(prices);
        
        const accountPositions = positions.filter(p => p.accountId === activeAccountId && p.status === filter);
        const maxMargin = Math.max(...accountPositions.map(p => p.margin || 1));
        
        return accountPositions.map(pos => {
            const computed = PortfolioComputeContext.computePositionPnl(pos);
            // Risk normalization for UI bars
            const marginUsagePct = ((pos.margin || 1) / maxMargin) * 100;
            const liqDist = computed.currentPrice > 0 ? Math.abs(computed.currentPrice - computed.liqPrice) / computed.currentPrice : 0;
            const isDanger = liqDist < 0.05; // 5% away from liquidation
            
            return { 
                ...pos, 
                ...computed,
                marginUsagePct,
                isDanger,
                liqDist
            };
        }).sort((a, b) => {
            const aVal = a[sortKey] ?? 0;
            const bVal = b[sortKey] ?? 0;
            return typeof aVal === 'string' ? aVal.localeCompare(bVal) * sortDir : (aVal - bVal) * sortDir;
        });
    }, [positions, activeAccountId, prices, filter, sortKey, sortDir]);

    // Handlers
    const toggleSort = useCallback((key) => {
        if (sortKey === key) setSortDir(d => d * -1);
        else { setSortKey(key); setSortDir(-1); }
    }, [sortKey]);

    const handleInlineSave = (id, field, value) => {
        const numVal = parseFloat(value);
        if (!isNaN(numVal) && numVal > 0) {
            updatePosition(id, { [field]: numVal });
        } else if (value === '' || value === '0') {
            updatePosition(id, { [field]: null });
        }
        setEditingCell(null);
    };

    // Formatters
    const formatPrice = (p, sym) => {
        if (!p) return '—';
        const dec = sym?.includes('SHIB') || sym?.includes('PEPE') ? 6 : p < 1 ? 5 : 2;
        return `$${p.toFixed(dec)}`;
    };

    const formatPnl = (v) => v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`;

    if (filteredPositions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted bg-bg-panel border border-border-default rounded-[3px]">
                <div className="text-4xl mb-4 opacity-30 cursor-default grayscale">🗂</div>
                <div className="text-[14px] font-bold uppercase tracking-wider mb-1">No {filter} Positions</div>
                <div className="text-[11px] text-text-secondary">Execute trades via the order panel or chart to see positions here.</div>
            </div>
        );
    }

    // Totals
    const totalPnl = filteredPositions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
    const totalMargin = filteredPositions.reduce((s, p) => s + (p.margin || 0), 0);
    const totalNotional = filteredPositions.reduce((s, p) => s + (p.notional || 0), 0);

    return (
        <div className="w-full flex flex-col font-sans h-full bg-bg-app border-t border-tv-border overflow-hidden">
            
            {/* Toolbar Header */}
            <div className="flex justify-between items-center px-4 py-2 border-b border-border-default bg-[#161a25] shrink-0">
                <div className="flex gap-4">
                    <SummaryPill label="Positions" value={filteredPositions.length} />
                    <SummaryPill label="Total Margin" value={`$${totalMargin.toFixed(2)}`} />
                    <SummaryPill label="Total Notional" value={`$${totalNotional.toFixed(2)}`} />
                </div>
                <div className={`flex gap-2 items-center px-3 py-1 rounded ${totalPnl >= 0 ? 'bg-tv-green/10 text-tv-green border border-tv-green/20' : 'bg-tv-red/10 text-tv-red border border-tv-red/20'}`}>
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wide">Total Unrl:</span>
                    <span className="text-[13px] font-bold tabular-nums">{formatPnl(totalPnl)}</span>
                </div>
            </div>

            {/* Scrollable Table Area */}
            <div className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar relative min-w-[1000px]">
                <table className="w-full text-[11px] border-collapse relative">
                    <thead className="sticky top-0 z-20 bg-bg-elevated shadow-sm">
                        <tr className="border-b border-bg-hover">
                            {COLUMNS.map(col => (
                                <th 
                                    key={col.key} 
                                    onClick={() => !col.noSort && toggleSort(col.key)}
                                    className={`px-2 py-2 text-left text-text-secondary font-bold uppercase tracking-wider ${col.noSort ? 'cursor-default' : 'cursor-pointer hover:text-white transition-colors'} ${col.w}`}
                                >
                                    <div className="flex items-center gap-1">
                                        {col.label}
                                        {!col.noSort && sortKey === col.key && (
                                            <span className="text-tv-blue text-[10px]">{sortDir > 0 ? '▲' : '▼'}</span>
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-bg-app divide-y divide-[#2a2e39]/50">
                        {filteredPositions.map(pos => {
                            const isUp = (pos.unrealizedPnl || 0) >= 0;
                            const isExpanded = expandedRow === pos.id;
                            
                            return (
                                <React.Fragment key={pos.id}>
                                    <tr 
                                        className={`hover:bg-bg-elevated transition-colors group cursor-default ${isExpanded ? 'bg-[#1a1e28]' : ''}`}
                                        onClick={(e) => {
                                            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
                                                onSelectPosition?.(pos); // For chart syncing
                                            }
                                        }}
                                    >
                                        <td className="px-2 py-2 text-center" onClick={() => setExpandedRow(isExpanded ? null : pos.id)}>
                                            <button className="text-text-muted hover:text-white p-1 rounded hover:bg-white/5 transition-colors">
                                                {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                                            </button>
                                        </td>
                                        
                                        <td className="px-2 py-2 font-bold text-gray-200">
                                            <div className="flex items-center gap-1.5">
                                                {pos.isDanger && <AlertCircle size={12} className="text-tv-red animate-pulse"/>}
                                                {pos.symbol?.replace('USDT', '')}
                                            </div>
                                        </td>
                                        
                                        <td className="px-2 py-2">
                                            <span className={`px-1.5 py-0.5 rounded-[2px] text-[9px] font-bold ${pos.side === 'LONG' ? 'bg-tv-green/15 text-tv-green' : 'bg-tv-red/15 text-tv-red'}`}>
                                                {pos.side}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2 font-mono text-gray-300">{pos.quantity}</td>
                                        <td className="px-2 py-2 font-mono text-text-secondary">{formatPrice(pos.entryPrice, pos.symbol)}</td>
                                        <td className="px-2 py-2 font-mono text-gray-100 font-bold">{formatPrice(pos.currentPrice, pos.symbol)}</td>
                                        <td className="px-2 py-2 font-mono">
                                            <span className="bg-amber-400/10 text-amber-500 border border-amber-400/20 px-1 py-0.5 rounded-[2px]">{pos.leverage}x</span>
                                        </td>
                                        
                                        <td className="px-2 py-2">
                                            <div className="flex items-center gap-2 pr-4">
                                                <div className="flex-1 h-[4px] bg-bg-input rounded-full overflow-hidden">
                                                    <div className="h-full bg-tv-blue rounded-full" style={{ width: `${Math.max(2, pos.marginUsagePct)}%` }}/>
                                                </div>
                                                <span className="font-mono text-[9px] text-text-muted w-10 text-right">${pos.margin?.toFixed(0)}</span>
                                            </div>
                                        </td>
                                        
                                        <td className={`px-2 py-2 font-mono font-bold ${isUp ? 'text-tv-green' : 'text-tv-red'}`}>{formatPnl(pos.unrealizedPnl)}</td>
                                        <td className={`px-2 py-2 font-mono font-bold ${isUp ? 'text-tv-green' : 'text-tv-red'}`}>{pos.roe?.toFixed(2)}%</td>
                                        
                                        <td className={`px-2 py-2 font-mono ${pos.isDanger ? 'text-tv-red font-bold animate-pulse' : 'text-orange-400'}`}>
                                            {formatPrice(pos.liqPrice, pos.symbol)}
                                        </td>
                                        
                                        {/* Inline Editable cell for SL/TP */}
                                        <EditableCell 
                                            value={pos.stopLoss} 
                                            symbol={pos.symbol} 
                                            isEditing={editingCell?.id === pos.id && editingCell?.field === 'stopLoss'}
                                            onEdit={() => setEditingCell({ id: pos.id, field: 'stopLoss' })}
                                            onSave={(val) => handleInlineSave(pos.id, 'stopLoss', val)}
                                        />
                                        <EditableCell 
                                            value={pos.takeProfit} 
                                            symbol={pos.symbol} 
                                            isEditing={editingCell?.id === pos.id && editingCell?.field === 'takeProfit'}
                                            onEdit={() => setEditingCell({ id: pos.id, field: 'takeProfit' })}
                                            onSave={(val) => handleInlineSave(pos.id, 'takeProfit', val)}
                                        />

                                        <td className="px-2 py-2 text-right">
                                            <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity pr-2">
                                                {filter === 'open' && (
                                                    <>
                                                        <ActionBtn label="Scale" onClick={() => onScalePosition?.(pos)} color="text-tv-blue border-tv-blue/30" icon={Maximize2} />
                                                        <ActionBtn label="Close" onClick={() => onClosePosition?.(pos)} color="text-amber-500 border-amber-500/30" />
                                                    </>
                                                )}
                                                <ActionBtn label="" onClick={(e) => { e.stopPropagation(); removePosition(pos.id); }} color="text-tv-red border-tv-red/30 hover:bg-tv-red hover:text-white" icon={X} />
                                            </div>
                                        </td>
                                    </tr>

                                    {/* Expanded Detail sub-row */}
                                    {isExpanded && (
                                        <tr className="bg-bg-panel border-b border-bg-hover">
                                            <td colSpan={COLUMNS.length} className="p-0">
                                                <div className="py-4 px-12 animate-in slide-in-from-top-2 duration-200">
                                                    <div className="grid grid-cols-4 gap-6 text-[11px] text-text-secondary border border-bg-hover bg-[#161a25] p-4 rounded-[4px] shadow-inner">
                                                        <div>
                                                            <div className="text-[10px] uppercase font-bold text-text-muted mb-2 tracking-wider">Position Specs</div>
                                                            <div className="flex flex-col gap-1.5">
                                                                <div className="flex justify-between"><span>Opened:</span> <span className="text-gray-300 font-mono">{new Date(pos.timestamp).toLocaleString()}</span></div>
                                                                <div className="flex justify-between"><span>Notional Value:</span> <span className="text-gray-300 font-mono">${(pos.notional || 0).toFixed(2)}</span></div>
                                                                <div className="flex justify-between"><span>Fee Paid:</span> <span className="text-gray-300 font-mono">${(pos.fee || 0).toFixed(4)}</span></div>
                                                                <div className="flex justify-between"><span>Mark Price:</span> <span className="text-gray-300 font-mono">{formatPrice(pos.currentPrice)}</span></div>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] uppercase font-bold text-text-muted mb-2 tracking-wider">Risk Profile</div>
                                                            <div className="flex flex-col gap-1.5">
                                                                <div className="flex justify-between"><span>Liq Distance:</span> <span className={`font-mono ${pos.isDanger ? 'text-tv-red' : 'text-gray-300'}`}>{(pos.liqDist*100).toFixed(1)}%</span></div>
                                                                <div className="flex justify-between"><span>Max Loss (SL):</span> <span className="text-gray-300 font-mono">{pos.stopLoss ? formatPnl(pos.quantity * (pos.side === 'LONG' ? pos.stopLoss - pos.entryPrice : pos.entryPrice - pos.stopLoss)) : 'Unprotected'}</span></div>
                                                                <div className="flex justify-between"><span>Max Win (TP):</span> <span className="text-gray-300 font-mono">{pos.takeProfit ? formatPnl(pos.quantity * (pos.side === 'LONG' ? pos.takeProfit - pos.entryPrice : pos.entryPrice - pos.takeProfit)) : 'Unbounded'}</span></div>
                                                                <div className="flex justify-between"><span>Leverage:</span> <span className="text-amber-400 font-mono">{pos.leverage}x Isolated</span></div>
                                                            </div>
                                                        </div>
                                                        <div className="col-span-2">
                                                            <div className="text-[10px] uppercase font-bold text-text-muted mb-2 tracking-wider">Notes & Tags</div>
                                                            <textarea 
                                                                className="w-full h-[70px] bg-bg-input border border-border-default rounded-[3px] p-2 text-text-primary resize-none placeholder-gray-600 focus:border-tv-blue outline-none transition-colors"
                                                                placeholder="Add trade thesis or execution notes..."
                                                                defaultValue={pos.notes || ''}
                                                                onBlur={(e) => updatePosition(pos.id, { notes: e.target.value })}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// Subcomponents

const SummaryPill = ({ label, value }) => (
    <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-text-muted uppercase font-bold tracking-wider">{label}:</span>
        <span className="text-text-primary font-mono bg-bg-input px-1.5 py-0.5 rounded">{value}</span>
    </div>
);

const ActionBtn = ({ label, onClick, color, icon: Icon }) => (
    <button 
        onClick={(e) => { e.stopPropagation(); onClick(e); }} 
        className={`flex items-center justify-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-bold border bg-transparent hover:bg-white/5 transition-colors ${color}`}
    >
        {Icon && <Icon size={10} />}
        {label && <span>{label}</span>}
    </button>
);

const EditableCell = ({ value, symbol, isEditing, onEdit, onSave }) => {
    const inputRef = useRef(null);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            onSave(e.target.value);
        } else if (e.key === 'Escape') {
            onSave(value ? value.toString() : '');
        }
    };

    if (isEditing) {
        return (
            <td className="px-2 py-1">
                <input
                    ref={inputRef}
                    type="number"
                    step="0.0001"
                    className="w-[70px] bg-bg-hover text-white border border-tv-blue rounded-[2px] px-1 py-0.5 text-[11px] font-mono outline-none"
                    defaultValue={value || ''}
                    onBlur={(e) => onSave(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onClick={e => e.stopPropagation()}
                />
            </td>
        );
    }

    return (
        <td 
            className="px-2 py-2 font-mono text-text-secondary hover:text-white cursor-text group/cell relative"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
            <div className="flex justify-between items-center group-hover/cell:bg-white/5 px-1 -ml-1 rounded transition-colors">
                <span>{value > 0 ? `${value.toFixed(2)}` : '—'}</span>
                <Edit2 size={10} className="opacity-0 group-hover/cell:opacity-100 text-tv-blue" />
            </div>
        </td>
    );
};
