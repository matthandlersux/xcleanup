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
  grid-template-columns: 60px 1fr 80px;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  &:last-child { border-bottom: none; }
`;

const Kind = styled.span<{ $kind: string }>`
  font-weight: 700;
  color: ${(p) => (p.$kind === 'dir' ? 'var(--warn)' : 'var(--fg-dim)')};
  text-transform: uppercase;
`;

function fmtSize(n?: number) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function CleanupModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const preview = useQuery({ queryKey: ['cleanup-preview'], queryFn: api.cleanupPreview });
  const commit = useMutation({
    mutationFn: api.cleanupCommit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cleanup-preview'] });
      qc.invalidateQueries({ queryKey: ['files'] });
      qc.invalidateQueries({ queryKey: ['status'] });
      onClose();
    },
  });

  const items = preview.data?.items ?? [];
  const files = items.filter((i) => i.kind === 'file');
  const dirs = items.filter((i) => i.kind === 'dir');
  const totalSize = files.reduce((acc, f) => acc + (f.size ?? 0), 0);

  return (
    <Modal title="Cleanup Non-Video Files & Empty Folders" onClose={onClose}>
      <p>
        {preview.isLoading
          ? 'Scanning…'
          : `${files.length} files (${fmtSize(totalSize)}) · ${dirs.length} folders to remove`}
      </p>
      <List>
        {items.map((it) => (
          <Row key={it.path}>
            <Kind $kind={it.kind}>{it.kind}</Kind>
            <code title={it.path}>{it.path}</code>
            <span style={{ color: 'var(--fg-dim)' }}>{it.kind === 'file' ? fmtSize(it.size) : ''}</span>
          </Row>
        ))}
      </List>
      <ModalActions>
        <button onClick={onClose}>Cancel</button>
        <button
          onClick={() => commit.mutate()}
          disabled={items.length === 0 || commit.isPending}
          style={{ background: 'var(--bad)', color: '#0e1014', fontWeight: 700 }}
        >
          {commit.isPending ? 'Committing…' : `Delete ${items.length}`}
        </button>
      </ModalActions>
    </Modal>
  );
}
