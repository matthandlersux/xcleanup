import { NavLink } from 'react-router-dom';
import styled from 'styled-components';

const Wrap = styled.header`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
`;

const Brand = styled.div`
  font-weight: 700;
  letter-spacing: 0.6px;
  font-size: 14px;
  color: var(--fg);
`;

const Nav = styled.nav`
  display: flex;
  gap: 4px;
  a {
    color: var(--fg-dim);
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 12px;
    letter-spacing: 0.5px;
  }
  a.active {
    color: var(--fg);
    background: var(--bg-elev);
    border-color: var(--border);
  }
`;

export function SectionNav() {
  return (
    <Wrap>
      <Brand>xcleanup</Brand>
      <Nav>
        <NavLink to="/archive" className={({ isActive }) => (isActive ? 'active' : '')}>
          Archive
        </NavLink>
        <NavLink to="/grouped" className={({ isActive }) => (isActive ? 'active' : '')}>
          Grouped
        </NavLink>
        <NavLink to="/top" className={({ isActive }) => (isActive ? 'active' : '')}>
          Top
        </NavLink>
        <NavLink to="/vr" className={({ isActive }) => (isActive ? 'active' : '')}>
          VR
        </NavLink>
        <NavLink to="/overview" className={({ isActive }) => (isActive ? 'active' : '')}>
          Overview
        </NavLink>
      </Nav>
    </Wrap>
  );
}
