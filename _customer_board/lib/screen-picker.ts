export type Screen = {
  code: string;
  module: string;
  name: string;
  file: string;
};

export const MODULE_KR: Record<string, string> = {
  BAS: "기준정보",
  PUR: "구매",
  PDT: "생산",
  LOG: "물류",
  SAL: "영업",
  QC: "품질",
  ORD: "웹발주",
  TO: "공구",
  COM: "공통",
};

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, "");
}

export function moduleCounts(screens: readonly Screen[]): Record<string, number> {
  return screens.reduce<Record<string, number>>((counts, screen) => {
    counts[screen.module] = (counts[screen.module] ?? 0) + 1;
    return counts;
  }, {});
}

export function filterScreens(
  screens: readonly Screen[],
  filters: { query: string; module: string },
): Screen[] {
  const query = normalized(filters.query);
  return screens.filter((screen) => {
    if (filters.module !== "ALL" && screen.module !== filters.module) return false;
    if (!query) return true;
    return normalized(`${screen.code}${screen.name}`).includes(query);
  });
}

export function updateRecentCodes(
  current: readonly string[],
  selectedCode: string,
  limit = 5,
): string[] {
  return [selectedCode, ...current.filter((code) => code !== selectedCode)].slice(0, limit);
}
