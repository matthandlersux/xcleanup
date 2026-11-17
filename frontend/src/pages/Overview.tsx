import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { api, type StorageSnapshot, type StorageDrive, type StorageBreakdown } from '../api/client';
import { phone } from '../styles/global';

const Wrap = styled.div`
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1100px;
  margin: 0 auto;

  ${phone} {
    padding: 12px;
    gap: 18px;
  }
`;

const SectionTitle = styled.h2`
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--fg-dim);
`;

const HighlightCard = styled.section<{ $pct: number }>`
  border: 1px solid ${(p) => (p.$pct >= 90 ? 'var(--bad)' : p.$pct >= 75 ? 'var(--warn)' : 'var(--border)')};
  background: var(--bg-elev);
  border-radius: 10px;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  ${phone} {
    padding: 16px;
  }
`;

const HighlightHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;

  ${phone} {
    gap: 8px;
    min-width: 0;
  }
`;

const HighlightLabel = styled.div`
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--fg-dim);
  font-weight: 700;
`;

const HighlightFree = styled.div<{ $bad: boolean; $warn: boolean }>`
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: ${(p) => (p.$bad ? 'var(--bad)' : p.$warn ? 'var(--warn)' : 'var(--good)')};

  ${phone} {
    font-size: 34px;
  }
`;

const HighlightFooter = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--fg-dim);
`;

const Track = styled.div`
  position: relative;
  width: 100%;
  height: 10px;
  background: var(--bg);
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid var(--border);
`;

const Fill = styled.div<{ $pct: number }>`
  position: absolute;
  inset: 0 auto 0 0;
  width: ${(p) => Math.min(100, Math.max(0, p.$pct))}%;
  background: ${(p) => (p.$pct >= 90 ? 'var(--bad)' : p.$pct >= 75 ? 'var(--warn)' : 'var(--good)')};
  transition: width 200ms ease;
`;

const UsedFill = styled.div<{ $pct: number }>`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: ${(p) => Math.min(100, Math.max(0, p.$pct))}%;
  background: var(--bad);
  transition: width 200ms ease;
`;

const FreeFill = styled.div<{ $pct: number }>`
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: ${(p) => Math.min(100, Math.max(0, 100 - p.$pct))}%;
  background: var(--good);
  transition: width 200ms ease;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;

  ${phone} {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const DriveCard = styled.div`
  border: 1px solid var(--border);
  background: var(--bg-elev);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const DriveHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
`;

const DriveLabel = styled.div`
  font-weight: 700;
  font-size: 14px;
`;

const DrivePath = styled.div`
  font-size: 11px;
  color: var(--fg-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DriveStats = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--fg-dim);
`;

const Breakdown = styled.section`
  border: 1px solid var(--border);
  background: var(--bg-elev);
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  ${phone} {
    padding: 16px;
  }
`;

const BreakdownBody = styled.div`
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 28px;
  align-items: center;
  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    justify-items: center;
    gap: 20px;
    & > * {
      justify-self: stretch;
    }
    & > svg {
      justify-self: center;
    }
  }
`;

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Swatch = styled.span<{ $color: string }>`
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: ${(p) => p.$color};
  margin-right: 8px;
  vertical-align: middle;
`;

const BreakdownRow = styled.div`
  display: grid;
  grid-template-columns: 160px 1fr 90px;
  gap: 12px;
  align-items: center;

  ${phone} {
    grid-template-columns: minmax(0, 1fr) 70px auto;
    gap: 10px;
  }
`;

const BreakdownBar = styled.div`
  position: relative;
  height: 14px;
  background: var(--bg);
  border-radius: 4px;
  border: 1px solid var(--border);
  overflow: hidden;
`;

const BreakdownFill = styled.div<{ $pct: number; $color: string }>`
  position: absolute;
  inset: 0 auto 0 0;
  width: ${(p) => Math.min(100, Math.max(0, p.$pct))}%;
  background: ${(p) => p.$color};
`;

const SLICE_COLORS = ['#5b9eff', '#f5a524', '#a78bfa', '#4ade80', '#ef5a5a', '#22d3ee'];

const BreakdownLabel = styled.div`
  font-size: 13px;
  font-weight: 600;

  ${phone} {
    font-size: 14px;
    overflow-wrap: anywhere;
  }
`;

const BreakdownSize = styled.div`
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-dim);
  text-align: right;
`;

const RefreshBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--fg-dim);
  font-size: 12px;

  ${phone} {
    font-size: 13px;
    button {
      min-height: 40px;
      flex-shrink: 0;
    }
  }
`;

const Empty = styled.div`
  padding: 40px;
  text-align: center;
  color: var(--fg-dim);
`;

