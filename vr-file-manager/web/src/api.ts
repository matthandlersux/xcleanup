export interface Video {
  id: number;
  folder_id: number;
  filename: string;
  path: string;
  size_bytes: number | null;
  duration_secs: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  created_at: string;
  stereo_mode: 'sbs' | 'tb';
  thumb_hash: string | null;
  folder_path: string;
  deleted: number;
  thumbs: ThumbInfo[];
}

export interface ThumbInfo {
  index: number;
  videoId: number;
  thumb_hash: string | null;
  timestamp_secs: number;
}

export interface VideoListResponse {
  videos: Video[];
  total: number;
  page: number;
  limit: number;
}

export interface Folder {
  id: number;
  path: string;
  last_scanned_at: string;
}

export interface ScanResult {
  folderId: number;
  total: number;
  newVideos: number;
  removed: number;
}

export type SortField = 'filename' | 'path' | 'size_bytes' | 'created_at';
export type SortOrder = 'asc' | 'desc';

const api = {
  async scanFolder(path: string): Promise<ScanResult> {
    const res = await fetch('/api/folders/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Scan failed' }));
      throw new Error(err.error || 'Scan failed');
    }
    return res.json();
  },

  async autoScan(): Promise<ScanResult | null> {
    const res = await fetch('/api/folders/auto-scan', { method: 'POST' });
    if (!res.ok) return null;
    return res.json();
  },

  async getFolders(): Promise<Folder[]> {
    return (await fetch('/api/folders')).json();
  },

  async getVideos(folderId?: number, page = 1, limit = 50, sort?: SortField, order?: SortOrder): Promise<VideoListResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (folderId) params.set('folderId', String(folderId));
    if (sort) params.set('sort', sort);
    if (order) params.set('order', order);
    return (await fetch(`/api/videos?${params}`)).json();
  },

  async deleteVideo(id: number) {
    return (await fetch(`/api/videos/${id}`, { method: 'DELETE' })).json();
  },

  async renameVideo(id: number, name: string) {
    return (await fetch(`/api/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rename: name }),
    })).json();
  },

  async moveVideo(id: number, moveTo: string) {
    return (await fetch(`/api/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveTo }),
    })).json();
  },

  async setStereoMode(id: number, stereoMode: 'sbs' | 'tb') {
    return (await fetch(`/api/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stereoMode }),
    })).json();
  },

  async requestMoreThumbnails(id: number, count = 15) {
    return (await fetch(`/api/videos/${id}/thumbnails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    })).json();
  },

  async getMoveHistory(): Promise<string[]> {
    return (await fetch('/api/move-history')).json();
  },

  async getSettings(): Promise<Record<string, string>> {
    return (await fetch('/api/settings')).json();
  },

  thumbUrl(thumb: ThumbInfo): string {
    if (thumb.thumb_hash) {
      return `/thumbs/${thumb.thumb_hash}/${thumb.timestamp_secs.toFixed(2)}.jpg`;
    }
    // Legacy fallback
    return `/thumbs/${thumb.videoId}/${thumb.index}.jpg`;
  },

  subscribeEvents(handlers: Record<string, (data: any) => void>): () => void {
    const es = new EventSource('/api/events');
    for (const [event, handler] of Object.entries(handlers)) {
      es.addEventListener(event, (e) => {
        handler(JSON.parse((e as MessageEvent).data));
      });
    }
    return () => es.close();
  },
};

export default api;
