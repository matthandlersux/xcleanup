import styled from 'styled-components';
import type { Disk } from '../api/client';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
`;

const Label = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--fg-dim);
  letter-spacing: 0.3px;
`;

const Track = styled.div`
  position: relative;
  width: 100%;
  height: 8px;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
`;

const Fill = styled.div<{ $pct: number }>`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: ${(p) => Math.min(100, Math.max(0, p.$pct))}%;
  background: ${(p) => (p.$pct >= 90 ? 'var(--bad)' : p.$pct >= 75 ? 'var(--warn)' : 'var(--good)')};
  transition: width 200ms ease;
`;

function fmtBytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

export function DiskBar({ disk }: { disk: Disk | undefined }) {
  if (!disk || !disk.total) return null;
  const pct = (disk.used / disk.total) * 100;
  return (
    <Wrap title={disk.path}>
      <Label>
        <span>{fmtBytes(disk.free)} free</span>
        <span>
          {pct.toFixed(0)}% of {fmtBytes(disk.total)}
        </span>
      </Label>
      <Track>
        <Fill $pct={pct} />
      </Track>
    </Wrap>
  );
}
