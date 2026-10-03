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
