import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';
import { api, GroupedFolderDetail, GroupedVideo } from '../api/client';
import { Lightbox } from '../components/Lightbox';

/** Frames offered per video in the drill-in lightbox. */
const LIGHTBOX_FRAMES = 5;

const Bar = styled.header`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  position: sticky;
  top: 0;
  z-index: 5;
`;

const Heading = styled.div`
  min-width: 0;
  flex: 1;
`;

const Name = styled.div`
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Sub = styled.div`
  color: var(--fg-dim);
  font-size: 12px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  padding: 14px;
`;

const Tile = styled.div<{ $gone: boolean }>`
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  opacity: ${(p) => (p.$gone ? 0.35 : 1)};
  pointer-events: ${(p) => (p.$gone ? 'none' : 'auto')};
`;

const Shot = styled.div`
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--bg);
  cursor: zoom-in;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const Body = styled.div`
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
`;

const FileName = styled.div`
  font-size: 12px;
  line-height: 1.3;
  word-break: break-word;
  overflow-wrap: anywhere;
`;

const KillBtn = styled.button`
  background: var(--bad);
  color: #0e1014;
  font-weight: 700;
  border: none;
  margin-top: auto;
  padding: 4px 10px;
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

export function GroupedFolder({ path, onBack }: { path: string; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['grouped-folder', path],
    queryFn: () => api.groupedVideos(path),
  });
  const [view, setView] = useState<{ pos: number; frame: number } | null>(null);

  const del = useMutation({
    mutationFn: (p: string) => api.groupedDeleteVideo(p),
    onSuccess: (_r, p) => {
      qc.setQueryData<GroupedFolderDetail>(['grouped-folder', path], (cur) =>
        cur
          ? {
              ...cur,
              videos: cur.videos.filter((v) => v.path !== p),
              total: cur.total - 1,
              total_size: cur.total_size - (cur.videos.find((v) => v.path === p)?.size ?? 0),
            }
          : cur,
      );
      // Folder counts on the list page are now stale.
      qc.invalidateQueries({ queryKey: ['grouped'] });
    },
    onError: (err: Error) => alert(`Delete failed: ${err.message}`),
  });

  if (q.isLoading) return <div style={{ padding: 14 }}>Loading folder…</div>;
  if (q.error) return <div style={{ padding: 14 }}>Error: {String(q.error)}</div>;

  const data = q.data;
  const videos = data?.videos ?? [];
  const current: GroupedVideo | undefined = view ? videos[view.pos] : undefined;

  const remove = (v: GroupedVideo) => {
    if (!confirm(`Delete this video permanently?\n\n${v.rel}\n${fmtSize(v.size)}`)) return;
    del.mutate(v.path);
  };

  return (
    <>
      <Bar>
        <button onClick={onBack}>← Back</button>
        <Heading>
          <Name title={data?.folder}>{data?.name}</Name>
          <Sub>
            {videos.length} videos · {fmtSize(data?.total_size ?? 0)}
          </Sub>
        </Heading>
      </Bar>

      {videos.length === 0 ? (
        <div style={{ color: 'var(--fg-dim)', padding: 14 }}>
          No videos left in this folder.
        </div>
      ) : (
        <Grid>
          {videos.map((v, i) => (
            <Tile key={v.path} $gone={del.isPending && del.variables === v.path}>
              <Shot onClick={() => setView({ pos: i, frame: 0 })} title="Click to enlarge">
                <img src={api.groupedThumb(v.path, 0)} alt="" loading="lazy" draggable={false} />
              </Shot>
              <Body>
                <FileName title={v.rel}>{v.rel}</FileName>
                <Sub>{fmtSize(v.size)}</Sub>
                <KillBtn disabled={del.isPending} onClick={() => remove(v)}>
                  Delete
                </KillBtn>
              </Body>
            </Tile>
          ))}
        </Grid>
      )}

      {view && current && (
        <Lightbox
          title={current.rel}
          subtitle={`${fmtSize(current.size)} · ${current.path}`}
          position={`${view.pos + 1} / ${videos.length}`}
          frameCount={LIGHTBOX_FRAMES}
          frameIdx={view.frame}
          frameSrc={(idx) => api.groupedThumb(current.path, idx)}
          onFrame={(frame) => setView({ ...view, frame })}
          onPrevItem={() => setView({ pos: (view.pos - 1 + videos.length) % videos.length, frame: 0 })}
          onNextItem={() => setView({ pos: (view.pos + 1) % videos.length, frame: 0 })}
          onClose={() => setView(null)}
          actions={
            <KillBtn
              disabled={del.isPending}
              onClick={() => {
                const target = current;
                // Step off the doomed item first so the lightbox lands on a
                // valid neighbour once the list shrinks.
                if (videos.length <= 1) setView(null);
                else setView({ pos: view.pos % (videos.length - 1), frame: 0 });
                if (!confirm(`Delete this video permanently?\n\n${target.rel}\n${fmtSize(target.size)}`)) return;
                del.mutate(target.path);
              }}
            >
              Delete
            </KillBtn>
          }
        />
      )}
    </>
  );
}
