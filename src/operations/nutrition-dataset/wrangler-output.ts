/**
 * Reads the JSON that `wrangler d1 execute --json` prints. A remote run can
 * print progress lines (such as "├ Checking if file needs uploading") before
 * the JSON, so parsing starts at the first line that opens an array or an
 * object. Returns the rows of the last result.
 */
export const wranglerRows = (stdout: string): Record<string, unknown>[] => {
  const start = stdout.search(/^[[{]/mu);
  if (start === -1) {
    throw new Error('wrangler d1 execute printed no JSON result.');
  }
  const output: unknown = JSON.parse(stdout.slice(start));
  const results = Array.isArray(output) ? output : [output];
  const last = results.at(-1) as
    { results?: Record<string, unknown>[] } | undefined;
  return last?.results ?? [];
};
