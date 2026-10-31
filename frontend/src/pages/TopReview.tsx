import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';
import { api, Decision, TopVideo, TopVideos } from '../api/client';
import { Lightbox } from '../components/Lightbox';

const Bar = styled.header`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
`;

const Meta = styled.div`
  color: var(--fg-dim);
  font-size: 12px;
  flex: 1;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  padding: 14px;
`;

const Tile = styled.div`
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  cursor: zoom-in;

  img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
    background: var(--bg);
  }
`;

const TileName = styled.div`
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.3;
  word-break: break-word;
  overflow-wrap: anywhere;
`;

const StartBtn = styled.button`
  background: var(--accent);
  color: #0e1014;
  font-weight: 700;
  border: none;
`;

const KeepBtn = styled.button`
  background: var(--good);
  color: #0e1014;
  font-weight: 700;
  border: none;
`;

const KillBtn = styled.button`
  background: var(--bad);
  color: #0e1014;
  font-weight: 700;
  border: none;
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

export function TopReview() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['top'], queryFn: api.topVideos });

  const [pos, setPos] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  // Per-video frame budget, grown by "More screenshots".
  const [extra, setExtra] = useState<Record<string, number>>({});

  const decide = useMutation({
    mutationFn: ({ path, decision }: { path: string; decision: Decision }) =>
      api.topDecision(path, decision),
    onSuccess: (_res, vars) => {
      // Drop the decided video locally so the queue advances without a refetch.
      qc.setQueryData<TopVideos>(['top'], (cur) =>
        cur
          ? { ...cur, videos: cur.videos.filter((v) => v.path !== vars.path), total: cur.total - 1 }
          : cur,
      );
    },
    onError: (err: Error) => alert(`Failed: ${err.message}`),
  });

  if (q.isLoading) return <div style={{ padding: 14 }}>Loading top…</div>;
  if (q.error) return <div style={{ padding: 14 }}>Error: {String(q.error)}</div>;

  const data = q.data;
  const videos = data?.videos ?? [];
  const initialFrames = data?.initial_frames ?? 5;
  const maxFrames = data?.max_frames ?? 24;

  const open = (i: number) => {
    setPos(i);
    setFrame(0);
  };

  const current: TopVideo | undefined = pos === null ? undefined : videos[Math.min(pos, videos.length - 1)];
  const frameCount = current ? extra[current.path] ?? initialFrames : initialFrames;

  const advance = (delta: number) => {
    if (!videos.length) return;
    setPos((p) => ((p ?? 0) + delta + videos.length) % videos.length);
    setFrame(0);
  };

  const onDecide = (decision: Decision) => {
    if (!current) return;
    if (decision === 'delete') {
      if (!confirm(`Delete this file permanently?\n\n${current.path}\n${fmtSize(current.size)}`)) return;
    }
    decide.mutate({ path: current.path, decision });
    setFrame(0);
    // pos stays put: the list shrinks under it, so the next video slides in.
    setPos((p) => {
      const next = p ?? 0;
      const remaining = videos.length - 1;
      if (remaining <= 0) return null;
      return next >= remaining ? 0 : next;
    });
  };

  return (
    <>
      <Bar>
        <Meta>
          {videos.length} videos awaiting review in {'/mnt/krumbus/top'} · ←→ screenshots, ↑↓ videos,
          keep hides it forever
        </Meta>
        <StartBtn disabled={!videos.length} onClick={() => open(0)}>
          Start review
        </StartBtn>
      </Bar>

      {videos.length === 0 ? (
        <div style={{ color: 'var(--fg-dim)', padding: 14 }}>
          Nothing left to review — everything in top has been kept or removed.
        </div>
      ) : (
        <Grid>
          {videos.map((v, i) => (
            <Tile key={v.path} onClick={() => open(i)} title={v.path}>
              <img src={api.topThumb(v.path, 0)} alt="" loading="lazy" draggable={false} />
              <TileName>{v.name}</TileName>
            </Tile>
          ))}
        </Grid>
      )}

      {current && (
        <Lightbox
          title={current.name}
          subtitle={`${fmtSize(current.size)} · ${current.path}`}
          position={`${Math.min(pos ?? 0, videos.length - 1) + 1} / ${videos.length}`}
          frameCount={frameCount}
          frameIdx={Math.min(frame, frameCount - 1)}
          frameSrc={(idx) => api.topThumb(current.path, idx)}
          onFrame={setFrame}
          onPrevItem={() => advance(-1)}
          onNextItem={() => advance(1)}
          onClose={() => setPos(null)}
          actions={
            <>
              <button
                disabled={frameCount >= maxFrames}
                onClick={() =>
                  setExtra((e) => ({
                    ...e,
                    [current.path]: Math.min(frameCount + initialFrames, maxFrames),
                  }))
                }
                title="Generate more stills from this video"
              >
                + More screenshots
              </button>
              <KeepBtn disabled={decide.isPending} onClick={() => onDecide('keep')}>
                Keep
              </KeepBtn>
              <KillBtn disabled={decide.isPending} onClick={() => onDecide('delete')}>
                Delete
              </KillBtn>
            </>
          }
        />
      )}
    </>
  );
}
