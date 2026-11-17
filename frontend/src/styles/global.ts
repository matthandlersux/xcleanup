import { createGlobalStyle } from 'styled-components';

export const GlobalStyles = createGlobalStyle`
  :root {
    --bg: #0e1014;
    --bg-elev: #161a21;
    --bg-row: #1a1f28;
    --bg-row-hover: #222836;
    --fg: #e5e8ee;
    --fg-dim: #8a93a3;
    --accent: #5b9eff;
    --warn: #f5a524;
    --bad: #ef5a5a;
    --good: #4ade80;
    --border: #262c38;
  }

  *, *::before, *::after { box-sizing: border-box; }

  html, body, #root {
    margin: 0;
    padding: 0;
    height: 100%;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
  }

  button {
    font: inherit;
    color: inherit;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
  }
  button:hover { background: var(--bg-row-hover); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  select, input {
    font: inherit;
    color: inherit;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 8px;
  }

  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

/** Phone-width breakpoint. Mobile tweaks live under this; desktop stays untouched. */
export const phone = '@media (max-width: 640px)';
/** Touch screens (no hover), where hover-only controls must stay visible. */
export const touch = '@media (hover: none)';
