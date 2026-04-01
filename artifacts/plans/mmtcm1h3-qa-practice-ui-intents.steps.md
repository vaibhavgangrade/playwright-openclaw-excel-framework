# QA-Oracle Plan Draft: QA Practice UI Intents

- Generated at: 2026-03-16T15:38:44.344Z
- Source story file: C:\VaibhavOpenSpec\OpenClaw\playwright-openclaw-excel-framework\stories\checkout.story.md

## Review Notes
- Edit steps below if needed before execution.
- Supported actions: `goto`, `click`, `fill`, `press`, `assertVisible`, `assertUrlIncludes`.
- Use env placeholders for secrets, e.g. `env:QA_USER`, `env:QA_PASSWORD`.
- If multiple matching elements exist, set `target.index` (0-based). Example: 5th match => `index: 4`.

## Human-Readable Steps
1. Navigate to https://www.amazon.com [action=goto, target={"type":"url","value":"https://www.amazon.com"}, value=""]
2. Search for laptop [action=fill, target={"type":"role","role":"searchbox","name":"Search Amazon"}, value="laptop"]
3. Submit search [action=press, target={"type":"text","value":"Enter"}, value="Enter"]
4. Click first product result [action=click, target={"type":"text","value":"first product result"}, value=""]
5. Add item to cart (2nd match) [action=click, target={"type":"role","role":"button","name":"Add to cart","index":1}, value=""]
6. Verify text Shopping Cart [action=assertVisible, target={"type":"text","value":"Shopping Cart"}, value=""]
7. Verify text Subtotal [action=assertVisible, target={"type":"text","value":"Subtotal"}, value=""]

## Executable Plan JSON
```json
{
  "plan": {
    "storyName": "QA Practice UI Intents",
    "gherkin": [
      {
        "type": "Given",
        "text": "the user is on the target application page"
      },
      {
        "type": "When",
        "text": "the user performs intent-driven actions from acceptance criteria"
      },
      {
        "type": "Then",
        "text": "the expected outcome should be visible"
      }
    ],
    "steps": [
      {
        "name": "Navigate to https://www.amazon.com",
        "action": "goto",
        "target": {
          "type": "url",
          "value": "https://www.amazon.com"
        },
        "value": "",
        "runWhen": "always",
        "optional": false
      },
      {
        "name": "Search for laptop",
        "action": "fill",
        "target": {
          "type": "role",
          "role": "searchbox",
          "name": "Search Amazon"
        },
        "value": "laptop",
        "runWhen": "always",
        "optional": false
      },
      {
        "name": "Submit search",
        "action": "press",
        "target": {
          "type": "text",
          "value": "Enter"
        },
        "value": "Enter",
        "runWhen": "always",
        "optional": false
      },
      {
        "name": "Click first product result",
        "action": "click",
        "target": {
          "type": "text",
          "value": "first product result"
        },
        "value": "",
        "runWhen": "always",
        "optional": false
      },
      {
        "name": "Add item to cart (2nd match)",
        "action": "click",
        "target": {
          "type": "role",
          "role": "button",
          "name": "Add to cart",
          "index": 1
        },
        "value": "",
        "runWhen": "always",
        "optional": false
      },
      {
        "name": "Verify text Shopping Cart",
        "action": "assertVisible",
        "target": {
          "type": "text",
          "value": "Shopping Cart"
        },
        "value": "",
        "runWhen": "always",
        "optional": false
      },
      {
        "name": "Verify text Subtotal",
        "action": "assertVisible",
        "target": {
          "type": "text",
          "value": "Subtotal"
        },
        "value": "",
        "runWhen": "always",
        "optional": false
      }
    ],
    "fallbackUsed": true,
    "intentModeUsed": "agent-first-safe"
  }
}
```
