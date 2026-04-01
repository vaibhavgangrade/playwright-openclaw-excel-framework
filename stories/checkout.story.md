# Walmart Checkout Flow

## User Story
As a shopper, I want to search products on Walmart, add an item to cart, and validate cart details.

## Acceptance Criteria
- Navigate to {{baseUrl}}
- Search for {{product_name}}
- Add {{IndexVal}} item to cart


## Test Data
- username: env:QA_USER
- password: env:QA_PASSWORD
- baseUrl: https://www.walmart.com/
- cartUrl: https://www.walmart.com/cart
- product_name: ipad green yellow blue
- IndexVal: 2

## Notes
- Do not use raw credentials in test steps.
- Prefer accessibility locators first.
