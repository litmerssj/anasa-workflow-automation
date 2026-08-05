import assert from "node:assert/strict";
import test from "node:test";

import { resolveLabelIdsFromSource } from "../lib/linear.ts";

test("missing workflow labels are created before their ids are returned", async () => {
  const created: string[] = [];
  const ids = await resolveLabelIdsFromSource(
    ["고객보드", "QA대기", "QA중"],
    {
      listLabels: async () => [{ id: "customer", name: "고객보드" }],
      createLabel: async (name: string) => {
        created.push(name);
        return { id: `new-${name}`, name };
      },
    },
  );

  assert.deepEqual(created, ["QA대기", "QA중"]);
  assert.deepEqual(ids, ["customer", "new-QA대기", "new-QA중"]);
});
