export function quoteShellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

