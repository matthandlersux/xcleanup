import { useState } from 'react';
import styled from 'styled-components';
import { touch } from '../styles/global';

export const FRAME_COUNT = 3;

const Wrap = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
  user-select: none;
  cursor: zoom-in;
`;

const Img = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const Arrow = styled.button<{ $side: 'left' | 'right' }>`
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  ${(p) => (p.$side === 'left' ? 'left: 4px;' : 'right: 4px;')}
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border: none;
  font-size: 20px;
  line-height: 1;
  opacity: 0;
  transition: opacity 120ms ease;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  ${Wrap}:hover & {
    opacity: 1;
  }
  &:hover {
    background: rgba(0, 0, 0, 0.8);
  }

  /* No hover on touch screens: keep the arrows visible and finger-sized. */
  ${touch} {
    opacity: 1;
    width: 40px;
    height: 40px;
  }
`;

const Dots = styled.div`
  position: absolute;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
`;

const Dot = styled.button<{ $active: boolean }>`
  width: 8px;
  height: 8px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.6);
  background: ${(p) => (p.$active ? 'var(--accent)' : 'rgba(255, 255, 255, 0.65)')};
  cursor: pointer;
  &:hover {
    background: ${(p) => (p.$active ? 'var(--accent)' : 'rgba(255, 255, 255, 0.95)')};
  }

  ${touch} {
    width: 12px;
    height: 12px;
  }
`;

export function Carousel({ id, onOpen }: { id: number; onOpen?: (idx: number) => void }) {
  const [idx, setIdx] = useState(0);
  const step = (delta: number) => setIdx((prev) => (prev + delta + FRAME_COUNT) % FRAME_COUNT);
  return (
    <Wrap onClick={() => onOpen?.(idx)} title={onOpen ? 'Click to enlarge' : undefined}>
      <Img src={`/api/thumb/${id}/${idx}.jpg`} alt="" loading="lazy" draggable={false} />
      <Arrow
        $side="left"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          step(-1);
        }}
        aria-label="Previous frame"
      >
        ‹
      </Arrow>
      <Arrow
        $side="right"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          step(1);
        }}
        aria-label="Next frame"
      >
        ›
      </Arrow>
      <Dots>
        {Array.from({ length: FRAME_COUNT }).map((_, i) => (
          <Dot
            key={i}
            $active={i === idx}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIdx(i);
            }}
            aria-label={`Frame ${i + 1}`}
          />
        ))}
      </Dots>
    </Wrap>
  );
}
