import { Routes, Route, Navigate } from 'react-router-dom';
import styled from 'styled-components';
import { SectionNav } from './components/SectionNav';
import { Archive } from './pages/Archive';
import { Grouped } from './pages/Grouped';
import { TopReview } from './pages/TopReview';
import { Vr } from './pages/Vr';
import { Overview } from './pages/Overview';

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
`;

export function App() {
  return (
    <Layout>
      <SectionNav />
      <Body>
        <Routes>
          <Route path="/" element={<Navigate to="/archive" replace />} />
          <Route path="/archive/*" element={<Archive />} />
          <Route path="/grouped" element={<Grouped />} />
          <Route path="/top" element={<TopReview />} />
          <Route path="/vr/*" element={<Vr />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="*" element={<Navigate to="/archive" replace />} />
        </Routes>
      </Body>
    </Layout>
  );
}
