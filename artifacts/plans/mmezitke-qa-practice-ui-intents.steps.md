# QA-Oracle Plan Draft: QA Practice UI Intents

- Generated at: 2026-03-06T14:23:32.655Z
- Source story file: C:\VaibhavOpenSpec\OpenClaw\playwright-openclaw-excel-framework\stories\checkout.story.md

## Review Notes
- Edit steps below if needed before execution.
- Supported actions: `goto`, `click`, `fill`, `press`, `assertVisible`, `assertUrlIncludes`.
- Use env placeholders for secrets, e.g. `env:QA_USER`, `env:QA_PASSWORD`.
- If multiple matching elements exist, set `target.index` (0-based). Example: 5th match => `index: 4`.

## Human-Readable Steps
1. Navigate to configured base URL [action=goto, target={"type":"url","value":"https://www.qa-practice.com/"}]
2. Open Inputs page [action=click, target={"type":"role","role":"link","name":"Inputs"}]
3. Open Buttons page [action=click, target={"type":"role","role":"link","name":"Buttons"}]
4. Open Checkbox page [action=click, target={"type":"role","role":"link","name":"Checkbox"}]
5. Open Select page [action=click, target={"type":"role","role":"link","name":"Select"}]
6. Open Text Input page [action=click, target={"type":"role","role":"link","name":"Text Input"}]
7. Verify text vaibhav on page [action=assertVisible, target={"type":"text","value":"vaibhav"}]
8. Open Button page [action=click, target={"type":"role","role":"link","name":"Button"}]
9. Press Click button [action=click, target={"type":"role","role":"button","name":"Click"}]
10. Select checkbox option [action=click, target={"type":"role","role":"checkbox","name":""}]

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
