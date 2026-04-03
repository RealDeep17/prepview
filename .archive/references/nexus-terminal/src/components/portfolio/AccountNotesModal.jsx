import React, { useState, useCallback, useEffect } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import { Settings, FileText, Target, Shield, Clock, Plus, X, Tag } from 'lucide-react';

/**
 * AccountNotesModal.jsx — Teralyn v2.0
 * Comprehensive modal for managing account metadata, strategic rulesets,
 * goals, and dynamic risk tags.
 */

export default function AccountNotesModal({ isOpen, onClose, account }) {
    const { updateAccount } = usePortfolioStore();
    
    // Internal State
    const [name, setName] = useState('');
    const [notes, setNotes] = useState(''); // General thesis
    const [rules, setRules] = useState(''); // Strict trading rules
    const [goals, setGoals] = useState(''); // Financial targets
    const [tags, setTags] = useState([]);
    const [tagInput, setTagInput] = useState('');
    const [activeTab, setActiveTab] = useState('thesis');

    // Sync on open
    useEffect(() => {
        if (account) {
            setName(account.name || '');
            setNotes(account.notes || '');
            setRules(account.rules || '');
            setGoals(account.goals || '');
            setTags(account.tags || []);
        }
    }, [account, isOpen]);

    const handleSave = useCallback(() => {
        if (!account) return;
        updateAccount(account.id, { name, notes, rules, goals, tags });
        onClose();
    }, [account, name, notes, rules, goals, tags, updateAccount, onClose]);

    const handleAddTag = (e) => {
        if (e.key === 'Enter' && tagInput.trim() !== '') {
            e.preventDefault();
            const newTag = tagInput.trim().toUpperCase();
            if (!tags.includes(newTag) && tags.length < 5) {
                setTags([...tags, newTag]);
            }
            setTagInput('');
        }
    };

    const removeTag = (tagToRemove) => {
        setTags(tags.filter(t => t !== tagToRemove));
    };

    if (!isOpen || !account) return null;

    const TABS = [
        { id: 'thesis', label: 'Strategy Thesis', icon: FileText },
        { id: 'rules', label: 'Strict Rules', icon: Shield },
        { id: 'goals', label: 'Targets & Goals', icon: Target },
        { id: 'meta', label: 'Metadata & Tags', icon: Settings },
    ];

    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center pointer-events-auto" onClick={onClose}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
            
            <div 
                className="relative w-[500px] h-[600px] flex flex-col bg-bg-app border border-bg-border rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.8)] font-sans overflow-hidden" 
                onClick={e => e.stopPropagation()}
            >
                {/* Header Profile */}
                <div className="flex flex-col px-6 py-5 border-b border-border-default bg-bg-elevated shrink-0">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded bg-tv-blue/20 flex items-center justify-center border border-tv-blue/30 text-tv-blue">
                                <FileText size={20}/>
                            </div>
                            <div>
                                <h3 className="text-[14px] font-bold text-white tracking-wide">Account Portfolio Dossier</h3>
                                <p className="text-[11px] text-text-muted">ID: {account.id.split('-')[0]}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="text-text-muted hover:text-white transition-colors bg-bg-input p-1.5 rounded">
                            <X size={14}/>
                        </button>
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-[10px] text-text-muted uppercase font-bold tracking-widest mb-1.5 block">Portfolio Alias</label>
                            <input 
                                value={name} 
                                onChange={e => setName(e.target.value)}
                                className="w-full bg-bg-panel border border-bg-border focus:border-tv-blue text-white text-[13px] font-bold rounded p-2 outline-none transition-colors" 
                            />
                        </div>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex border-b border-bg-hover bg-bg-panel shrink-0 px-2 pt-2 gap-1">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button 
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-t-[4px] border-b-2 transition-all
                                ${active ? 'border-tv-blue text-tv-blue bg-bg-elevated' : 'border-transparent text-text-muted hover:text-gray-300 hover:bg-white/5'}`}
                            >
                                <Icon size={12}/>
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Dynamic Content Area */}
                <div className="flex-1 p-6 overflow-y-auto no-scrollbar bg-[#161a25]">
                    
                    {activeTab === 'thesis' && (
                        <div className="h-full flex flex-col animate-in fade-in slide-in-from-right-2 duration-200">
                            <label className="text-[11px] text-text-secondary uppercase font-bold tracking-wide mb-2 flex items-center gap-2">
                                <FileText size={12} className="text-tv-blue"/> Core Trading Strategy
                            </label>
                            <textarea 
                                value={notes} 
                                onChange={e => setNotes(e.target.value)}
                                className="flex-1 w-full bg-bg-panel border border-bg-hover focus:border-tv-blue text-gray-300 text-[12px] leading-relaxed rounded p-3 outline-none resize-none transition-colors"
                                placeholder="Detail your edge, market conditions treated as favorable, and fundamental strategy overview..." 
                            />
                        </div>
                    )}

                    {activeTab === 'rules' && (
                        <div className="h-full flex flex-col animate-in fade-in slide-in-from-right-2 duration-200">
                            <label className="text-[11px] text-text-secondary uppercase font-bold tracking-wide mb-2 flex items-center gap-2">
                                <Shield size={12} className="text-tv-red"/> Hard Execution Rules
                            </label>
                            <textarea 
                                value={rules} 
                                onChange={e => setRules(e.target.value)}
                                className="flex-1 w-full bg-tv-red/5 border border-tv-red/20 focus:border-tv-red/60 text-gray-200 text-[12px] leading-relaxed rounded p-3 outline-none resize-none transition-colors"
                                placeholder="1. Max risk per trade: 1%&#10;2. Max daily loss drawdown limit...&#10;3. Never trade against HTF trend..." 
                            />
                        </div>
                    )}

                    {activeTab === 'goals' && (
                        <div className="h-full flex flex-col animate-in fade-in slide-in-from-right-2 duration-200">
                            <label className="text-[11px] text-text-secondary uppercase font-bold tracking-wide mb-2 flex items-center gap-2">
                                <Target size={12} className="text-tv-green"/> Financial Targets & Scaling
                            </label>
                            <textarea 
                                value={goals} 
                                onChange={e => setGoals(e.target.value)}
                                className="flex-1 w-full bg-tv-green/5 border border-tv-green/20 focus:border-tv-green/60 text-gray-200 text-[12px] leading-relaxed rounded p-3 outline-none resize-none transition-colors"
                                placeholder="Targeting consistent 3% monthly return. Withdrawal parameters at capital threshold..." 
                            />
                        </div>
                    )}

                    {activeTab === 'meta' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-200">
                            
                            {/* Readonly Info */}
                            <div className="bg-bg-elevated border border-border-default rounded p-4 grid grid-cols-2 gap-y-4 gap-x-6">
                                <div>
                                    <div className="text-[10px] text-text-muted uppercase font-bold mb-1">Creation Date</div>
                                    <div className="text-[12px] font-mono text-gray-200 flex items-center gap-1.5"><Clock size={10}/> {new Date(account.createdAt).toLocaleString()}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-text-muted uppercase font-bold mb-1">Exchange Origin</div>
                                    <div className="text-[12px] font-bold text-tv-blue capitalize bg-tv-blue/10 px-2 py-0.5 rounded inline-block border border-tv-blue/20">
                                        {account.exchange?.replace('_', ' ')}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-text-muted uppercase font-bold mb-1">Initial Deposit Watermark</div>
                                    <div className="text-[14px] font-mono text-white font-bold">${account.balance?.toFixed(2)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-text-muted uppercase font-bold mb-1">Internal Reference ID</div>
                                    <div className="text-[12px] font-mono text-gray-500 bg-bg-panel px-2 py-1 rounded select-all cursor-text">{account.id}</div>
                                </div>
                            </div>

                            {/* Tags System */}
                            <div>
                                <label className="text-[11px] text-text-secondary uppercase font-bold tracking-wide mb-2 flex items-center gap-2">
                                    <Tag size={12} className="text-amber-500"/> Risk Matrix Tags
                                </label>
                                <div className="p-4 bg-bg-elevated border border-border-default rounded">
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {tags.map(t => (
                                            <span key={t} className="bg-amber-500/10 text-amber-500 border border-amber-500/30 px-2 py-1 text-[10px] font-bold tracking-wider rounded flex items-center gap-1.5 transition-colors group">
                                                {t}
                                                <button onClick={() => removeTag(t)} className="opacity-50 hover:opacity-100 hover:text-white"><X size={10}/></button>
                                            </span>
                                        ))}
                                        {tags.length === 0 && <span className="text-[11px] text-text-muted italic">No classification tags assigned.</span>}
                                    </div>
                                    
                                    <div className="relative">
                                        <Plus size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                        <input 
                                            value={tagInput}
                                            onChange={e => setTagInput(e.target.value)}
                                            onKeyDown={handleAddTag}
                                            disabled={tags.length >= 5}
                                            placeholder={tags.length >= 5 ? "Maximum of 5 tags reached" : "Type a tag (e.g. HIGH_RISK, SCALP) and press Enter"}
                                            className="w-full bg-bg-panel border border-bg-hover text-gray-200 text-[11px] rounded pl-8 pr-3 py-2 outline-none focus:border-tv-blue transition-colors disabled:opacity-50"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                </div>

                {/* Sticky Footer */}
                <div className="flex justify-between items-center px-6 py-4 border-t border-border-default bg-bg-elevated shrink-0">
                    <span className="text-[10px] text-text-muted">Changes are synchronized dynamically into encrypted local storage.</span>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-5 py-2 text-[11px] font-bold text-gray-400 hover:text-white hover:bg-white/5 rounded transition-colors">Discard</button>
                        <button onClick={handleSave} className="px-6 py-2 text-[11px] font-bold bg-tv-blue hover:bg-[#1e54e5] text-white rounded shadow-md transition-colors">Save Dossier</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
