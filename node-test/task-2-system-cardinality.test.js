import { assert } from "chai";
import { readFile } from "node:fs/promises";

function indexOrThrow(haystack, needle) {
  const idx = haystack.indexOf(needle);
  assert.notEqual(idx, -1, `expected to find: ${needle}`);
  return idx;
}

function sliceBuildMessagesBlock(llmClientText) {
  const fnIdx = indexOrThrow(llmClientText, "function buildMessages");
  const returnIdx = llmClientText.indexOf("return messages", fnIdx);
  assert.notEqual(returnIdx, -1, "expected return messages inside buildMessages");
  return llmClientText.slice(fnIdx, returnIdx);
}

describe("task-2: system-message cardinality + context normalization", function () {
  it('expects buildMessages to create exactly 1 role: "system" message', async function () {
    const llmClientText = await readFile("src/utils/llmClient.ts", "utf-8");
    const buildMessagesBlock = sliceBuildMessagesBlock(llmClientText);

    const systemRoleCount = (buildMessagesBlock.match(/role:\s*"system"/g) || [])
      .length;
    assert.equal(
      systemRoleCount,
      1,
      "expected exactly 1 system-role message (context should be merged into systemPrompt)",
    );
  });

  it("expects context handling to not add a second system message", async function () {
    const llmClientText = await readFile("src/utils/llmClient.ts", "utf-8");
    const buildMessagesBlock = sliceBuildMessagesBlock(llmClientText);

    assert.equal(
      buildMessagesBlock.indexOf("if (params.context"),
      -1,
      "expected buildMessages to avoid checking params.context directly (use normalized context string)",
    );

    const contextDeclIdx = indexOrThrow(buildMessagesBlock, "const context");
    const contextIfIdx = indexOrThrow(buildMessagesBlock, "if (context)");
    const historyIfIdx = indexOrThrow(
      buildMessagesBlock,
      "if (params.history?.length)",
    );
    assert.isTrue(
      contextDeclIdx < contextIfIdx && contextIfIdx < historyIfIdx,
      "expected context handling before history push",
    );

    const contextBlock = buildMessagesBlock.slice(contextIfIdx, historyIfIdx);
    const contextBlockSystemRoleCount =
      (contextBlock.match(/role:\s*"system"/g) || []).length;
    assert.equal(
      contextBlockSystemRoleCount,
      0,
      "expected context handling to avoid pushing a second system-role message",
    );
  });

  it("expects whitespace-only context to be treated as empty (trim)", async function () {
    const llmClientText = await readFile("src/utils/llmClient.ts", "utf-8");
    const buildMessagesBlock = sliceBuildMessagesBlock(llmClientText);

    assert.match(
      buildMessagesBlock,
      /context[^\n]*\.trim\(\)/,
      "expected params.context to be normalized via trim() before use",
    );
  });
});
