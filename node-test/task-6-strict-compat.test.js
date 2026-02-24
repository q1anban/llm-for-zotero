import { assert } from "chai";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const EVIDENCE_OK =
  "/home/chenweilun/.sisyphus/evidence/task-6-strict-compat.txt";
const EVIDENCE_ERR =
  "/home/chenweilun/.sisyphus/evidence/task-6-strict-compat-error.txt";
const EVIDENCE_DIR = "/home/chenweilun/.sisyphus/evidence";

function indexOrThrow(haystack, needle) {
  const idx = haystack.indexOf(needle);
  assert.notEqual(idx, -1, `expected to find: ${needle}`);
  return idx;
}

function allIndicesOf(haystack, needle) {
  const out = [];
  let cursor = 0;
  while (cursor < haystack.length) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx === -1) break;
    out.push(idx);
    cursor = idx + Math.max(1, needle.length);
  }
  return out;
}

function lineNumberAt(text, index) {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

function sliceFunctionBlock({ text, startNeedle, endNeedle }) {
  const startIdx = indexOrThrow(text, startNeedle);
  const endIdx = text.indexOf(endNeedle, startIdx);
  assert.notEqual(endIdx, -1, `expected to find: ${endNeedle}`);
  return { block: text.slice(startIdx, endIdx), startIdx };
}

describe("task-6 strict-backend compatibility proof: system-role ordering", function () {
  it("fails if buildMessages ever places system-role after history/user content", async function () {
    const llmClientPath = "src/utils/llmClient.ts";
    const llmClientText = await readFile(llmClientPath, "utf-8");

    const { block: buildMessagesBlock, startIdx: buildMessagesFnIdx } =
      sliceFunctionBlock({
        text: llmClientText,
        startNeedle: "function buildMessages",
        endNeedle: "return messages",
      });

    const initNeedle =
      'const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];';
    const initIdx = indexOrThrow(buildMessagesBlock, initNeedle) + buildMessagesFnIdx;

    const historyPushLocalIdx = indexOrThrow(
      buildMessagesBlock,
      "messages.push(...params.history)",
    );
    const historyPushIdx = historyPushLocalIdx + buildMessagesFnIdx;

    const systemRoleIndicesLocal = allIndicesOf(
      buildMessagesBlock,
      'role: "system"',
    );
    assert.isAtLeast(
      systemRoleIndicesLocal.length,
      1,
      "expected at least one system-role message inside buildMessages",
    );
    const systemRoleIndices = systemRoleIndicesLocal.map(
      (idx) => idx + buildMessagesFnIdx,
    );
    const maxSystemRoleIdx = Math.max(...systemRoleIndices);

    const nonSystemRoleIndicesLocal = [
      ...allIndicesOf(buildMessagesBlock, 'role: "user"'),
      ...allIndicesOf(buildMessagesBlock, 'role: "assistant"'),
    ];
    assert.isAtLeast(
      nonSystemRoleIndicesLocal.length,
      1,
      "expected at least one non-system role branch inside buildMessages",
    );
    const nonSystemRoleIndices = nonSystemRoleIndicesLocal.map(
      (idx) => idx + buildMessagesFnIdx,
    );
    const minNonSystemRoleIdx = Math.min(...nonSystemRoleIndices);

    assert.isTrue(
      maxSystemRoleIdx < historyPushIdx,
      "expected all system-role occurrences to appear before history insertion",
    );
    assert.isTrue(
      maxSystemRoleIdx < minNonSystemRoleIdx,
      'expected no role: "system" to appear after any non-system role literal',
    );

    const afterHistoryBlock = buildMessagesBlock.slice(historyPushLocalIdx);
    const systemRoleCountAfterHistory =
      (afterHistoryBlock.match(/role:\s*"system"/g) || []).length;
    assert.equal(
      systemRoleCountAfterHistory,
      0,
      "expected zero system-role occurrences after history insertion",
    );

    await mkdir(EVIDENCE_DIR, { recursive: true });

    const evidenceOk = [
      "Task 6: strict-backend compatibility locked via source inspection",
      "",
      "Assertions (must remain true):",
      "- all system-role occurrences remain strictly before history insertion",
      "- all system-role occurrences remain strictly before any user/assistant branch",
      "- no role=system literals occur after the history push",
      "",
      "Source anchors:",
      `- ${llmClientPath}:${lineNumberAt(llmClientText, initIdx)} system init`,
      `- ${llmClientPath}:${lineNumberAt(llmClientText, historyPushIdx)} history push`,
      `- ${llmClientPath}:${lineNumberAt(llmClientText, minNonSystemRoleIdx)} first non-system role literal`,
      "",
    ].join("\n");

    await writeFile(EVIDENCE_OK, evidenceOk, "utf-8");
  });

  it("writes a short note describing what would fail on strict ordering regressions", async function () {
    await mkdir(EVIDENCE_DIR, { recursive: true });
    const note = [
      "If strict-backend ordering regresses, task-6 will fail with one of:",
      "- a new role=system literal appears after history insertion (systemRoleCountAfterHistory != 0)",
      "- buildMessages moves system-role creation below history insertion (maxSystemRoleIdx >= historyPushIdx)",
      "- buildMessages introduces a system-role literal after any user/assistant branch (maxSystemRoleIdx >= minNonSystemRoleIdx)",
      "",
      "Why this matters: strict OpenAI-compatible backends reject system messages that are not at the beginning.",
      "",
    ].join("\n");
    await writeFile(EVIDENCE_ERR, note, "utf-8");
  });
});
