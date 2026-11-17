import { ReactNode, TouchEvent, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { phone, touch } from '../styles/global';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.92);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  min-width: 0;

  ${phone} {
    gap: 10px;
    padding: 10px 12px;
    padding-top: calc(10px + env(safe-area-inset-top));
    button {
      min-height: 44px;
      flex-shrink: 0;
    }
  }
`;

const Titles = styled.div`
  min-width: 0;
  flex: 1;
`;

const Title = styled.div`
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  /* Phone: long file names get two lines instead of one ellipsised line. */
  ${phone} {
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
`;

const Subtitle = styled.div`
  color: var(--fg-dim);
  font-size: 12px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  ${phone} {
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
`;

const Stage = styled.div`
  position: relative;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 64px;

  /* Phone: image uses the full width; arrows float over it. */
  ${phone} {
    padding: 0;
  }
`;

const Big = styled.img`
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  border-radius: 6px;
`;

const Nav = styled.button<{ $side: 'left' | 'right' }>`
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  ${(p) => (p.$side === 'left' ? 'left: 10px;' : 'right: 10px;')}
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  border: none;
  color: #fff;
  font-size: 26px;
  line-height: 1;

  ${phone} {
    ${(p) => (p.$side === 'left' ? 'left: 6px;' : 'right: 6px;')}
    background: rgba(0, 0, 0, 0.55);
  }
`;

const Foot = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  flex-wrap: wrap;

  /* Phone: dots on their own line, action buttons share a full-width row. */
  ${phone} {
    gap: 8px;
    padding: 10px 12px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
    & > button {
      flex: 1 1 auto;
      min-height: 44px;
    }
  }
`;

const Dots = styled.div`
  display: flex;
  gap: 6px;
  flex: 1;

  ${phone} {
    flex-basis: 100%;
    justify-content: center;
    gap: 4px;
  }
`;

const Dot = styled.button<{ $active: boolean }>`
  width: 10px;
  height: 10px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: ${(p) => (p.$active ? 'var(--accent)' : 'rgba(255,255,255,0.3)')};

  /* Bigger hit area on touch without changing the dot's look. */
  ${touch} {
    width: 24px;
    height: 24px;
    background: transparent;
    position: relative;
    &::after {
      content: '';
      position: absolute;
      inset: 7px;
      border-radius: 50%;
      background: ${(p) => (p.$active ? 'var(--accent)' : 'rgba(255,255,255,0.3)')};
    }
  }
`;

const Hint = styled.div`
  color: var(--fg-dim);
  font-size: 11px;
`;

/* Keyboard shortcuts mean nothing on a phone; swipe hint instead. */
const KeyHint = styled(Hint)`
  ${touch} {
    display: none;
  }
`;

const SwipeHint = styled(Hint)`
  display: none;
  ${touch} {
    display: block;
    flex-basis: 100%;
    text-align: center;
  }
`;

export type LightboxProps = {
  title: string;
  subtitle?: ReactNode;
  /** Builds the image URL for a given frame index. */
  frameSrc: (idx: number) => string;
  frameCount: number;
  frameIdx: number;
  onFrame: (idx: number) => void;
  onPrevItem?: () => void;
  onNextItem?: () => void;
  /** e.g. "12 / 340" — shown in the header. */
  position?: string;
  onClose: () => void;
  /** Buttons rendered in the footer (keep/delete, etc). */
  actions?: ReactNode;
};

export function Lightbox({
  title,
  subtitle,
  frameSrc,
  frameCount,
  frameIdx,
  onFrame,
  onPrevItem,
  onNextItem,
  position,
  onClose,
  actions,
}: LightboxProps) {
  const stepFrame = useCallback(
    (delta: number) => {
      if (frameCount <= 0) return;
      onFrame((frameIdx + delta + frameCount) % frameCount);
    },
    [frameCount, frameIdx, onFrame],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepFrame(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepFrame(1);
          break;
        case 'ArrowUp':
          if (onPrevItem) {
            e.preventDefault();
            onPrevItem();
          }
          break;
        case 'ArrowDown':
          if (onNextItem) {
            e.preventDefault();
            onNextItem();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepFrame, onPrevItem, onNextItem, onClose]);

  // Warm the neighbouring frames so left/right feels instant. Callers pass
  // frameSrc as an inline closure, so depend on the resolved URLs rather than
  // the function identity — otherwise this refires on every render.
  // Touch: swipe left/right for frames, up/down for the next/previous video.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 50) return;
    if (Math.abs(dx) > Math.abs(dy)) stepFrame(dx < 0 ? 1 : -1);
    else if (dy < 0) onNextItem?.();
    else onPrevItem?.();
  };

  const nextSrc = frameCount > 1 ? frameSrc((frameIdx + 1) % frameCount) : '';
  const prevSrc = frameCount > 1 ? frameSrc((frameIdx - 1 + frameCount) % frameCount) : '';
  useEffect(() => {
    for (const src of [nextSrc, prevSrc]) {
      if (!src) continue;
      const img = new Image();
      img.src = src;
    }
  }, [nextSrc, prevSrc]);

  return createPortal(
    <Overlay onClick={onClose}>
      <Head onClick={(e) => e.stopPropagation()}>
        <Titles>
          <Title title={title}>{title}</Title>
          {subtitle && <Subtitle>{subtitle}</Subtitle>}
        </Titles>
        {position && <Hint>{position}</Hint>}
        <button onClick={onClose}>Close ✕</button>
      </Head>

      <Stage onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <Big key={frameSrc(frameIdx)} src={frameSrc(frameIdx)} alt="" draggable={false} />
        {frameCount > 1 && (
          <>
            <Nav $side="left" onClick={() => stepFrame(-1)} aria-label="Previous frame">
              ‹
            </Nav>
            <Nav $side="right" onClick={() => stepFrame(1)} aria-label="Next frame">
              ›
            </Nav>
          </>
        )}
      </Stage>

      <Foot onClick={(e) => e.stopPropagation()}>
        <Dots>
          {Array.from({ length: frameCount }).map((_, i) => (
            <Dot key={i} $active={i === frameIdx} onClick={() => onFrame(i)} aria-label={`Frame ${i + 1}`} />
          ))}
        </Dots>
        {actions}
        <KeyHint>
          ← → frames{onNextItem ? ' · ↑ ↓ videos' : ''} · Esc close
        </KeyHint>
        <SwipeHint>swipe ← → frames{onNextItem ? ' · ↑ ↓ videos' : ''}</SwipeHint>
      </Foot>
    </Overlay>,
    document.body,
  );
}
