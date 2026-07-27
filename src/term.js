/**
 * term.js — raw-mode terminal primitives. No dependencies: pi-switch has to keep
 * working when node_modules is in whatever state a broken pi install left it.
 */

import { emitKeypressEvents } from "node:readline";

const ESC = "\x1b[";

export const color = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
  invert: "\x1b[7m",
};

export function paint(text, ...styles) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return String(text);
  return styles.join("") + text + color.reset;
}

export const out = s => process.stdout.write(s);

export const screen = {
  enter: () => out(`${ESC}?1049h${ESC}?25l`),
  leave: () => out(`${ESC}?25h${ESC}?1049l`),
  clear: () => out(`${ESC}2J${ESC}H`),
  home: () => out(`${ESC}H`),
};

export function size() {
  return { rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 };
}

/** Visible width, ignoring ANSI escapes and counting CJK as two columns. */
export function width(text) {
  const plain = String(text).replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff)
  );
}

/** Pad to a visible width. */
export function pad(text, target) {
  const gap = target - width(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

/** Truncate to a visible width, adding an ellipsis when it does not fit. */
export function truncate(text, max) {
  if (max <= 0) return "";
  if (width(text) <= max) return text;
  let acc = "";
  for (const ch of String(text).replace(/\x1b\[[0-9;]*m/g, "")) {
    if (width(acc + ch) > max - 1) break;
    acc += ch;
  }
  return `${acc}…`;
}

/**
 * Start listening for keypresses. Returns a stop() that restores whatever state
 * the tty was in beforehand.
 *
 * The restore has to be conditional: these listeners nest (the main loop is
 * running when pause() opens its own), and unconditionally pausing stdin on
 * teardown would leave the outer loop attached to a paused stream — no further
 * keys, no way out.
 */
export function keys(onKey) {
  const { stdin } = process;
  const wasRaw = Boolean(stdin.isRaw);
  const wasPaused = stdin.isPaused();
  emitKeypressEvents(stdin);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  const handler = (str, key) => onKey({ ...key, str });
  stdin.on("keypress", handler);
  return () => {
    stdin.off("keypress", handler);
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    if (wasPaused) stdin.pause();
  };
}

/** Read a line of input with the screen in cooked mode (for prompts). */
export function prompt(question, { defaultValue = "", mask = false } = {}) {
  return new Promise(resolve => {
    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    emitKeypressEvents(stdin);

    let value = "";
    const render = () => {
      const shown = mask ? "•".repeat(value.length) : value;
      const hint = defaultValue && !value ? paint(` [${defaultValue}]`, color.grey) : "";
      out(`\r${ESC}2K${question}${hint}: ${shown}`);
    };

    const onKey = (str, key) => {
      if (key?.name === "return" || key?.name === "enter") {
        stdin.off("keypress", onKey);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        out("\n");
        resolve(value || defaultValue);
        return;
      }
      if (key?.ctrl && (key.name === "c" || key.name === "d")) {
        stdin.off("keypress", onKey);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        out("\n");
        resolve(null);
        return;
      }
      if (key?.name === "escape") {
        stdin.off("keypress", onKey);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        out("\n");
        resolve(null);
        return;
      }
      if (key?.name === "backspace") {
        value = value.slice(0, -1);
      } else if (key?.ctrl && key.name === "u") {
        value = "";
      } else if (str && !key?.ctrl && !key?.meta && str >= " ") {
        value += str;
      }
      render();
    };

    stdin.on("keypress", onKey);
    render();
  });
}

/** Yes/no confirmation. Returns false on escape. */
export async function confirm(question, { defaultYes = false } = {}) {
  const answer = await prompt(`${question} ${defaultYes ? "(Y/n)" : "(y/N)"}`, {});
  if (answer === null) return false;
  const v = answer.trim().toLowerCase();
  if (!v) return defaultYes;
  return v === "y" || v === "yes";
}

/** A single-keystroke pause. */
export function pause(message = "press any key") {
  return new Promise(resolve => {
    out(`\n${paint(message, color.grey)}`);
    const stop = keys(() => {
      stop();
      out("\n");
      resolve();
    });
  });
}

export const glyph = {
  on: "●",
  off: "○",
  ok: "✓",
  bad: "✗",
  warn: "!",
  arrow: "›",
};
