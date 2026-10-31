export type Match = { destination: string; kind: 'strong' | 'weak'; pattern: string };

export type FileRecord = {
  id: number;
  path: string;
  name: string;
  size: number;
  mtime: number;
  status: 'move' | 'delete' | 'fuzzy' | 'keep' | 'recent';
  destination?: string;
  matched?: Match[];
  override: boolean;
  extension?: string;
};

export type Disk = { path: string; free: number; total: number; used: number };

export type ApplyProgress = {
  running: boolean;
  bucket?: string;
  started?: string;
  finished?: string;
  total: number;
  done: number;
  skipped_vlc: number;
  failed: number;
  error?: string;
};

export type Status = {
  archive_dir: string;
  grouped_dir: string;
  top_dir: string;
  vlc_path: string;
  exclusion_count: number;
  counts: Record<string, number>;
  disk: Disk;
  apply_progress: ApplyProgress;
  last_scan: null | {
    id: number;
    started_at: number;
    finished_at: number;
    total: number;
    move: number;
    delete: number;
    fuzzy: number;
    keep: number;
    error?: string;
  };
  scan_progress: {
    running: boolean;
    started: string;
    finished?: string;
    walked: number;
    total: number;
    move: number;
    delete: number;
    fuzzy: number;
    keep: number;
    recent: number;
    error?: string;
  };
};

export type Op = {
  id: number;
  op: 'move' | 'delete' | 'rmdir';
  src: string;
  dst?: string;
  size?: number;
  note?: string;
};

export type Result = Op & { success: boolean; error?: string };

export type CleanupItem = { path: string; kind: 'file' | 'dir'; size?: number };

export type StorageDrive = {
  label: string;
  path: string;
  highlight: boolean;
  free: number;
  total: number;
  used: number;
  error?: string;
};

export type StorageBreakdownItem = {
  label: string;
  path: string;
  size: number;
  error?: string;
};

export type StorageBreakdown = {
  drive: string;
  items: StorageBreakdownItem[];
};

export type StorageSnapshot = {
  drives?: StorageDrive[];
  breakdowns?: StorageBreakdown[];
  computed_at?: string;
  duration_ms?: number;
  refreshing: boolean;
};

export type GroupedSample = { path: string; name: string; size: number };

export type GroupedFolder = {
  name: string;
  path: string;
  video_count: number;
  total_size: number;
  mtime: number;
  samples: GroupedSample[];
};

export type GroupedSnapshot = {
  folders: GroupedFolder[];
  computed_at: string;
  duration_ms: number;
};

export type GroupedVideo = {
  path: string;
  name: string;
  rel: string;
  size: number;
  mtime: number;
};

export type GroupedFolderDetail = {
  folder: string;
  name: string;
  videos: GroupedVideo[];
  total: number;
  total_size: number;
};

export type ThumbPurge = {
  dry_run: boolean;
  live_videos: number;
  orphan_dirs?: number;
  orphan_bytes?: number;
  removed_dirs?: number;
  freed_bytes?: number;
  duration_ms: number;
};

export type TopVideo = { path: string; name: string; size: number; mtime: number };

export type TopVideos = {
  videos: TopVideo[];
  total: number;
  initial_frames: number;
  max_frames: number;
};

export type Decision = 'keep' | 'delete';

async function req<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  status: () => req<Status>('/api/status'),
  destinations: () => req<{ destinations: string[] }>('/api/destinations'),
  startScan: () => req<{ status: string }>('/api/scan', { method: 'POST' }),
  scanProgress: () => req<Status['scan_progress']>('/api/scan/progress'),
  applyProgress: () => req<ApplyProgress>('/api/apply/progress'),
  listFiles: (status: string) =>
    req<{ files: FileRecord[]; total: number }>(
      `/api/files?status=${encodeURIComponent(status)}`,
    ),
  updateFile: (id: number, body: { status: string; destination?: string }) =>
    req<{ status: string }>(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  moveToTop: (id: number) =>
    req<Result>(`/api/files/${id}/move-to-top`, { method: 'POST' }),
  applyPreview: (bucket: string, ids?: number[]) =>
    req<{ ops: Op[]; count: number }>('/api/apply/preview', {
      method: 'POST',
      body: JSON.stringify({ bucket, ids }),
    }),
  applyCommit: (bucket: string, ids?: number[]) =>
    req<{ results: Result[]; count: number }>('/api/apply/commit', {
      method: 'POST',
      body: JSON.stringify({ bucket, ids }),
    }),
  cleanupPreview: () =>
    req<{ items: CleanupItem[]; count: number }>('/api/cleanup-nonvideo/preview', { method: 'POST' }),
  cleanupCommit: () =>
    req<{ results: Result[]; count: number }>('/api/cleanup-nonvideo/commit', { method: 'POST' }),
  storage: () => req<StorageSnapshot>('/api/storage'),
  storageRefresh: () =>
    req<{ status: string }>('/api/storage/refresh', { method: 'POST' }),
  exclusions: () => req<{ paths: string[]; count: number }>('/api/exclusions'),

  groupedFolders: (refresh = false) =>
    req<GroupedSnapshot>(`/api/grouped/folders${refresh ? '?refresh=1' : ''}`),
  groupedThumb: (path: string, idx: number) =>
    `/api/grouped/thumb?path=${encodeURIComponent(path)}&idx=${idx}`,
  groupedAction: (path: string, decision: Decision) =>
    req<{ status: string }>('/api/grouped/action', {
      method: 'POST',
      body: JSON.stringify({ path, decision }),
    }),
  groupedVideos: (path: string) =>
    req<GroupedFolderDetail>(`/api/grouped/videos?path=${encodeURIComponent(path)}`),
  groupedDeleteVideo: (path: string) =>
    req<{ status: string }>('/api/grouped/delete-video', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  thumbsPurge: (dry = false) =>
    req<ThumbPurge>(`/api/thumbs/purge${dry ? '?dry=1' : ''}`, { method: 'POST' }),

  topVideos: () => req<TopVideos>('/api/top/videos'),
  topThumb: (path: string, idx: number) =>
    `/api/top/thumb?path=${encodeURIComponent(path)}&idx=${idx}`,
  topDecision: (path: string, decision: Decision) =>
    req<{ status: string }>('/api/top/decision', {
      method: 'POST',
      body: JSON.stringify({ path, decision }),
    }),
};
