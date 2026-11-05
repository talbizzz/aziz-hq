/** Converts a glob to an anchored RegExp: `*` and `?` stay inside one path segment, `**` crosses directories. */
function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        const prevIsSlashOrStart = i === 0 || pattern[i - 1] === '/';
        if (pattern[i + 2] === '/' && prevIsSlashOrStart) {
          re += '(?:.*/)?'; // "**/": zero or more directories
          i += 2;
        } else if (i + 2 >= pattern.length && pattern[i - 1] === '/') {
          re += '.*'; // trailing "/**": everything below
          i += 1;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export const matchesGlob = (path: string, pattern: string): boolean =>
  globToRegExp(pattern).test(path);
export const matchesAny = (path: string, patterns: string[]): boolean =>
  patterns.some((p) => matchesGlob(path, p));
