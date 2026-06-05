import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';
import { api } from '../api/client';
import { Modal, ModalActions } from './Modal';

const List = styled.div`
  max-height: 50vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  &:last-child {
    border-bottom: none;
  }
  code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const Op = styled.span<{ $kind: string }>`
  font-weight: 700;
  color: ${(p) => (p.$kind === 'delete' ? 'var(--bad)' : 'var(--good)')};
  text-transform: uppercase;
`;

const ProgressWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
`;

const Track = styled.div`
  height: 14px;
  background: var(--bg-elev);
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid var(--border);
  position: relative;
`;

const Fill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${(p) => Math.min(100, Math.max(0, p.$pct))}%;
  background: var(--accent);
  transition: width 150ms ease;
`;

const ProgressLabel = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--fg-dim);
`;

function fmtSize(n?: number) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function ApplyModal({
  bucket,
  onClose,
}: {
  bucket: 'auto_moves' | 'auto_deletes';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ['apply-preview', bucket],
    queryFn: () => api.applyPreview(bucket),
  });
  const commit = useMutation({
    mutationFn: () => api.applyCommit(bucket),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['files'] });
      qc.invalidateQueries({ queryKey: ['status'] });
      const skipped = (data as any).skipped_vlc ?? 0;
      const failed = (data as any).failed ?? 0;
      const lines: string[] = [];
      if (skipped > 0) lines.push(`Skipped ${skipped} file${skipped === 1 ? '' : 's'} now in VLC (moved to Keep).`);
      if (failed > 0) lines.push(`${failed} operation${failed === 1 ? '' : 's'} failed — see action log.`);
      if (lines.length) alert(lines.join('\n'));
      onClose();
    },
  });
  const progress = useQuery({
    queryKey: ['apply-progress'],
    queryFn: api.applyProgress,
    refetchInterval: commit.isPending ? 400 : false,
    enabled: commit.isPending,
  });

  const title = bucket === 'auto_moves' ? 'Apply Auto-Moves' : 'Apply Auto-Deletes';
  const ops = preview.data?.ops ?? [];
  const totalSize = ops.reduce((acc, o) => acc + (o.size ?? 0), 0);

  if (commit.isPending) {
    const p = progress.data;
    const done = p?.done ?? 0;
    const total = p?.total || ops.length;
    const pct = total ? (done / total) * 100 : 0;
    return (
      <Modal title={`${title} — running`} onClose={() => { /* block close while running */ }}>
        <ProgressWrap>
          <ProgressLabel>
            <span>
              {done} / {total}
            </span>
            <span>{pct.toFixed(0)}%</span>
          </ProgressLabel>
          <Track>
            <Fill $pct={pct} />
          </Track>
          <ProgressLabel>
            <span>Skipped (VLC): {p?.skipped_vlc ?? 0}</span>
            <span>Failed: {p?.failed ?? 0}</span>
          </ProgressLabel>
        </ProgressWrap>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p>{preview.isLoading ? 'Building plan…' : `${ops.length} operations queued · ${fmtSize(totalSize)} total`}</p>
      <List>
        {ops.map((o) => (
          <Row key={o.id}>
            <Op $kind={o.op}>{o.op}</Op>
            <code title={o.src}>{o.src.split('/').pop()}</code>
            <code title={o.dst}>{o.dst ? o.dst.split('/').slice(-2).join('/') : ''}</code>
          </Row>
        ))}
      </List>
      <ModalActions>
        <button onClick={onClose}>Cancel</button>
        <button
          onClick={() => commit.mutate()}
          disabled={ops.length === 0}
          style={{ background: bucket === 'auto_deletes' ? 'var(--bad)' : 'var(--good)', color: '#0e1014', fontWeight: 700 }}
        >
          Commit {ops.length}
        </button>
      </ModalActions>
    </Modal>
  );
}
