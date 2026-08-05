export function issuePrefix(screenCode: string): string {
  return screenCode.split(/[-_]/, 1)[0] || "COM";
}

export function buildIssueTitle(screenCode: string, symptom: string): string {
  return `[${issuePrefix(screenCode)}] ${screenCode} · ${symptom.slice(0, 40)}`;
}
