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
  deleted: number;
  thumbs: { index: number; videoId: number }[];
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

const api = {
  async scanFolder(path: string): Promise<ScanResult> {
    const res = await fetch('/api/folders/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    return res.json();
  },

  async getFolders(): Promise<Folder[]> {
    return (await fetch('/api/folders')).json();
  },

  async getVideos(folderId?: number, page = 1, limit = 50): Promise<VideoListResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (folderId) params.set('folderId', String(folderId));
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

  async getSettings(): Promise<Record<string, string>> {
    return (await fetch('/api/settings')).json();
  },

  thumbUrl(videoId: number, index: number) {
    return `/thumbs/${videoId}/${index}.jpg`;
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
