import React, { useState, useCallback } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import AccountCard from './AccountCard.jsx';
import PortfolioDashboard from './PortfolioDashboard.jsx';
import PositionTable from './PositionTable.jsx';
import AddPositionModal from './AddPositionModal.jsx';
import ScalePositionModal from './ScalePositionModal.jsx';
import { LayoutDashboard, Target, History, WalletCards, Plus, Search, Filter, RefreshCw, X } from 'lucide-react';

/**
 * PortfolioPanel.jsx — Teralyn v2.0
 * The core macro router and master layout wrapper for the entirely modernized portfolio subsystem.
 * Handles sub-navigation, integrated global searches across positions, and contextual sidebars.
 */

const TABS = [
    { id: 'dashboard', label: 'Command Center', icon: LayoutDashboard },
    { id: 'positions', label: 'Active Exposure', icon: Target },
    { id: 'history', label: 'Execution Log', icon: History },
    { id: 'accounts', label: 'Capital Depots', icon: WalletCards },
];

export default function PortfolioPanel() {
    // Global Store Bindings
    const { 
        accounts, 
        activeAccountId, 
        setActiveAccount, 
        addAccount, 
        portfolioTab, 
        setPortfolioTab,
        positions 
    } = usePortfolioStore();

    // Modals
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [scaleModal, setScaleModal] = useState({ open: false, position: null });
    
    // UI Local State
    const [showAddAccount, setShowAddAccount] = useState(false);
    const [newAccountForm, setNewAccountForm] = useState({ name: '', exchange: 'binance_futures', balance: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Contextual derivations
    const totalPosCount = positions.filter(p => p.status === 'open').length;

    const handleAddAccount = useCallback(() => {
        if (!newAccountForm.name || !newAccountForm.balance) return;
        addAccount({ 
            name: newAccountForm.name, 
            exchange: newAccountForm.exchange, 
            balance: parseFloat(newAccountForm.balance) 
        });
        setShowAddAccount(false);
        setNewAccountForm({ name: '', exchange: 'binance_futures', balance: '' });
    }, [newAccountForm, addAccount]);

    const handleMockRefresh = () => {
        setIsRefreshing(true);
        setTimeout(() => setIsRefreshing(false), 800);
    };

    return (
        <div className="flex flex-col h-full bg-bg-app font-sans overflow-hidden">
            
            {/* Top Global Navigation Bar */}
            <div className="flex flex-col border-b border-border-default bg-[#161a25] shrink-0">
                {/* Upper Breadcrumb Row */}
                <div className="flex justify-between items-center px-4 py-2 border-b border-[rgba(255,255,255,0.02)]">
                    <div className="flex items-center gap-3">
                        <span className="text-[10px] uppercase font-bold text-text-muted tracking-widest">Workspace</span>
                        <span className="text-[10px] text-text-secondary">&gt;</span>
                        <span className="text-[10px] uppercase font-bold text-tv-blue tracking-widest">Portfolio Context</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative group">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-tv-blue transition-colors" />
                            <input 
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Filter symbols..."
                                className="bg-bg-elevated border border-border-default focus:border-tv-blue text-[11px] text-white rounded-full pl-7 pr-3 py-1 outline-none transition-all w-[150px] focus:w-[200px]"
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-white">
                                    <X size={10}/>
                                </button>
                            )}
                        </div>
                        <button 
                            onClick={handleMockRefresh}
                            className={`p-1.5 rounded bg-bg-elevated border border-border-default text-text-muted hover:text-white transition-colors ${isRefreshing ? 'animate-spin text-tv-blue' : ''}`}
                            title="Force Sync State"
                        >
                            <RefreshCw size={12} />
                        </button>
                    </div>
                </div>

                {/* Primary Tab Row */}
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-1">
                        {TABS.map(tab => {
                            const active = portfolioTab === tab.id;
                            const Icon = tab.icon;
                            return (
                                <button 
                                    key={tab.id} 
                                    onClick={() => setPortfolioTab(tab.id)}
                                    className={`relative px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded transition-all duration-200 flex items-center gap-2 overflow-hidden group
                                        ${active ? 'text-white' : 'text-text-muted hover:text-gray-300 hover:bg-white/5'}`}
                                >
                                    {/* Active background pill */}
                                    {active && <div className="absolute inset-0 bg-tv-blue/10 border border-tv-blue/30 rounded z-0"></div>}
                                    
                                    <Icon size={14} className={`relative z-10 ${active ? 'text-tv-blue' : 'text-text-muted'}`}/>
                                    <span className="relative z-10">{tab.label}</span>
                                    
                                    {/* Badge for positions tab */}
                                    {tab.id === 'positions' && totalPosCount > 0 && (
                                        <span className={`relative z-10 text-[9px] px-1.5 py-0.5 rounded ml-1 ${active ? 'bg-tv-blue text-white' : 'bg-bg-hover text-gray-400'}`}>
                                            {totalPosCount}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    
                    <button 
                        onClick={() => setAddModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider bg-tv-blue hover:bg-[#1e54e5] text-white rounded shadow-md transition-all active:scale-95"
                    >
                        <Plus size={14} /> Synthetic Order
                    </button>
                </div>
            </div>

            {/* Sub-Context Toolbar (Conditional) */}
            {(portfolioTab === 'positions' || portfolioTab === 'history') && (
                <div className="flex justify-between items-center px-4 py-2 border-b border-bg-hover bg-bg-elevated shrink-0">
                    <div className="flex gap-2">
                        <button className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-text-secondary hover:text-white bg-bg-panel border border-border-default rounded">
                            <Filter size={10}/> All Expirations
                        </button>
                    </div>
                    {searchQuery && <span className="text-[10px] text-tv-blue font-bold">Filtered by "{searchQuery}"</span>}
                </div>
            )}

            {/* Dynamic Content Frame */}
            <div className="flex-1 overflow-hidden relative">
                
                {/* Router Engine */}
                <div className="absolute inset-0 overflow-hidden">
                    {portfolioTab === 'dashboard' && <PortfolioDashboard />}

                    {portfolioTab === 'positions' && (
                        <div className="h-full bg-bg-app">
                            <PositionTable
                                filter="open"
                                searchQuery={searchQuery}
                                onScalePosition={(pos) => setScaleModal({ open: true, position: pos })}
                                onClosePosition={(pos) => {
                                    // Use standard native prompt for quick closure in terminal mockup
                                    const price = window.prompt(`Close ${pos.symbol} at target limit price:\\nLeave blank for Market.`);
                                    if (price !== null) {
                                        usePortfolioStore.getState().closePosition(pos.id, parseFloat(price) || undefined);
                                    }
                                }}
                            />
                        </div>
                    )}

                    {portfolioTab === 'history' && (
                        <div className="h-full bg-bg-app">
                            <PositionTable filter="closed" searchQuery={searchQuery} />
                        </div>
                    )}

                    {portfolioTab === 'accounts' && (
                        <div className="flex h-full bg-[#161a25]">
                            
                            {/* Account List Region */}
                            <div className="flex-1 p-6 space-y-4 overflow-y-auto no-scrollbar">
                                <div className="grid grid-cols-2 gap-4">
                                    {accounts.map(acc => (
                                        <AccountCard 
                                            key={acc.id} 
                                            account={acc} 
                                            isActive={acc.id === activeAccountId} 
                                            onSelect={setActiveAccount} 
                                        />
                                    ))}
                                </div>

                                {/* Account Builder Trigger Block */}
                                {showAddAccount ? (
                                    <div className="border border-tv-blue border-dashed rounded-[4px] bg-tv-blue/5 p-6 space-y-4 animate-in fade-in slide-in-from-top-2">
                                        <h4 className="text-[12px] font-bold uppercase tracking-wider text-tv-blue">Provision New Capital Depot</h4>
                                        <div className="grid grid-cols-3 gap-4">
                                            <div>
                                                <label className="text-[10px] text-text-muted uppercase font-bold mb-1 block">Alias</label>
                                                <input 
                                                    value={newAccountForm.name} 
                                                    onChange={e => setNewAccountForm(f => ({ ...f, name: e.target.value }))}
                                                    placeholder="e.g. Scalp Fund A" 
                                                    className="w-full bg-bg-panel border border-bg-border text-white text-[12px] rounded px-3 py-2 outline-none focus:border-tv-blue" 
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-text-muted uppercase font-bold mb-1 block">Origin Network</label>
                                                <select 
                                                    value={newAccountForm.exchange} 
                                                    onChange={e => setNewAccountForm(f => ({ ...f, exchange: e.target.value }))}
                                                    className="w-full bg-bg-panel border border-bg-border text-white text-[12px] rounded px-3 py-2 outline-none focus:border-tv-blue"
                                                >
                                                    <option value="binance_futures">Binance Futures (Derivatives)</option>
                                                    <option value="binance_spot">Binance Spot (Equities)</option>
                                                    <option value="bybit">Bybit Perpetual</option>
                                                    <option value="paper">Local Paper Network</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-text-muted uppercase font-bold mb-1 block">Starting Capital</label>
                                                <input 
                                                    type="number" 
                                                    value={newAccountForm.balance} 
                                                    onChange={e => setNewAccountForm(f => ({ ...f, balance: e.target.value }))}
                                                    placeholder="USD Equivalent" 
                                                    className="w-full bg-bg-panel border border-bg-border text-white text-[12px] rounded px-3 py-2 outline-none font-mono focus:border-tv-blue" 
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-2 justify-end pt-2 border-t border-[rgba(255,255,255,0.05)]">
                                            <button onClick={() => setShowAddAccount(false)} className="px-5 py-2 text-[11px] font-bold text-gray-400 hover:text-white hover:bg-white/5 rounded transition-colors">Abort</button>
                                            <button onClick={handleAddAccount} className="px-5 py-2 text-[11px] font-bold bg-tv-blue text-white rounded shadow-md hover:bg-[#1e54e5] transition-colors">Initialize Depot</button>
                                        </div>
                                    </div>
                                ) : (
                                    <button 
                                        onClick={() => setShowAddAccount(true)}
                                        className="w-full py-6 mt-4 border border-dashed border-bg-border rounded-[4px] flex flex-col items-center justify-center gap-2 group hover:border-tv-blue hover:bg-tv-blue/5 transition-all"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-bg-elevated flex items-center justify-center text-text-muted group-hover:bg-tv-blue group-hover:text-white transition-colors shadow-sm">
                                            <Plus size={20} />
                                        </div>
                                        <div className="text-[12px] font-bold text-text-secondary uppercase tracking-wider group-hover:text-tv-blue transition-colors">
                                            Provision Capital Depot
                                        </div>
                                    </button>
                                )}
                            </div>

                            {/* Info Sidebar */}
                            <div className="w-[300px] border-l border-border-default bg-bg-panel p-6">
                                <h4 className="text-[11px] font-bold uppercase text-text-secondary tracking-wider mb-4 border-b border-bg-hover pb-2">Depot Architecture</h4>
                                <p className="text-[11px] text-text-muted leading-relaxed mb-4">
                                    Teralyn supports infinite independent paper/live sub-accounts allowing complex strategy segregation.
                                    Positions are heavily scoped per account guaranteeing clean margin tracking.
                                </p>
                                <div className="space-y-3 bg-bg-panel p-4 rounded border border-bg-hover">
                                    <div className="flex justify-between items-center border-b border-[rgba(255,255,255,0.02)] pb-2">
                                        <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Global Balance</span>
                                        <span className="text-[12px] font-mono text-white font-bold">${accounts.reduce((s,a)=>s+(a.balance||0),0).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Total Depots</span>
                                        <span className="text-[12px] font-mono text-white font-bold">{accounts.length} Nodes</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Overlays */}
            <AddPositionModal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} />
            <ScalePositionModal isOpen={scaleModal.open} onClose={() => setScaleModal({ open: false, position: null })} position={scaleModal.position} />
        </div>
    );
}
