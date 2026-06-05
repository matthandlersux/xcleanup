import { Routes, Route, Navigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { FileList } from './FileList';

export function Archive() {
  return (
    <>
      <TopBar />
      <Routes>
        <Route index element={<Navigate to="files/move" replace />} />
        <Route path="files/:status" element={<FileList />} />
        <Route path="*" element={<Navigate to="files/move" replace />} />
      </Routes>
    </>
  );
}
