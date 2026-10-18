/** Active requests only: historical model provenance must remain unchanged. */
export function activeOpenAIModel(model: string): string {
  const value = model.trim();
  const base = value.startsWith("ft:") ? value.split(":")[1]! : value;
  if (
    /^gpt-(?:4o(?:-mini)?|4\.1(?:-mini)?)(?:-\d{4}-\d{2}-\d{2})?$/.test(base)
  ) {
    throw new Error(
      "Retiring OpenAI model configured; update the active model configuration before generation",
    );
  }
  return value;
}

/** Luna defaults to medium reasoning; preserve these formerly non-reasoning tasks. */
export function lunaRequestOptions(model: string) {
  return /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
    ? { reasoning: { effort: "none" as const } }
    : {};
}
