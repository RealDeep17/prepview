import { useAppStore } from '../store/appStore';
import { TopBar } from './TopBar';
import { AccountsRail } from '../rail/AccountsRail';
import { DetailRail } from '../rail/DetailRail';
import { SummaryStrip } from '../metrics/SummaryStrip';
import { PositionsPane } from '../panes/PositionsPane';
import { ExposurePane } from '../panes/ExposurePane';
import { HistoryPane } from '../panes/HistoryPane';
import { JournalPane } from '../panes/JournalPane';
import { AddAccountOverlay } from '../overlays/AddAccountOverlay';
import { AddPositionOverlay } from '../overlays/AddPositionOverlay';
import { EditPositionOverlay } from '../overlays/EditPositionOverlay';
import { CsvImportOverlay } from '../overlays/CsvImportOverlay';

const tabs = [
  { key: 'positions' as const, label: 'Positions' },
  { key: 'exposure' as const, label: 'Exposure' },
  { key: 'history' as const, label: 'History' },
  { key: 'journal' as const, label: 'Journal' },
  { key: 'closed' as const, label: 'Closed' },
];

export function WorkstationShell() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const activeOverlay = useAppStore((s) => s.activeOverlay);

  return (
    <>
      <div className="shell">
        <TopBar />
        <div className="left-rail">
          <AccountsRail />
        </div>
        <div className="center-pane">
          <SummaryStrip />
          <div className="tab-bar">
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
          <div className="table-wrap">
            {activeTab === 'positions' && <PositionsPane />}
            {activeTab === 'exposure' && <ExposurePane />}
            {activeTab === 'history' && <HistoryPane />}
            {(activeTab === 'journal' || activeTab === 'closed') && <JournalPane showClosed={activeTab === 'closed'} />}
          </div>
        </div>
        <div className="right-rail">
          <DetailRail />
        </div>
      </div>

      {activeOverlay === 'add-account' && <AddAccountOverlay />}
      {activeOverlay === 'add-position' && <AddPositionOverlay />}
      {activeOverlay === 'edit-position' && <EditPositionOverlay />}
      {activeOverlay === 'csv-import' && <CsvImportOverlay />}
    </>
  );
}
