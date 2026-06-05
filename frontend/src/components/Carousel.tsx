import { useState } from 'react';
import styled from 'styled-components';

const FRAME_COUNT = 3;

const Wrap = styled.div`
  position: relative;
  width: 320px;
  height: 180px;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
  user-select: none;
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
`;

export function Carousel({ id }: { id: number }) {
  const [idx, setIdx] = useState(0);
  const step = (delta: number) => setIdx((prev) => (prev + delta + FRAME_COUNT) % FRAME_COUNT);
  return (
    <Wrap>
      <Img src={`/api/thumb/${id}/${idx}.jpg`} alt="" loading="lazy" draggable={false} />
      <Arrow
        $side="left"
        onClick={(e) => {
          e.preventDefault();
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
              setIdx(i);
            }}
            aria-label={`Frame ${i + 1}`}
          />
        ))}
      </Dots>
    </Wrap>
  );
}
