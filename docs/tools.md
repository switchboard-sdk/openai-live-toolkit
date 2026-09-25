# Tools

## How tool calls work

GPT-Live doesn't call functions itself. When a request needs work, it delegates to a Responses model (`delegateModel`, `gpt-5.5` by default), which calls your tools. The toolkit runs the handler and returns the result, the delegate finishes, and GPT-Live speaks the outcome. The conversation keeps going while that happens, so a slow handler doesn't freeze the voice.

GPT-Live only delegates work it knows can be done, so the toolkit adds a line naming the registered tools to its instructions, and tells a running session when the set changes. The delegate is told to call the matching tool rather than claim it acted; the provider's `delegateInstructions` are added after that. The delegate only runs, and bills, when the model hands it work.

## `useTool`

```tsx
import { useTool } from '@synervoz/openai-live-toolkit'

useTool({
  name: 'set_background_color',
  description: "Changes the application's background color.",
  parameters: {
    type: 'object',
    properties: { color: { type: 'string' } },
    required: ['color'],
  },
  handler: async ({ color }) => {
    setBackgroundColor(color)
    return { success: true, color }
  },
})
```

The hook registers on mount, unregisters on unmount, and re-registers when `name`, `description` or `parameters` change. `handler` is kept live across renders, so it always sees current state. `parameters` is optional for a no-arg tool. Names must be unique; re-registering a name replaces the tool. Tool changes apply to a running session without restarting it.

## Dynamic tool sets

For tools from config or registered outside render, use `registerTool(tool)` / `unregisterTool(name)` from `useOpenAILiveToolkit()`. You own their lifetime.

## When a handler throws

The error goes back to the model as the tool's result, so it answers without it instead of stalling. Tool failures never reach the hook's `error` state; pass `onError` to the provider to see them:

- `TOOL_HANDLER_FAILED`: a handler threw (or no tool had that name). Already reported to the model.
- `TOOL_RESULT_UNDELIVERED`: the result couldn't reach OpenAI (no session, or a stale call id).
