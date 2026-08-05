import assert from "node:assert/strict";
import test from "node:test";

import {
  filterScreens,
  moduleCounts,
  updateRecentCodes,
  type Screen,
} from "../lib/screen-picker.ts";

const SCREENS: Screen[] = [
  { code: "ORD-SGP-003M", module: "ORD", name: "주문상태확인", file: "ord.png" },
  { code: "ORD-SGT-004M", module: "ORD", name: "현장이동신청", file: "move.png" },
  { code: "LOG_OUT_001M", module: "LOG", name: "출고처리", file: "log.png" },
  { code: "PDT-OSC-003M", module: "PDT", name: "원부자재입고현황", file: "pdt.png" },
];

test("moduleCounts counts screens per module without changing input", () => {
  const before = structuredClone(SCREENS);

  assert.deepEqual(moduleCounts(SCREENS), { ORD: 2, LOG: 1, PDT: 1 });
  assert.deepEqual(SCREENS, before);
});

test("filterScreens searches screen codes case-insensitively", () => {
  assert.deepEqual(
    filterScreens(SCREENS, { query: "ord-sgp", module: "ALL" }).map((screen) => screen.code),
    ["ORD-SGP-003M"],
  );
});

test("filterScreens searches Korean screen names while ignoring spaces", () => {
  assert.deepEqual(
    filterScreens(SCREENS, { query: "주문 상태", module: "ALL" }).map((screen) => screen.code),
    ["ORD-SGP-003M"],
  );
});

test("filterScreens limits results to the selected module", () => {
  assert.deepEqual(
    filterScreens(SCREENS, { query: "", module: "LOG" }).map((screen) => screen.code),
    ["LOG_OUT_001M"],
  );
});

test("updateRecentCodes moves the latest unique code to the front and keeps five", () => {
  assert.deepEqual(
    updateRecentCodes(["A", "B", "C", "D", "E"], "C"),
    ["C", "A", "B", "D", "E"],
  );
  assert.deepEqual(
    updateRecentCodes(["A", "B", "C", "D", "E"], "F"),
    ["F", "A", "B", "C", "D"],
  );
});
