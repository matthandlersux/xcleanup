import { ReactNode, useEffect } from 'react';
import styled from 'styled-components';
import { phone } from '../styles/global';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;

  /* Phone: the sheet docks to the bottom edge, within thumb reach. */
  ${phone} {
    align-items: flex-end;
  }
`;

const Sheet = styled.div`
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  width: min(800px, 90vw);
  display: flex;
  flex-direction: column;
  gap: 12px;

  /* Phone: full-width bottom sheet; its list (if any) shrinks and scrolls so
     the header and the action buttons always stay on screen. */
  ${phone} {
    width: 100%;
    max-height: 92vh;
    max-height: 92dvh;
    overflow-y: auto;
    border-radius: 12px 12px 0 0;
    border-bottom: none;
    padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
    p {
      margin: 0;
    }
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  h2 {
    margin: 0;
    font-size: 16px;
  }

  ${phone} {
    gap: 12px;
    h2 {
      font-size: 17px;
    }
    button {
      min-height: 44px;
      flex-shrink: 0;
    }
  }
`;

export const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;

  ${phone} {
    margin-top: 0;
    button {
      flex: 1;
      min-height: 48px;
    }
  }
`;

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Overlay onClick={onClose}>
      <Sheet onClick={(e) => e.stopPropagation()}>
        <Header>
          <h2>{title}</h2>
          <button onClick={onClose}>Close</button>
        </Header>
        {children}
      </Sheet>
    </Overlay>
  );
}
