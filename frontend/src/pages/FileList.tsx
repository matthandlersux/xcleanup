import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';
import { api, FileRecord } from '../api/client';
import { Carousel, FRAME_COUNT } from '../components/Carousel';
import { Lightbox } from '../components/Lightbox';
import { phone } from '../styles/global';

const TopBtn = styled.button`
  background: var(--accent);
  color: #0e1014;
  font-weight: 700;
  border: none;
  padding: 4px 10px;

  ${phone} {
    min-height: 44px;
    padding: 0 16px;
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 14px;
  align-items: start;

  /* Phone: one card per row, so names, paths and controls get the full width. */
  ${phone} {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 12px;
  }
`;

const Card = styled.div<{ $status: string }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-top: 3px solid
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
  min-width: 0;
  overflow: hidden;

  ${phone} {
    gap: 10px;
    padding: 12px;
  }
`;

const Title = styled.div`
  font-weight: 600;
  font-size: 13px;
  line-height: 1.3;
  word-break: break-word;
  overflow-wrap: anywhere;

  ${phone} {
    font-size: 16px;
  }
`;

const Sub = styled.div`
  color: var(--fg-dim);
  font-size: 11px;
  word-break: break-word;
  overflow-wrap: anywhere;

  ${phone} {
    font-size: 13px;
    line-height: 1.4;
  }
`;

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const Chip = styled.span<{ $kind?: 'strong' | 'weak' }>`
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: ${(p) => (p.$kind === 'weak' ? 'var(--warn)' : 'var(--bg-row-hover)')};
  color: ${(p) => (p.$kind === 'weak' ? '#0e1014' : 'var(--fg)')};
  border: 1px solid var(--border);
  max-width: 100%;
  overflow-wrap: anywhere;

  ${phone} {
    font-size: 12px;
    padding: 2px 8px;
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: auto;

  select {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    padding: 3px 6px;
  }

  /* Phone: 16px selects (no iOS zoom-on-focus) and 44px tap targets; the
     destination picker drops to its own full-width line. */
  ${phone} {
    gap: 8px;
    select {
      flex: 1 1 120px;
      min-height: 44px;
      font-size: 16px;
      padding: 0 8px;
    }
    select + select {
      flex-basis: 100%;
    }
  }
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

  // Lightbox state: which file (by list position) and which frame.
  const [view, setView] = useState<{ pos: number; frame: number } | null>(null);

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

  if (files.isLoading) return <div style={{ padding: 14 }}>Loading…</div>;
  if (files.error) return <div style={{ padding: 14 }}>Error: {String(files.error)}</div>;
  const list = files.data?.files ?? [];

  if (list.length === 0) {
    return (
      <div style={{ color: 'var(--fg-dim)', padding: 14 }}>
        No files in this bucket yet. Run <strong>Scan Now</strong>.
      </div>
    );
  }

  const current = view ? list[view.pos] : null;
  // Auto-moves open on the second frame: for common studios the first is the same intro card on every
  // video, and here Matt is picking out videos he doesn't want. Auto-deletes keep the first (the studio
  // card is the best sign of a video he'd want to save).
  const startFrame = status === 'move' ? 1 : 0;

  return (
    <>
      <Grid>
        {list.map((f, i) => (
          <Row
            key={f.id}
            file={f}
            destinations={dests.data?.destinations ?? []}
            onChange={(body) => update.mutate({ id: f.id, body })}
            onMoveTop={() => moveTop.mutate(f.id)}
            moveTopBusy={moveTop.isPending && moveTop.variables === f.id}
            onOpen={(frame) => setView({ pos: i, frame })}
            startFrame={startFrame}
          />
        ))}
      </Grid>

      {current && view && (
        <Lightbox
          title={current.name}
          subtitle={`${fmtSize(current.size)} · ${fmtDate(current.mtime)} · ${current.path}`}
          position={`${view.pos + 1} / ${list.length}`}
          frameCount={FRAME_COUNT}
          frameIdx={view.frame}
          frameSrc={(idx) => `/api/thumb/${current.id}/${idx}.jpg`}
          onFrame={(frame) => setView({ ...view, frame })}
          onPrevItem={() => setView({ pos: (view.pos - 1 + list.length) % list.length, frame: startFrame })}
          onNextItem={() => setView({ pos: (view.pos + 1) % list.length, frame: startFrame })}
          onClose={() => setView(null)}
        />
      )}
    </>
  );
}

function Row({
  file,
  destinations,
  onChange,
  onMoveTop,
  moveTopBusy,
  onOpen,
  startFrame,
}: {
  file: FileRecord;
  destinations: string[];
  onChange: (body: { status: string; destination?: string }) => void;
  onMoveTop: () => void;
  moveTopBusy: boolean;
  onOpen: (frame: number) => void;
  startFrame: number;
}) {
  return (
    <Card $status={file.status}>
      <Carousel id={file.id} onOpen={onOpen} initialFrame={startFrame} />
      <Title title={file.name}>{file.name}</Title>
      <Sub>
        {fmtSize(file.size)} · {fmtDate(file.mtime)}
      </Sub>
      <Sub>
        <code>{file.path}</code>
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
      <Actions>
        <TopBtn onClick={onMoveTop} disabled={moveTopBusy} title="Move to /mnt/krumbus/top">
          {moveTopBusy ? '…' : '↑ Top'}
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
