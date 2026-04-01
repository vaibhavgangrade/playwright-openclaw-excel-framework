export class BasePage {
  constructor(page) {
    this.page = page;
  }

  byTarget(target = {}) {
    if (target.type === "role") {
      return this.page.getByRole(target.role || "button", {
        name: target.name || "",
        exact: false,
      });
    }
    if (target.type === "label") {
      return this.page.getByLabel(target.value || target.name || "", { exact: false });
    }
    if (target.type === "placeholder") {
      return this.page.getByPlaceholder(target.value || "", { exact: false });
    }
    if (target.type === "text") {
      return this.page.getByText(target.value || target.name || "", { exact: false });
    }
    if (target.type === "selector" && target.value) {
      return this.page.locator(target.value);
    }
    return null;
  }
}
