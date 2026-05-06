export function sanitizeRepoName(repoName) {
  const slug = repoName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'repo';
}

export function buildSessionId({ agent, repoName, date = new Date() }) {
  const safeAgent = sanitizeRepoName(agent);
  const safeRepo = sanitizeRepoName(repoName);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');

  return `${safeAgent}__${safeRepo}__${month}${day}-${hour}${minute}`;
}

