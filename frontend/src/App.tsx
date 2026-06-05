import { Routes, Route, Navigate } from 'react-router-dom';
import styled from 'styled-components';
import { TopBar } from './components/TopBar';
import { FileList } from './pages/FileList';

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`;

const Body = styled.main`
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 16px 20px;
`;

export function App() {
  return (
    <Layout>
      <TopBar />
      <Body>
        <Routes>
          <Route path="/" element={<Navigate to="/files/move" replace />} />
          <Route path="/files/:status" element={<FileList />} />
        </Routes>
      </Body>
    </Layout>
  );
}
