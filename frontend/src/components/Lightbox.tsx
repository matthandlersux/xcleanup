import { ReactNode, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';

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
`;

const Subtitle = styled.div`
  color: var(--fg-dim);
  font-size: 12px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Stage = styled.div`
  position: relative;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 64px;
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
`;

const Foot = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  flex-wrap: wrap;
`;

const Dots = styled.div`
  display: flex;
  gap: 6px;
  flex: 1;
`;

const Dot = styled.button<{ $active: boolean }>`
  width: 10px;
  height: 10px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: ${(p) => (p.$active ? 'var(--accent)' : 'rgba(255,255,255,0.3)')};
`;

const Hint = styled.div`
  color: var(--fg-dim);
  font-size: 11px;
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

      <Stage onClick={(e) => e.stopPropagation()}>
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
        <Hint>
          ← → frames{onNextItem ? ' · ↑ ↓ videos' : ''} · Esc close
        </Hint>
      </Foot>
    </Overlay>,
    document.body,
  );
}
