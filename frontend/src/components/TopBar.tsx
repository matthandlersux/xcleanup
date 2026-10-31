import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useState } from 'react';
import { ApplyModal } from './ApplyModal';
import { CleanupModal } from './CleanupModal';
import { DiskBar } from './DiskBar';

const Bar = styled.header`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
`;

const ActionRow = styled(Row)`
  justify-content: flex-end;
`;

const Tabs = styled.nav`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;

  a {
    color: var(--fg-dim);
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  a.active {
    color: var(--fg);
    background: var(--bg-row);
    border-color: var(--border);
  }
`;

const Spacer = styled.div`
  flex: 1;
  min-width: 0;
`;

const Meta = styled.div`
  display: flex;
  flex-direction: column;
  font-size: 11px;
  color: var(--fg-dim);
  line-height: 1.4;
  text-align: right;
  flex-shrink: 0;
`;

const Btn = styled.button<{ $variant?: 'primary' | 'warn' | 'danger' }>`
  background: ${(p) =>
    p.$variant === 'primary'
      ? 'var(--accent)'
      : p.$variant === 'danger'
      ? 'var(--bad)'
      : p.$variant === 'warn'
      ? 'var(--warn)'
      : 'var(--bg-elev)'};
  color: ${(p) => (p.$variant ? '#0e1014' : 'var(--fg)')};
  font-weight: 600;
  white-space: nowrap;
`;

const tabs: Array<{ to: string; label: string; key: 'all' | 'move' | 'delete' | 'recent' | 'fuzzy' | 'keep' }> = [
  { to: '/archive/files/all', label: 'All', key: 'all' },
  { to: '/archive/files/move', label: 'Auto-Move', key: 'move' },
  { to: '/archive/files/delete', label: 'Auto-Delete', key: 'delete' },
  { to: '/archive/files/recent', label: 'Recent', key: 'recent' },
  { to: '/archive/files/fuzzy', label: 'Fuzzy', key: 'fuzzy' },
  { to: '/archive/files/keep', label: 'Keep (VLC)', key: 'keep' },
];

export function TopBar() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 3000 });
  const scanProgress = status.data?.scan_progress;
  const [applyKind, setApplyKind] = useState<null | 'auto_moves' | 'auto_deletes'>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const startScan = useMutation({
    mutationFn: api.startScan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status'] }),
  });

  // Reclaims stills left behind by deletes that predate inline cleanup.
  const purgeThumbs = useMutation({
    mutationFn: (dry: boolean) => api.thumbsPurge(dry),
    onError: (err: Error) => alert(`Purge failed: ${err.message}`),
  });

  const runPurge = async () => {
    const dry = await purgeThumbs.mutateAsync(true);
    const mb = ((dry.orphan_bytes ?? 0) / 1024 / 1024).toFixed(1);
    if (!dry.orphan_dirs) {
      alert('Thumbnail cache is already clean — no orphans found.');
      return;
    }
    if (!confirm(`Delete ${dry.orphan_dirs} orphaned thumbnail sets (${mb} MB)?\n\nThese have no source video left on disk.`)) {
      return;
    }
    const res = await purgeThumbs.mutateAsync(false);
    alert(`Removed ${res.removed_dirs} thumbnail sets, freed ${((res.freed_bytes ?? 0) / 1024 / 1024).toFixed(1)} MB.`);
  };

  const counts = status.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <Bar>
      <Row>
        <Tabs>
          {tabs.map((t) => {
            const c = t.key === 'all' ? total : counts[t.key] ?? 0;
            return (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {t.label}
                <span style={{ marginLeft: 6, color: 'var(--fg-dim)' }}>{c}</span>
              </NavLink>
            );
          })}
        </Tabs>
        <Spacer />
        <DiskBar disk={status.data?.disk} />
        <Meta>
          <div>VLC: {status.data?.exclusion_count ?? '…'} excluded</div>
          <div>
            {scanProgress?.running
              ? `scanning… ${scanProgress.walked} walked / ${scanProgress.total} videos`
              : status.data?.archive_dir}
          </div>
        </Meta>
      </Row>
      <ActionRow>
        <Btn $variant="primary" disabled={scanProgress?.running || startScan.isPending} onClick={() => startScan.mutate()}>
          {scanProgress?.running ? 'Scanning…' : 'Scan Now'}
        </Btn>
        <Btn $variant="warn" onClick={() => setApplyKind('auto_moves')}>
          Apply Moves
        </Btn>
        <Btn $variant="danger" onClick={() => setApplyKind('auto_deletes')}>
          Apply Deletes
        </Btn>
        <Btn onClick={() => setCleanupOpen(true)}>Cleanup Non-Video</Btn>
        <Btn disabled={purgeThumbs.isPending} onClick={runPurge}>
          {purgeThumbs.isPending ? 'Purging…' : 'Purge Thumbs'}
        </Btn>
      </ActionRow>

      {applyKind && <ApplyModal bucket={applyKind} onClose={() => setApplyKind(null)} />}
      {cleanupOpen && <CleanupModal onClose={() => setCleanupOpen(false)} />}
    </Bar>
  );
}
