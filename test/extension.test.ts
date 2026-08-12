import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initTheme,
  type ExtensionAPI,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import webfetchExtension from "../extensions/webfetch.ts";

initTheme();

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;
type RenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
const context = { isError: false } as RenderContext;

function registeredTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  webfetchExtension({
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } as unknown as ExtensionAPI);
  assert.ok(tool);
  return tool;
}

function render(component: { render(width: number): string[] }): string {
  return component.render(200).join("\n").trimEnd();
}

test("shows the URL while keeping fetched content collapsed", () => {
  const tool = registeredTool();
  const url = "https://example.com/docs";
  const call = tool.renderCall?.({ url }, theme, context);
  assert.ok(call);
  assert.match(render(call), /webfetch https:\/\/example\.com\/docs/);

  const result = {
    content: [{ type: "text" as const, text: "full fetched content" }],
    details: { url, contentType: "text/plain", format: "text", bytes: 20, truncated: false },
  };
  const collapsed = tool.renderResult?.(
    result,
    { expanded: false, isPartial: false },
    theme,
    context,
  );
  const expanded = tool.renderResult?.(
    result,
    { expanded: true, isPartial: false },
    theme,
    context,
  );
  assert.ok(collapsed);
  assert.ok(expanded);
  assert.doesNotMatch(render(collapsed), /full fetched content/);
  assert.match(render(expanded), /full fetched content/);
});
