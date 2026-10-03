const wrap = (code: string) => (s: string | number) => `\x1b[${code}m${s}\x1b[0m`;

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  italic: wrap('3'),
  red: wrap('91'),
  green: wrap('92'),
  yellow: wrap('93'),
  blue: wrap('94'),
  magenta: wrap('95'),
  cyan: wrap('96'),
};

export const BANNER = [
  ' ___ ____ _____ ____  ____  _____    _    _  _______ ____',
  '|_ _/ ___| ____| __ )|  _ \\| ____|  / \\  | |/ / ____|  _ \\',
  ' | | |   |  _| |  _ \\| |_) |  _|   / _ \\ | \' /|  _| | |_) |',
  ' | | |___| |___| |_) |  _ <| |___ / ___ \\| . \\| |___|  _ <',
  '|___\\____|_____|____/|_| \\_\\_____/_/   \\_\\_|\\_\\_____|_| \\_\\',
]
  // "ICE" in cyan, "BREAKER" in magenta. B starts at column 15 in every row.
  .map((line) => c.cyan(line.slice(0, 15)) + c.magenta(line.slice(15)))
  .join('\n');
