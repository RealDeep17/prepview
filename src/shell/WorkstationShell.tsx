import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { TopBar } from './TopBar';
import { AccountsRail } from '../rail/AccountsRail';
import { DetailRail } from '../rail/DetailRail';
import { SummaryStrip } from '../metrics/SummaryStrip';
import { ChartDrawer } from '../metrics/ChartDrawer';
import { PositionsPane } from '../panes/PositionsPane';
import { ExposurePane } from '../panes/ExposurePane';
import { HistoryPane } from '../panes/HistoryPane';
import { JournalPane } from '../panes/JournalPane';
import { AddAccountOverlay } from '../overlays/AddAccountOverlay';
import { AddPositionOverlay } from '../overlays/AddPositionOverlay';
import { EditPositionOverlay } from '../overlays/EditPositionOverlay';
import { EditAccountOverlay } from '../overlays/EditAccountOverlay';
import { CsvImportOverlay } from '../overlays/CsvImportOverlay';
import { POSITION_COLUMN_OPTIONS, type PositionColumnKey } from '../lib/positionView';

const tabs = [
  { key: 'positions' as const, label: 'Positions' },
  { key: 'exposure' as const, label: 'Exposure' },
  { key: 'history' as const, label: 'History' },
  { key: 'journal' as const, label: 'Journal' },
  { key: 'closed' as const, label: 'Closed' },
];

export function WorkstationShell() {
  const activeTab      = useAppStore((s) => s.activeTab);
  const setActiveTab   = useAppStore((s) => s.setActiveTab);
  const activeOverlay  = useAppStore((s) => s.activeOverlay);
  const selectedAccountId = useAppStore((s) => s.selectedAccountId);
  const selectedPositionId = useAppStore((s) => s.selectedPositionId);
  const editingPositionId = useAppStore((s) => s.editingPositionId);
  const leftPanelOpen  = useAppStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const positionColumns = useAppStore((s) => s.positionColumns);
  const positionSortKey = useAppStore((s) => s.positionSortKey);
  const positionSortDirection = useAppStore((s) => s.positionSortDirection);
  const addPositionColumn = useAppStore((s) => s.addPositionColumn);
  const removePositionColumn = useAppStore((s) => s.removePositionColumn);
  const movePositionColumn = useAppStore((s) => s.movePositionColumn);
  const setPositionSort = useAppStore((s) => s.setPositionSort);
  const resetPositionView = useAppStore((s) => s.resetPositionView);
  const [showPositionColumns, setShowPositionColumns] = useState(false);
  const positionColumnsRef = useRef<HTMLDivElement | null>(null);

  const hiddenColumns = useMemo(
    () => POSITION_COLUMN_OPTIONS.filter((option) => !positionColumns.includes(option.key)),
    [positionColumns],
  );

  useEffect(() => {
    if (!showPositionColumns) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!positionColumnsRef.current) return;
      if (positionColumnsRef.current.contains(event.target as Node)) return;
      setShowPositionColumns(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showPositionColumns]);

  useEffect(() => {
    setShowPositionColumns(false);
  }, [activeTab]);

  return (
    <>
      <div className="shell">
        <TopBar />

        <div className="shell-body">

          {/* ── Left Rail ───────────────────────────── */}
          <div className={`shell-left-rail${leftPanelOpen ? '' : ' collapsed'}`}>
            <div className="rail-inner">
              <AccountsRail />
            </div>
          </div>

          {/* ── Center ──────────────────────────────── */}
          <div className="shell-center">
            <SummaryStrip />
            <div className="tab-bar">
              <div className="tab-bar-left">
                {tabs.map((tab) => (
                  <div
                    key={tab.key}
                    className={`tab-item${activeTab === tab.key ? ' tab-item--active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </div>
                ))}
              </div>
              {activeTab === 'positions' && (
                <div className="tab-bar-right">
                  <select
                    className="tab-control-select"
                    value={positionSortKey ?? ''}
                    onChange={(e) => setPositionSort(e.target.value ? e.target.value as PositionColumnKey : null)}
                  >
                    <option value="">Sort: Default</option>
                    {POSITION_COLUMN_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        Sort: {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="tab-control-btn"
                    onClick={() => setPositionSort(positionSortKey, positionSortDirection === 'asc' ? 'desc' : 'asc')}
                    disabled={!positionSortKey}
                  >
                    {positionSortDirection === 'asc' ? 'Asc' : 'Desc'}
                  </button>
                  <div className="tab-control-popover-wrap" ref={positionColumnsRef}>
                    <button
                      className={`tab-control-btn${showPositionColumns ? ' tab-control-btn--active' : ''}`}
                      onClick={() => setShowPositionColumns((value) => !value)}
                    >
                      Columns
                    </button>
                    {showPositionColumns && (
                      <div className="tab-control-popover">
                        <div className="tab-control-section">
                          <div className="tab-control-title">Visible</div>
                          {positionColumns.map((column, index) => {
                            const option = POSITION_COLUMN_OPTIONS.find((item) => item.key === column);
                            if (!option) return null;

                            return (
                              <div key={column} className="tab-control-row">
                                <span>{option.label}</span>
                                <div className="tab-control-actions">
                                  <button className="tab-control-mini" onClick={() => movePositionColumn(column, 'left')} disabled={index === 0}>↑</button>
                                  <button className="tab-control-mini" onClick={() => movePositionColumn(column, 'right')} disabled={index === positionColumns.length - 1}>↓</button>
                                  <button className="tab-control-mini" onClick={() => removePositionColumn(column)} disabled={positionColumns.length <= 1}>Hide</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="tab-control-section">
                          <div className="tab-control-title">Available</div>
                          {hiddenColumns.length > 0 ? hiddenColumns.map((option) => (
                            <div key={option.key} className="tab-control-row">
                              <span>{option.label}</span>
                              <div className="tab-control-actions">
                                <button className="tab-control-mini" onClick={() => addPositionColumn(option.key)}>Add</button>
                              </div>
                            </div>
                          )) : (
                            <div className="tab-control-empty">All columns are visible.</div>
                          )}
                        </div>
                        <div className="tab-control-footer">
                          <button
                            className="tab-control-btn tab-control-btn--full"
                            onClick={() => {
                              resetPositionView();
                              setShowPositionColumns(false);
                            }}
                          >
                            Default
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="table-wrap">
              {activeTab === 'positions'  && <PositionsPane />}
              {activeTab === 'exposure'   && <ExposurePane />}
              {activeTab === 'history'    && <HistoryPane />}
              {(activeTab === 'journal' || activeTab === 'closed') && (
                <JournalPane showClosed={activeTab === 'closed'} />
              )}
            </div>
            <ChartDrawer />
          </div>

          {/* ── Right Rail ──────────────────────────── */}
          <div className={`shell-right-rail${rightPanelOpen ? '' : ' collapsed'}`}>
            <div className="rail-inner rail-inner--right">
              <DetailRail />
            </div>
          </div>

        </div>
      </div>

      {activeOverlay === 'add-account'   && <AddAccountOverlay />}
      {activeOverlay === 'edit-account'  && <EditAccountOverlay key={selectedAccountId ?? 'edit-account'} />}
      {activeOverlay === 'add-position'  && <AddPositionOverlay />}
      {activeOverlay === 'edit-position' && (
        <EditPositionOverlay key={editingPositionId ?? selectedPositionId ?? 'edit-position'} />
      )}
      {activeOverlay === 'csv-import'    && <CsvImportOverlay />}
    </>
  );
}
