// A player's own ChatKHU API key: how it travels (one request header) and what one can look like. Shared by the
// game and the hint Worker, so no browser APIs here (the browser side keeps it: ui/keyStorage.ts).

/** The header the game sends a player's own key in, on each /api/hint call. The Worker never stores or logs it. */
export const KEY_HEADER = 'x-chatkhu-key';

/** A key is one run of printable characters, no spaces (a pasted line break or quote is not part of it). */
export const isKeyShape = (key: string): boolean => /^[\x21-\x7e]{8,256}$/.test(key);

/** What a pasted key becomes: surrounding spaces, line breaks and quotes dropped. */
export const cleanKey = (raw: string): string => raw.trim().replace(/^["']+|["']+$/g, '');
