# QA Practice UI Intents

## User Story
As a user, I want to validate Text Input, Button, and Checkbox interactions on the QA Practice site.

## Acceptance Criteria
* Navigate to the base URL.
* Click on Text Input on the page.
* Insert text Vaibhav into the Submit me input box and press Enter.
* Click on Buttons text on the left sidebar.
* Press the Click button on the page.
* Click on Checkbox text on the left sidebar.
* Select the Select me or not checkbox on the page.
<!-- - Navigate to {{cartUrl}} -->
<!-- - Verify text Shopping Cart on page
- Verify text Subtotal on page -->



## Test Data
- username: env:QA_USER
- password: env:QA_PASSWORD

## Notes
- Do not use raw credentials in test steps.
- Prefer accessibility locators first.
