import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';
import { api, FileRecord } from '../api/client';
import { Carousel } from '../components/Carousel';

const TopBtn = styled.button`
  background: var(--accent);
  color: #0e1014;
  font-weight: 700;
  border: none;
`;

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Card = styled.div<{ $status: string }>`
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) auto;
  gap: 16px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-left: 4px solid
    ${(p) =>
      p.$status === 'move'
        ? 'var(--good)'
        : p.$status === 'delete'
        ? 'var(--bad)'
        : p.$status === 'fuzzy'
        ? 'var(--warn)'
        : p.$status === 'recent'
        ? 'var(--accent)'
        : 'var(--fg-dim)'};
  border-radius: 8px;
  padding: 10px;
  align-items: start;
  max-width: 100%;
  overflow: hidden;
`;

const Middle = styled.div`
  min-width: 0;
  overflow: hidden;
`;

const Title = styled.div`
  font-weight: 600;
  word-break: break-word;
  overflow-wrap: anywhere;
`;

const Sub = styled.div`
  color: var(--fg-dim);
  font-size: 12px;
  margin-top: 4px;
  word-break: break-word;
  overflow-wrap: anywhere;
`;

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
`;

const Chip = styled.span<{ $kind?: 'strong' | 'weak' }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: ${(p) => (p.$kind === 'weak' ? 'var(--warn)' : 'var(--bg-row-hover)')};
  color: ${(p) => (p.$kind === 'weak' ? '#0e1014' : 'var(--fg)')};
  border: 1px solid var(--border);
`;

const Actions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
`;

function fmtSize(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function fmtDate(s: number) {
  return new Date(s * 1000).toISOString().slice(0, 10);
}

export function FileList() {
  const { status = 'move' } = useParams();
  const qc = useQueryClient();
  const files = useQuery({
    queryKey: ['files', status],
    queryFn: () => api.listFiles(status),
  });
  const dests = useQuery({ queryKey: ['destinations'], queryFn: api.destinations });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { status: string; destination?: string } }) =>
      api.updateFile(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });

  const moveTop = useMutation({
    mutationFn: (id: number) => api.moveToTop(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files'] });
      qc.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (err: Error) => {
      if (err.message.includes('in VLC')) {
        alert('Skipped — this file is currently in your VLC media library.');
      }
    },
  });

  if (files.isLoading) return <div>Loading…</div>;
  if (files.error) return <div>Error: {String(files.error)}</div>;
  const list = files.data?.files ?? [];

  if (list.length === 0) {
    return (
      <div style={{ color: 'var(--fg-dim)' }}>
        No files in this bucket yet. Run <strong>Scan Now</strong>.
      </div>
    );
  }

  return (
    <Wrap>
      {list.map((f) => (
        <Row
          key={f.id}
          file={f}
          destinations={dests.data?.destinations ?? []}
          onChange={(body) => update.mutate({ id: f.id, body })}
          onMoveTop={() => moveTop.mutate(f.id)}
          moveTopBusy={moveTop.isPending && moveTop.variables === f.id}
        />
      ))}
    </Wrap>
  );
}

function Row({
  file,
  destinations,
  onChange,
  onMoveTop,
  moveTopBusy,
}: {
  file: FileRecord;
  destinations: string[];
  onChange: (body: { status: string; destination?: string }) => void;
  onMoveTop: () => void;
  moveTopBusy: boolean;
}) {
  return (
    <Card $status={file.status}>
      <Carousel id={file.id} />
      <Middle>
        <Title>{file.name}</Title>
        <Sub>
          {fmtSize(file.size)} · {fmtDate(file.mtime)} · <code>{file.path}</code>
        </Sub>
        {file.matched && file.matched.length > 0 && (
          <Chips>
            {file.matched.map((m, i) => (
              <Chip key={i} $kind={m.kind} title={m.pattern}>
                {m.destination} · {m.kind}
              </Chip>
            ))}
          </Chips>
        )}
        {file.destination && (
          <Sub>
            <strong style={{ color: 'var(--good)' }}>→ {file.destination}</strong>
          </Sub>
        )}
      </Middle>
      <Actions>
        <TopBtn onClick={onMoveTop} disabled={moveTopBusy} title="Move to /mnt/krumbus/top">
          {moveTopBusy ? 'Moving…' : '↑ Top'}
        </TopBtn>
        <select
          value={file.status}
          onChange={(e) =>
            onChange({
              status: e.target.value,
              destination: e.target.value === 'move' ? file.destination || destinations[0] : '',
            })
          }
        >
          <option value="move">move</option>
          <option value="delete">delete</option>
          <option value="recent">recent</option>
          <option value="fuzzy">fuzzy</option>
          <option value="keep">keep</option>
        </select>
        {file.status === 'move' && (
          <select
            value={file.destination ?? ''}
            onChange={(e) => onChange({ status: 'move', destination: e.target.value })}
          >
            {destinations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </Actions>
    </Card>
  );
}
