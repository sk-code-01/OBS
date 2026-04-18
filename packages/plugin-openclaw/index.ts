import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { DEFAULT_SDK_VERSION, resolveClawObsPluginConfig } from "./src/config.js";
import { ClawObsRuntime, createClawObsService } from "./src/runtime.js";

export default definePluginEntry({
  id: "clawobs",
  name: "ClawObs",
  description: "Send OpenClaw traces, LLM calls, tools, and session lifecycle events to ClawObs.",
  register(api) {
    const config = resolveClawObsPluginConfig(api.pluginConfig, process.env, DEFAULT_SDK_VERSION);
    const runtime = new ClawObsRuntime({
      config,
      logger: api.logger,
    });

    api.registerService(createClawObsService(runtime));

    api.on("before_agent_start", (event, ctx) => {
      runtime.onBeforeAgentStart(event, ctx);
    });
    api.on("llm_input", (event, ctx) => {
      runtime.onLlmInput(event, ctx);
    });
    api.on("llm_output", (event, ctx) => {
      runtime.onLlmOutput(event, ctx);
    });
    api.on("before_tool_call", (event, ctx) => {
      runtime.onBeforeToolCall(event, ctx);
    });
    api.on("after_tool_call", (event, ctx) => {
      runtime.onAfterToolCall(event, ctx);
    });
    api.on("agent_end", (event, ctx) => {
      runtime.onAgentEnd(event, ctx);
    });
    api.on("session_start", (event, ctx) => {
      runtime.onSessionStart(event, ctx);
    });
    api.on("session_end", (event, ctx) => {
      runtime.onSessionEnd(event, ctx);
    });
    api.on("before_dispatch", (event, ctx) => {
      runtime.onBeforeDispatch(event, ctx);
    });
  },
});

export { ClawObsRuntime, createClawObsService } from "./src/runtime.js";
export {
  DEFAULT_SDK_VERSION,
  isClawObsEnabled,
  resolveClawObsPluginConfig,
  type ClawObsPluginConfig,
} from "./src/config.js";