const Err = styled.div`
  color: var(--bad);
  font-size: 12px;
`;

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function relTime(iso: string) {
  const t = new Date(iso).getTime();
  if (!t) return '—';
  const ms = Date.now() - t;
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function hasData(s: StorageSnapshot | null): s is StorageSnapshot & {
  drives: StorageDrive[];
  breakdowns: StorageBreakdown[];
  computed_at: string;
} {
  return !!s && Array.isArray(s.drives) && s.drives.length > 0;
}

export function Overview() {
  const [snap, setSnap] = useState<StorageSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vlcCount, setVlcCount] = useState<number | null>(null);
  const [vlcError, setVlcError] = useState<string | null>(null);

  async function load() {
    try {
      const s = await api.storage();
      setSnap(s);
      setRefreshing(!!s.refreshing);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadVlc() {
    try {
      const r = await api.exclusions();
      setVlcCount(r.count);
      setVlcError(null);
    } catch (e) {
      setVlcError(String(e));
    }
  }

  async function triggerRefresh() {
    try {
      await api.storageRefresh();
      setRefreshing(true);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
    loadVlc();
    const id = setInterval(load, 15_000);
    const vlcId = setInterval(loadVlc, 60_000);
    return () => { clearInterval(id); clearInterval(vlcId); };
  }, []);

  if (error) {
    return (
      <Wrap>
        <Err>{error}</Err>
      </Wrap>
    );
  }

  if (!hasData(snap)) {
    return (
      <Wrap>
        <Empty>
          {refreshing ? 'Computing first storage snapshot — this can take a while on large drives…' : 'No snapshot yet.'}
        </Empty>
      </Wrap>
    );
  }

  const drives = snap.drives;
  const breakdowns = snap.breakdowns;
  const computedAt = snap.computed_at;

  const highlighted = drives.find((d) => d.highlight) ?? drives[0];
  const others = drives.filter((d) => d !== highlighted);
  const highlightedBreakdown = breakdowns.find((b) => b.drive === highlighted.label);

  return (
    <Wrap>
      <RefreshBar>
        <span>Computed {relTime(computedAt)}. Auto-refreshes hourly.</span>
        <button onClick={triggerRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </RefreshBar>

      <HighlightDriveCard drive={highlighted} />
      {highlightedBreakdown && <BreakdownView drive={highlighted} breakdown={highlightedBreakdown} />}

      <div>
        <SectionTitle>Other drives</SectionTitle>
        <Grid>
          {others.map((d) => (
            <SmallDriveCard key={d.label} drive={d} />
          ))}
        </Grid>
      </div>

      <div>
        <SectionTitle>Libraries</SectionTitle>
        <Grid>
          <StatCard label="VLC media library" value={vlcCount} hint="entries in ml.xspf" error={vlcError} />
        </Grid>
      </div>
    </Wrap>
  );
}

const StatCardWrap = styled(DriveCard)``;
const StatValue = styled.div`
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.3px;
  font-variant-numeric: tabular-nums;
`;
const StatHint = styled.div`
  font-size: 11px;
  color: var(--fg-dim);
  text-transform: uppercase;
  letter-spacing: 0.4px;
`;

function StatCard({ label, value, hint, error }: { label: string; value: number | null; hint?: string; error?: string | null }) {
  return (
    <StatCardWrap>
      <DriveHead>
        <DriveLabel>{label}</DriveLabel>
      </DriveHead>
      <StatValue>{value === null ? '…' : value.toLocaleString()}</StatValue>
      {hint && <StatHint>{hint}</StatHint>}
      {error && <Err>{error}</Err>}
    </StatCardWrap>
  );
}

function HighlightDriveCard({ drive }: { drive: StorageDrive }) {
  const pct = drive.total > 0 ? (drive.used / drive.total) * 100 : 0;
  return (
    <HighlightCard $pct={pct}>
      <HighlightHead>
        <HighlightLabel>{drive.label} — free space</HighlightLabel>
        <DrivePath>{drive.path}</DrivePath>
      </HighlightHead>
      <HighlightFree $bad={pct >= 90} $warn={pct >= 75 && pct < 90}>
        {fmtBytes(drive.free)}
      </HighlightFree>
      <Track>
        <UsedFill $pct={pct} />
        <FreeFill $pct={pct} />
      </Track>
      <HighlightFooter>
        <span>
          {fmtBytes(drive.used)} used / {fmtBytes(drive.total)} total
        </span>
        <span>{pct.toFixed(1)}% full</span>
      </HighlightFooter>
      {drive.error && <Err>{drive.error}</Err>}
    </HighlightCard>
  );
}

function SmallDriveCard({ drive }: { drive: StorageDrive }) {
  const pct = drive.total > 0 ? (drive.used / drive.total) * 100 : 0;
  return (
    <DriveCard>
      <DriveHead>
        <DriveLabel>{drive.label}</DriveLabel>
        <span style={{ fontSize: 12, color: 'var(--fg-dim)' }}>{pct.toFixed(0)}%</span>
      </DriveHead>
      <DrivePath title={drive.path}>{drive.path}</DrivePath>
      <Track>
        <Fill $pct={pct} />
      </Track>
      <DriveStats>
        <span>{fmtBytes(drive.free)} free</span>
        <span>{fmtBytes(drive.total)} total</span>
      </DriveStats>
      {drive.error && <Err>{drive.error}</Err>}
    </DriveCard>
  );
}

function BreakdownView({ drive, breakdown }: { drive: StorageDrive; breakdown: StorageBreakdown }) {
  const itemsTotal = breakdown.items.reduce((sum, i) => sum + (i.size || 0), 0);
  // Pie shows slices as fraction of summed items so the wedges always cover
  // the full circle; bar rows are pct of disk used so they tell you the
  // "how much of the drive does this take" story instead.
  const driveUsed = drive.used > 0 ? drive.used : itemsTotal;
  return (
    <Breakdown>
      <SectionTitle>{drive.label} usage breakdown</SectionTitle>
      <BreakdownBody>
        <PieChart items={breakdown.items} total={itemsTotal} />
        <Rows>
          {breakdown.items.map((item, idx) => {
            const pctOfDrive = driveUsed > 0 ? (item.size / driveUsed) * 100 : 0;
            const color = SLICE_COLORS[idx % SLICE_COLORS.length];
            return (
              <BreakdownRow key={item.label}>
                <BreakdownLabel title={item.path}>
                  <Swatch $color={color} />
                  {item.label}
                </BreakdownLabel>
                <BreakdownBar>
                  <BreakdownFill $pct={pctOfDrive} $color={color} />
                </BreakdownBar>
                <BreakdownSize>
                  {fmtBytes(item.size)} ({pctOfDrive.toFixed(0)}%)
                </BreakdownSize>
                {item.error && (
                  <Err style={{ gridColumn: '1 / -1' }}>{item.error}</Err>
                )}
              </BreakdownRow>
            );
          })}
        </Rows>
      </BreakdownBody>
    </Breakdown>
  );
}

function PieChart({ items, total }: { items: StorageBreakdown['items']; total: number }) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const innerR = r * 0.55;

  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="1" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill="var(--fg-dim)" fontSize="12">
          no data
        </text>
      </svg>
    );
  }

  let cursor = -Math.PI / 2; // start at 12 o'clock
  const slices = items.map((item, idx) => {
    const frac = (item.size || 0) / total;
    const start = cursor;
    const end = cursor + frac * Math.PI * 2;
    cursor = end;
    return { item, start, end, frac, color: SLICE_COLORS[idx % SLICE_COLORS.length] };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Krumbus breakdown pie chart">
      {slices.map((s) => (
        <path
          key={s.item.label}
          d={donutSlicePath(cx, cy, r, innerR, s.start, s.end)}
          fill={s.color}
          stroke="var(--bg-elev)"
          strokeWidth="1.5"
        >
          <title>{`${s.item.label}: ${fmtBytes(s.item.size)} (${(s.frac * 100).toFixed(1)}%)`}</title>
        </path>
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle" fill="var(--fg)" fontSize="13" fontWeight="700">
        {fmtBytes(total)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="middle" fill="var(--fg-dim)" fontSize="10" letterSpacing="0.4">
        SUMMED
      </text>
    </svg>
  );
}

function donutSlicePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  const sweep = end - start;
  // A full-circle slice (only one bucket has data) needs to be drawn as two
  // 180° arcs because SVG can't draw a 360° arc with a single path command.
  if (sweep >= Math.PI * 2 - 1e-6) {
    const mid = start + Math.PI;
    return [
      donutSlicePath(cx, cy, rOuter, rInner, start, mid),
      donutSlicePath(cx, cy, rOuter, rInner, mid, end),
    ].join(' ');
  }
  const largeArc = sweep > Math.PI ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(start);
  const y1 = cy + rOuter * Math.sin(start);
  const x2 = cx + rOuter * Math.cos(end);
  const y2 = cy + rOuter * Math.sin(end);
  const x3 = cx + rInner * Math.cos(end);
  const y3 = cy + rInner * Math.sin(end);
  const x4 = cx + rInner * Math.cos(start);
  const y4 = cy + rInner * Math.sin(start);
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}
