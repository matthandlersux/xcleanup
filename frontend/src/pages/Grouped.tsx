import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { api, Decision, GroupedFolder } from '../api/client';
import { Lightbox } from '../components/Lightbox';
import { phone } from '../styles/global';
import { GroupedFolder as GroupedFolderView } from './GroupedFolder';

/** Frames offered per video in the grouped lightbox. */
const LIGHTBOX_FRAMES = 5;

const Bar = styled.header`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);

  ${phone} {
    gap: 12px;
    padding: 10px 12px;
    button {
      min-height: 44px;
      flex-shrink: 0;
    }
  }
`;

const Meta = styled.div`
  color: var(--fg-dim);
  font-size: 12px;
  flex: 1;

  ${phone} {
    font-size: 13px;
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;

  ${phone} {
    gap: 12px;
    padding: 12px;
  }
`;

const Card = styled.div`
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  min-width: 0;

  /* Phone: folder info and buttons on top, the stills strip underneath. */
  ${phone} {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
`;

const Info = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
`;

const Name = styled.button`
  font-weight: 600;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  color: var(--fg);
  word-break: break-word;
  overflow-wrap: anywhere;
  cursor: pointer;

  ${phone} {
    font-size: 16px;
    padding: 4px 0;
  }

  &:hover {
    background: none;
    color: var(--accent);
    text-decoration: underline;
  }
`;

const Sub = styled.div`
  color: var(--fg-dim);
  font-size: 12px;

  ${phone} {
    font-size: 13px;
  }
`;

/* Two rows of stills — the "double height" strip. */
const Strip = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(2, 1fr);
  gap: 6px;
  min-width: 0;
`;

const Shot = styled.div`
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
  cursor: zoom-in;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const ShotName = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 3px 6px;
  font-size: 10px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  /* Too small to read at phone width; the lightbox shows the name. */
  ${phone} {
    display: none;
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
  margin-top: auto;

  ${phone} {
    button {
      min-height: 44px;
    }
  }
`;

const KeepBtn = styled.button`
  background: var(--good);
  color: #0e1014;
  font-weight: 700;
  border: none;
  flex: 1;
`;

const KillBtn = styled.button`
  background: var(--bad);
  color: #0e1014;
  font-weight: 700;
  border: none;
  flex: 1;
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
  return s ? new Date(s * 1000).toISOString().slice(0, 10) : '—';
}

export function Grouped() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const openFolder = params.get('folder');
  const folders = useQuery({ queryKey: ['grouped'], queryFn: () => api.groupedFolders() });
  const [view, setView] = useState<{ folder: GroupedFolder; pos: number; frame: number } | null>(null);

  const refresh = useMutation({
    mutationFn: () => api.groupedFolders(true),
    onSuccess: (data) => qc.setQueryData(['grouped'], data),
  });

  const act = useMutation({
    mutationFn: ({ path, decision }: { path: string; decision: Decision }) =>
      api.groupedAction(path, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['grouped'] }),
    onError: (err: Error) => alert(`Failed: ${err.message}`),
  });

  const decide = (f: GroupedFolder, decision: Decision) => {
    if (decision === 'delete') {
      const ok = confirm(
        `Delete the whole folder?\n\n${f.path}\n\n${f.video_count} videos · ${fmtSize(
          f.total_size,
        )}\n\nThis permanently removes the directory and everything in it.`,
      );
      if (!ok) return;
    }
    act.mutate({ path: f.path, decision });
  };

  if (openFolder) {
    return (
      <GroupedFolderView
        path={openFolder}
        onBack={() => {
          setParams({}, { replace: true });
          qc.invalidateQueries({ queryKey: ['grouped'] });
        }}
      />
    );
  }

  if (folders.isLoading) return <div style={{ padding: 14 }}>Scanning grouped folders…</div>;
  if (folders.error) return <div style={{ padding: 14 }}>Error: {String(folders.error)}</div>;

  const list = folders.data?.folders ?? [];
  const totalSize = list.reduce((a, f) => a + f.total_size, 0);
  const current = view?.folder.samples[view.pos];

  return (
    <>
      <Bar>
        <Meta>
          {list.length} folders awaiting review · {fmtSize(totalSize)} · excludes VR, auto-move
          destinations, and anything added in the last 30 days
        </Meta>
        <button disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? 'Rescanning…' : 'Rescan'}
        </button>
      </Bar>

      {list.length === 0 ? (
        <div style={{ color: 'var(--fg-dim)', padding: 14 }}>
          Nothing to review — every eligible folder has a verdict.
        </div>
      ) : (
        <List>
          {list.map((f) => (
            <Card key={f.path}>
              <Info>
                <Name title={`${f.path} — click to browse all ${f.video_count} videos`} onClick={() => setParams({ folder: f.path })}>
                  {f.name} ›
                </Name>
                <Sub>
                  {f.video_count} videos · {fmtSize(f.total_size)}
                </Sub>
                <Sub>newest: {fmtDate(f.mtime)}</Sub>
                <Actions>
                  <KeepBtn disabled={act.isPending} onClick={() => decide(f, 'keep')}>
                    Keep
                  </KeepBtn>
                  <KillBtn disabled={act.isPending} onClick={() => decide(f, 'delete')}>
                    Kill
                  </KillBtn>
                </Actions>
              </Info>
              <Strip>
                {f.samples.map((s, i) => (
                  <Shot
                    key={s.path}
                    onClick={() => setView({ folder: f, pos: i, frame: 0 })}
                    title={s.name}
                  >
                    <img src={api.groupedThumb(s.path, 0)} alt="" loading="lazy" draggable={false} />
                    <ShotName>{s.name}</ShotName>
                  </Shot>
                ))}
              </Strip>
            </Card>
          ))}
        </List>
      )}

      {view && current && (
        <Lightbox
          title={current.name}
          subtitle={`${view.folder.name} · ${fmtSize(current.size)} · ${current.path}`}
          position={`${view.pos + 1} / ${view.folder.samples.length}`}
          frameCount={LIGHTBOX_FRAMES}
          frameIdx={view.frame}
          frameSrc={(idx) => api.groupedThumb(current.path, idx)}
          onFrame={(frame) => setView({ ...view, frame })}
          onPrevItem={() =>
            setView({
              ...view,
              pos: (view.pos - 1 + view.folder.samples.length) % view.folder.samples.length,
              frame: 0,
            })
          }
          onNextItem={() =>
            setView({ ...view, pos: (view.pos + 1) % view.folder.samples.length, frame: 0 })
          }
          onClose={() => setView(null)}
          actions={
            <>
              <KeepBtn
                style={{ flex: 'none' }}
                onClick={() => {
                  setView(null);
                  decide(view.folder, 'keep');
                }}
              >
                Keep folder
              </KeepBtn>
              <KillBtn
                style={{ flex: 'none' }}
                onClick={() => {
                  setView(null);
                  decide(view.folder, 'delete');
                }}
              >
                Kill folder
              </KillBtn>
            </>
          }
        />
      )}
    </>
  );
}
