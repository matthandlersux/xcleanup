import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
import { useCenterActive } from '../hooks/useCenterActive';
import { phone } from '../styles/global';

const Wrap = styled.header`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);

  ${phone} {
    gap: 0;
    padding: 4px 0;
  }
`;

const Brand = styled.div`
  font-weight: 700;
  letter-spacing: 0.6px;
  font-size: 14px;
  color: var(--fg);

  ${phone} {
    display: none;
  }
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

  /* One swipeable row of 40px+ tabs instead of overflowing off the right edge. */
  ${phone} {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 8px;
    &::-webkit-scrollbar {
      display: none;
    }
    a {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      min-height: 40px;
      padding: 0 12px;
      font-size: 13px;
      letter-spacing: 0.3px;
    }
    a:hover {
      text-decoration: none;
    }
  }
`;

export function SectionNav() {
  const navRef = useRef<HTMLElement>(null);
  useCenterActive(navRef);
  return (
    <Wrap>
      <Brand>xcleanup</Brand>
      <Nav ref={navRef}>
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
