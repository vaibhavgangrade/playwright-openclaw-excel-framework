# QA-Oracle Plan Draft: QA Practice UI Intents

- Generated at: 2026-03-06T14:33:37.715Z
- Source story file: C:\VaibhavOpenSpec\OpenClaw\playwright-openclaw-excel-framework\stories\checkout.story.md

## Review Notes
- Edit steps below if needed before execution.
- Supported actions: `goto`, `click`, `fill`, `press`, `assertVisible`, `assertUrlIncludes`.
- Use env placeholders for secrets, e.g. `env:QA_USER`, `env:QA_PASSWORD`.
- If multiple matching elements exist, set `target.index` (0-based). Example: 5th match => `index: 4`.

## Human-Readable Steps
1. Navigate to configured base URL [action=goto, target={"type":"url","value":"https://www.qa-practice.com/"}]
2. Expand Single UI Elements menu if collapsed [action=click, target={"type":"text","value":"Single UI Elements"}]
3. Open Inputs page [action=click, target={"type":"role","role":"link","name":"Inputs"}]
4. Open Buttons page [action=click, target={"type":"role","role":"link","name":"Buttons"}]
5. Open Checkbox page [action=click, target={"type":"role","role":"link","name":"Checkbox"}]
6. Open Select page [action=click, target={"type":"role","role":"link","name":"Select"}]
7. Open Text Input page [action=click, target={"type":"role","role":"link","name":"Text Input"}]
8. Verify text vaibhav on page [action=assertVisible, target={"type":"text","value":"vaibhav"}]
9. Open Button page [action=click, target={"type":"role","role":"link","name":"Button"}]
10. Press Click button [action=click, target={"type":"role","role":"button","name":"Click"}]
11. Select checkbox option [action=click, target={"type":"role","role":"checkbox","name":""}]

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
        "text": "the user performs key actions from the story"
      },
      {
        "type": "Then",
        "text": "the expected outcome should be visible"
      }
    ],
    "steps": [
      {
        "name": "Navigate to configured base URL",
        "action": "goto",
        "target": {
          "type": "url",
          "value": "https://www.qa-practice.com/"
        }
      },
      {
        "name": "Expand Single UI Elements menu if collapsed",
        "action": "click",
        "target": {
          "type": "text",
          "value": "Single UI Elements"
        },
        "optional": true
      },
      {
        "name": "Open Inputs page",
        "action": "click",
        "target": {
          "type": "role",
          "role": "link",
          "name": "Inputs"
        }
      },
      {
        "name": "Open Buttons page",
        "action": "click",
        "target": {
          "type": "role",
          "role": "link",
          "name": "Buttons"
        }
      },
      {
        "name": "Open Checkbox page",
        "action": "click",
        "target": {
          "type": "role",
          "role": "link",
          "name": "Checkbox"
        }
      },
      {
        "name": "Open Select page",
        "action": "click",
        "target": {
          "type": "role",
          "role": "link",
          "name": "Select"
        }
      },
      {
        "name": "Open Text Input page",
        "action": "click",
        "target": {
          "type": "role",
          "role": "link",
          "name": "Text Input"
        }
      },
      {
        "name": "Verify text vaibhav on page",
        "action": "assertVisible",
        "target": {
          "type": "text",
          "value": "vaibhav"
        }
      },
      {
        "name": "Open Button page",
        "action": "click",
        "target": {
          "type": "role",
          "role": "link",
          "name": "Button"
        }
      },
      {
        "name": "Press Click button",
        "action": "click",
        "target": {
          "type": "role",
          "role": "button",
          "name": "Click"
        }
      },
      {
        "name": "Select checkbox option",
        "action": "click",
        "target": {
          "type": "role",
          "role": "checkbox",
          "name": ""
        }
      }
    ],
    "fallbackUsed": true
  }
}
```
