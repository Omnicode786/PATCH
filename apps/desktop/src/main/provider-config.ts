import type { ProviderId } from "@patch/schemas";

export function customModelFormatIsValid(provider: ProviderId, model: string): boolean {
  if (!model.trim() || model.length > 200 || /\s/.test(model)) return false;
  return provider === "gemini"
    ? /^gemini-[a-z0-9][a-z0-9._-]*$/i.test(model)
    : /^[a-z0-9][a-z0-9._:-]*$/i.test(model);
}
