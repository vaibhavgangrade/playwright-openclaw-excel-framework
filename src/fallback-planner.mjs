export class FallbackPlanner {
  constructor({ model, baseUrl, apiKey, maxTokens }) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.maxTokens = maxTokens;
  }

  async suggestAction({ step, snapshot }) {
    const prompt = {
      failedStep: step,
      snapshot: String(snapshot || "").slice(0, 18000),
      instruction:
        "Return strict JSON only with keys action, ref, text, key, assertion, reason. Allowed action: click,type,press,assertion,fail.",
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        max_tokens: this.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a locator-healing planner for browser automation. Prefer click/type with refs from snapshot.",
          },
          { role: "user", content: JSON.stringify(prompt, null, 2) },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Planner error ${response.status}: ${body}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Planner returned empty result.");
    return JSON.parse(content);
  }
}
