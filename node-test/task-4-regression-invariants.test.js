import { assert } from "chai";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const EVIDENCE_OK = "/home/chenweilun/.sisyphus/evidence/task-4-multimodal.txt";
const EVIDENCE_ERR =
  "/home/chenweilun/.sisyphus/evidence/task-4-multimodal-error.txt";
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

describe("task-4 regression invariants: images, attachments, history order", function () {
  it("locks buildMessages multimodal parts ordering and message ordering", async function () {
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
    const historyPushIdx =
      indexOrThrow(buildMessagesBlock, "messages.push(...params.history)") +
      buildMessagesFnIdx;

    const userRoleIndicesLocal = allIndicesOf(buildMessagesBlock, 'role: "user"');
    assert.isAtLeast(
      userRoleIndicesLocal.length,
      2,
      'expected both image and non-image user message branches to exist (role: "user")',
    );
    const userRoleIndices = userRoleIndicesLocal.map((idx) => idx + buildMessagesFnIdx);
    const minUserRoleIdx = Math.min(...userRoleIndices);
    const maxUserRoleIdx = Math.max(...userRoleIndices);

    assert.isTrue(
      historyPushIdx < minUserRoleIdx,
      "expected history insertion to occur before any user message push",
    );
    assert.isTrue(
      historyPushIdx < maxUserRoleIdx,
      "expected history insertion to occur before the final user message",
    );

    const systemRoleCount =
      (buildMessagesBlock.match(/role:\s*"system"/g) || []).length;
    assert.equal(
      systemRoleCount,
      1,
      "expected exactly 1 system-role message (system must remain first)",
    );

    const textPartNeedle = '{ type: "text", text: params.prompt }';
    const textPartIdx =
      indexOrThrow(buildMessagesBlock, textPartNeedle) + buildMessagesFnIdx;
    const imageTypeIdx =
      indexOrThrow(buildMessagesBlock, 'type: "image_url"') + buildMessagesFnIdx;
    const highDetailIdx =
      indexOrThrow(buildMessagesBlock, 'detail: "high"') + buildMessagesFnIdx;

    assert.isTrue(
      textPartIdx < imageTypeIdx,
      "expected multimodal content parts to be text-first, then image_url parts",
    );
    assert.isTrue(
      imageTypeIdx < highDetailIdx,
      'expected image_url parts to include detail: "high"',
    );

    await mkdir(EVIDENCE_DIR, { recursive: true });

    const evidenceOk = [
      "Task 4: regression invariants locked via source inspection",
      "",
      "Assertions (must remain true):",
      "- system message remains first and there is only one system-role message",
      "- history is inserted before the final user message",
      "- multimodal user content uses text-first then image_url parts with detail=high",
      "",
      "Source anchors:",
      `- ${llmClientPath}:${lineNumberAt(llmClientText, initIdx)} system init`,
      `- ${llmClientPath}:${lineNumberAt(llmClientText, historyPushIdx)} history push`,
      `- ${llmClientPath}:${lineNumberAt(llmClientText, minUserRoleIdx)} first user message branch`,
      `- ${llmClientPath}:${lineNumberAt(llmClientText, maxUserRoleIdx)} second user message branch`,
      `- ${llmClientPath}:${lineNumberAt(llmClientText, textPartIdx)} text part (multimodal)`,
      `- ${llmClientPath}:${lineNumberAt(llmClientText, imageTypeIdx)} image_url part (multimodal)`,
      `- ${llmClientPath}:${lineNumberAt(llmClientText, highDetailIdx)} detail=high (multimodal)`,
      "",
    ].join("\n");

    await writeFile(EVIDENCE_OK, evidenceOk, "utf-8");
  });

  it("locks attachment append semantics for Responses API input (final user message only)", async function () {
    const llmClientPath = "src/utils/llmClient.ts";
    const llmClientText = await readFile(llmClientPath, "utf-8");

    const { block: responsesBlock, startIdx: responsesFnIdx } = sliceFunctionBlock({
      text: llmClientText,
      startNeedle: "function buildResponsesInput",
      endNeedle: "return {\n    instructions",
    });

    const appendFilesNeedle = "const appendFilesToMessage";
    const appendFilesIdx =
      indexOrThrow(responsesBlock, appendFilesNeedle) + responsesFnIdx;

    const messageRoleIdx =
      indexOrThrow(responsesBlock, 'message.role === "user"') + responsesFnIdx;
    const lastMessageIdx =
      indexOrThrow(responsesBlock, "index === messages.length - 1") + responsesFnIdx;
    const fileIdsIdx =
      indexOrThrow(responsesBlock, "normalizedFileIds.length > 0") + responsesFnIdx;

    assert.isTrue(
      appendFilesIdx < messageRoleIdx,
      "expected appendFilesToMessage to gate on user role",
    );
    assert.isTrue(
      messageRoleIdx < lastMessageIdx,
      "expected file append to apply only to the final message",
    );
    assert.isTrue(
      lastMessageIdx < fileIdsIdx,
      "expected file append to require at least one normalized file id",
    );

    const mapLocalIdx = indexOrThrow(responsesBlock, "message.content.map");
    const mapIdx = mapLocalIdx + responsesFnIdx;
    const inputFileTypeLocalIdx = responsesBlock.indexOf(
      'type: "input_file"',
      mapLocalIdx,
    );
    assert.notEqual(
      inputFileTypeLocalIdx,
      -1,
      "expected to find input_file append after content mapping",
    );
    const inputFileTypeIdx = inputFileTypeLocalIdx + responsesFnIdx;
    assert.isTrue(
      mapIdx < inputFileTypeIdx,
      "expected input_file parts to be appended after existing text/image content",
    );
  });

  it("writes a short note describing what would fail on ordering regressions", async function () {
    await mkdir(EVIDENCE_DIR, { recursive: true });
    const note = [
      "If ordering regresses, task-4 will fail with one of:",
      "- history inserted after the user message (historyPushIdx >= userRoleIdx)",
      "- a second system-role message appears inside buildMessages (systemRoleCount != 1)",
      "- multimodal parts are not text-first or omit detail=high",
      "- Responses API file attachments are appended to a non-final message or before text/images",
      "",
    ].join("\n");
    await writeFile(EVIDENCE_ERR, note, "utf-8");
  });
});
