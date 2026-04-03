import { useRef, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import type { BalanceHistoryPoint } from '../lib/types';

/* ─── Types ─────────────────────────────────────────────── */
type TimeRange = '1h' | '24h' | '7d' | '30d';
type ChartMode = 'balance' | 'pnl' | 'per-account';

const RANGE_MS: Record<TimeRange, number> = {
  '1h':  3_600_000,
  '24h': 86_400_000,
  '7d':  604_800_000,
  '30d': 2_592_000_000,
};

/* ─── Canvas setup ──────────────────────────────────────── */
const PAD = { l: 58, r: 14, t: 16, b: 26 };

function setupCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (w === 0 || h === 0) return null;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function emptyMsg(ctx: CanvasRenderingContext2D, w: number, h: number, msg: string) {
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = '11px Inter,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(msg, w / 2, h / 2);
}

function yAxis(
  ctx: CanvasRenderingContext2D,
  min: number, max: number,
  W: number, toY: (v: number) => number, ticks = 4,
) {
  const range = max - min || 1;
  ctx.font = '9px "JetBrains Mono",monospace';
  ctx.textAlign = 'right';
  for (let t = 0; t <= ticks; t++) {
    const v = min + (range / ticks) * t;
    const y = toY(v);
    const abs = Math.abs(v);
    const label = abs >= 1_000_000 ? `$${(v/1e6).toFixed(1)}M`
      : abs >= 1_000 ? `$${(v/1_000).toFixed(1)}k`
      : `$${v.toFixed(0)}`;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText(label, PAD.l - 5, y + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + W, y); ctx.stroke();
  }
}

function xLabels(
  ctx: CanvasRenderingContext2D,
  pts: BalanceHistoryPoint[], h: number,
  toX: (i: number) => number,
  n = 5,
) {
  ctx.font = '9px "JetBrains Mono",monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  const count = Math.min(n, pts.length);
  for (let xi = 0; xi < count; xi++) {
    const idx = pts.length === 1 ? 0 : Math.round((xi / (count - 1)) * (pts.length - 1));
    const d = new Date(pts[idx].recordedAt);
    const label = pts.length <= 3
      ? `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
      : `${d.getMonth()+1}/${d.getDate()}`;
    ctx.fillText(label, toX(idx), h - 4);
  }
}

/* ─── Balance line chart ────────────────────────────────── */
function drawBalance(
  canvas: HTMLCanvasElement,
  pts: BalanceHistoryPoint[],
  principal: number,
) {
  const r = setupCanvas(canvas);
  if (!r) return;
  const { ctx, w, h } = r;

  if (pts.length === 0) {
    emptyMsg(ctx, w, h, 'No balance history — add or modify positions to record data');
    return;
  }

  const W = w - PAD.l - PAD.r;
  const H = h - PAD.t - PAD.b;
  const vals = pts.map((p) => p.equity);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const pad = (rawMax - rawMin) * 0.08 || rawMax * 0.02 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const range = max - min;

  const toX = (i: number) => PAD.l + (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
  const toY = (v: number) => PAD.t + (1 - (v - min) / range) * H;

  yAxis(ctx, min, max, W, toY);
  xLabels(ctx, pts, h, toX);

  // Principal line
  const py = toY(principal);
  if (py > PAD.t && py < PAD.t + H) {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(PAD.l, py); ctx.lineTo(PAD.l + W, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '8px Inter,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Principal', PAD.l + W - 2, py - 3);
  }

  if (pts.length === 1) {
    // Single dot
    const x = toX(0); const y = toY(vals[0]);
    const color = vals[0] >= principal ? '#3de0a0' : '#e05050';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    return;
  }

  // Area fill
  const lastVal = vals[vals.length - 1];
  const isUp = lastVal >= principal;
  const grd = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + H);
  grd.addColorStop(0, isUp ? 'rgba(61,224,160,0.18)' : 'rgba(224,80,80,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(vals[0]));
  for (let i = 1; i < vals.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
  ctx.lineTo(toX(vals.length-1), PAD.t + H);
  ctx.lineTo(toX(0), PAD.t + H);
  ctx.closePath(); ctx.fill();

  // Line — colour per segment
  for (let i = 1; i < vals.length; i++) {
    const mid = (vals[i] + vals[i-1]) / 2;
    ctx.strokeStyle = mid >= principal ? '#3de0a0' : '#e05050';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(i-1), toY(vals[i-1]));
    ctx.lineTo(toX(i), toY(vals[i]));
    ctx.stroke();
  }

  // End dot
  ctx.beginPath();
  ctx.arc(toX(vals.length-1), toY(lastVal), 3.5, 0, Math.PI*2);
  ctx.fillStyle = lastVal >= principal ? '#3de0a0' : '#e05050';
  ctx.fill();
}

/* ─── PnL bar chart (per trade) ──────────────────────────── */
function drawTradesPnlBars(
  canvas: HTMLCanvasElement,
  trades: { realizedPnl: number; color?: string }[],
) {
  const r = setupCanvas(canvas);
  if (!r) return;
  const { ctx, w, h } = r;

  if (trades.length === 0) {
    emptyMsg(ctx, w, h, 'No closed trades yet to show P&L bars');
    return;
  }

  const W = w - PAD.l - PAD.r;
  const H = h - PAD.t - PAD.b;

  const absMax = Math.max(...trades.map((t) => Math.abs(t.realizedPnl)), 1) * 1.15;
  const min = -absMax;
  const max = absMax;
  const range = max - min;

  const toY = (v: number) => PAD.t + (1 - (v - min) / range) * H;
  const zero = toY(0);

  yAxis(ctx, min, max, W, toY);

  // Zero axis line
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(PAD.l, zero); ctx.lineTo(PAD.l + W, zero); ctx.stroke();

  const MIN_SLOTS = 14;
  const slotCount = Math.max(MIN_SLOTS, trades.length);
  const totalSlotW = W / slotCount;
  const gap = 2;
  const barW = Math.max(2, totalSlotW - gap * 2);

  for (let i = 0; i < trades.length; i++) {
    const v = trades[i].realizedPnl;
    const cx = PAD.l + W - (trades.length - 1 - i + 0.5) * totalSlotW;
    const x  = cx - barW / 2;
    // Default profit/loss colors if no custom override
    const defaultColor = v >= 0 ? '#3de0a0' : '#e05050';
    const color = trades[i].color || defaultColor;
    const fillAlpha = trades[i].color ? '0.9' : (v >= 0 ? '0.8' : '0.75');

    const barTop    = v >= 0 ? toY(v) : zero;
    const barHeight = Math.max(1, Math.abs(toY(v) - zero));

    const radius = Math.min(3, barW / 2, barHeight / 2);
    
    ctx.fillStyle = trades[i].color ? color : (v >= 0 ? `rgba(61,224,160,${fillAlpha})` : `rgba(224,80,80,${fillAlpha})`);
    ctx.beginPath();
    if (v >= 0) {
      ctx.roundRect(x, barTop, barW, barHeight, [radius, radius, 0, 0]);
    } else {
      ctx.roundRect(x, barTop, barW, barHeight, [0, 0, radius, radius]);
    }
    ctx.fill();

    // Subtle glow line on top edge
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (v >= 0) {
      ctx.moveTo(x, barTop); ctx.lineTo(x + barW, barTop);
    } else {
      ctx.moveTo(x, barTop + barHeight); ctx.lineTo(x + barW, barTop + barHeight);
    }
    ctx.stroke();
  }
}

/* ─── Per-account multi-series ──────────────────────────── */
function drawPerAccountLine(
  canvas: HTMLCanvasElement,
  series: Array<{ accountName: string; points: BalanceHistoryPoint[] }>,
) {
  const r = setupCanvas(canvas);
  if (!r) return;
  const { ctx, w, h } = r;

  const filtered = series.filter((s) => s.points.length >= 1);
  if (!filtered.length) { emptyMsg(ctx, w, h, 'No per-account history yet'); return; }

  const W = w - PAD.l - PAD.r;
  const H = h - PAD.t - PAD.b;
  const COLORS = ['#7c6dff','#3de0a0','#e0a030','#e05050','#60c0e0','#cc60e0'];

  const allVals = filtered.flatMap((s) => s.points.map((p) => p.equity));
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const pad = (rawMax - rawMin) * 0.08 || 1;
  const min = rawMin - pad; const max = rawMax + pad;
  const range = max - min || 1;

  const allTimes = filtered.flatMap((s) => s.points.map((p) => +new Date(p.recordedAt)));
  const tMin = Math.min(...allTimes);
  const tMax = Math.max(...allTimes) || tMin + 1;

  const toY = (v: number) => PAD.t + (1 - (v - min) / range) * H;
  const toX = (t: number) => PAD.l + ((t - tMin) / (tMax - tMin)) * W;

  yAxis(ctx, min, max, W, toY);

  // Legend  
  ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'left';
  filtered.forEach((s, i) => {
    const col = COLORS[i % COLORS.length];
    ctx.fillStyle = col;
    ctx.fillRect(PAD.l + i * 90, h - 18, 8, 8);
    ctx.fillText(s.accountName.slice(0, 10), PAD.l + i*90 + 12, h - 12);
  });

  filtered.forEach((s, i) => {
    const vals = s.points.map((p) => ({ t: +new Date(p.recordedAt), v: p.equity }));
    const col = COLORS[i % COLORS.length];
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    vals.forEach((pt, j) => j === 0 ? ctx.moveTo(toX(pt.t), toY(pt.v)) : ctx.lineTo(toX(pt.t), toY(pt.v)));
    ctx.stroke();
    if (vals.length) {
      const last = vals[vals.length-1];
      ctx.beginPath(); ctx.arc(toX(last.t), toY(last.v), 3, 0, Math.PI*2);
      ctx.fillStyle = col; ctx.fill();
    }
  });
}

/* ─── ChartDrawer ───────────────────────────────────────── */
const DEFAULT_H = 220;
const MIN_H = 80;
const MAX_H = 560;

export function ChartDrawer() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const open      = useAppStore((s) => s.chartOpen);

  const [height,   setHeight]   = useState(DEFAULT_H);
  const [mode,     setMode]     = useState<ChartMode>('balance');
  const [range,    setRange]    = useState<TimeRange>('7d');
  const [acctMode, setAcctMode] = useState<'balance' | 'pnl'>('balance');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef   = useRef<{ startY: number; startH: number } | null>(null);

  /* Synthesize a "now" snapshot if history is empty */
  const rawHistory    = bootstrap?.portfolioHistory ?? [];
  const accountHistory = bootstrap?.accountHistory ?? [];
  const closedTrades  = bootstrap?.recentClosedTrades ?? [];
  const accounts      = bootstrap?.accounts ?? [];
  const positions     = bootstrap?.positions ?? [];

  const portfolioHistory: BalanceHistoryPoint[] = (() => {
    if (rawHistory.length > 0) return rawHistory;
    // Build one synthetic "now" point from current account state
    const totalBalance = accounts.reduce((s, a) => s + a.walletBalance, 0);
    const totalPnl     = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    if (totalBalance === 0 && totalPnl === 0) return [];
    return [{
      recordedAt: new Date().toISOString(),
      balance: totalBalance,
      equity: totalBalance + totalPnl,
    }];
  })();

  const principal = accounts.reduce((s, a) => s + a.walletBalance, 0);

  function filterByRange(pts: BalanceHistoryPoint[]) {
    const cutoff = Date.now() - RANGE_MS[range];
    const f = pts.filter((p) => +new Date(p.recordedAt) >= cutoff);
    return f.length >= 1 ? f : pts.slice(-Math.max(1, pts.length));
  }

  /* Redraw on any relevant state change */
  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let cancelled = false;

    function redraw() {
      if (cancelled) return;
      if (mode === 'balance') {
        drawBalance(canvas, filterByRange(portfolioHistory), principal);
      } else if (mode === 'pnl') {
        // Reverse closedTrades to correctly draw timeline (old -> new)
        const tradesAsc = [...closedTrades].reverse();
        drawTradesPnlBars(canvas, tradesAsc);
      } else {
        if (acctMode === 'balance') {
          const acc = accountHistory.map((s) => ({ ...s, points: filterByRange(s.points) }));
          drawPerAccountLine(canvas, acc);
        } else {
          // Per Account PnL mode
          const COLORS = ['#7c6dff','#3de0a0','#e0a030','#e05050','#60c0e0','#cc60e0'];
          // Give each trade its account's assigned color
          const accIndexMap = new Map<string, number>();
          accountHistory.forEach((s, idx) => accIndexMap.set(s.accountId, idx));
          
          const mappedTrades = [...closedTrades].reverse().map(t => ({
            realizedPnl: t.realizedPnl,
            color: COLORS[(accIndexMap.get(t.accountId) ?? 0) % COLORS.length]
          }));
          drawTradesPnlBars(canvas, mappedTrades);
        }
      }
    }

    const ro = new ResizeObserver(() => { if (!cancelled) redraw(); });
    ro.observe(canvas);
    // Small delay to let layout settle after open animation
    const t = setTimeout(redraw, 50);
    return () => { cancelled = true; ro.disconnect(); clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, range, acctMode, portfolioHistory.length, accountHistory.length, principal]);

  const onHandleDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setHeight(Math.max(MIN_H, Math.min(MAX_H,
        dragRef.current.startH + (dragRef.current.startY - ev.clientY)
      )));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height]);

  if (!open) return null;

  return (
    <div className="chart-drawer" style={{ height }}>

      {/* Handle bar ── drag up/down to resize */}
      <div className="chart-handle" onMouseDown={onHandleDown}>
        <div className="chart-handle-grip" />
      </div>

      <>
          {/* Toolbar */}
          <div style={{
            display:'flex', alignItems:'center', gap:8,
            padding:'0 12px', borderBottom:'1px solid var(--border)',
            height:30, flexShrink:0,
          }}>
            {/* Mode */}
            <div className="chart-tab-bar" style={{ display:'flex', gap:0 }}>
              {(['balance','pnl','per-account'] as ChartMode[]).map((m) => (
                <button key={m}
                  onClick={() => setMode(m)}
                  className={`chart-tab${mode===m?' chart-tab--active':''}`}
                >
                  {m==='balance' ? 'Balance' : m==='pnl' ? 'P&L' : 'Per Account'}
                </button>
              ))}
            </div>

            {/* Sub-mode only for per-account */}
            {mode==='per-account' && (
              <div style={{ display:'flex', gap:3 }}>
                {(['balance','pnl'] as const).map((m) => (
                  <button key={m} onClick={() => setAcctMode(m)} style={{
                    fontSize:9, padding:'2px 7px', borderRadius:3, border:'1px solid',
                    borderColor: acctMode===m ? 'var(--accent-border)' : 'var(--border)',
                    background:  acctMode===m ? 'var(--accent-glow)'   : 'transparent',
                    color:       acctMode===m ? 'var(--accent)'         : 'var(--text-muted)',
                    cursor:'pointer',
                  }}>
                    {m==='balance' ? 'Balance' : 'P&L'}
                  </button>
                ))}
              </div>
            )}

            {!(mode === 'pnl' || (mode === 'per-account' && acctMode === 'pnl')) && (
              <div style={{ marginLeft:'auto', display:'flex', gap:3 }}>
                {(['1h','24h','7d','30d'] as TimeRange[]).map((r) => (
                  <button key={r} onClick={() => setRange(r)} style={{
                    fontSize:9, padding:'2px 7px', borderRadius:3, border:'1px solid',
                    borderColor: range===r ? 'var(--accent-border)' : 'var(--border)',
                    background:  range===r ? 'var(--accent-glow)'   : 'transparent',
                    color:       range===r ? 'var(--accent)'         : 'var(--text-muted)',
                    cursor:'pointer',
                  }}>
                    {r}
                  </button>
                ))}
              </div>
            )}
            {(mode === 'pnl' || (mode === 'per-account' && acctMode === 'pnl')) && (
              <div style={{ marginLeft:'auto', display:'flex', gap:3 }}>
                <span style={{ fontSize:9, color:'var(--text-muted)' }}>PER TRADE</span>
              </div>
            )}
          </div>

          {/* Canvas */}
          <div className="chart-canvas-wrap">
            <canvas
              ref={canvasRef}
              style={{ display:'block', width:'100%', height:'100%' }}
            />
          </div>
        </>
    </div>
  );

}
