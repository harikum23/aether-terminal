/**
 * Pure prompt builders for the four assistant tasks.
 *
 * Each returns `{ system, prompt }`. Systems are tight and force terse,
 * terminal-appropriate output; prompts inject zsh/macOS context and the
 * char-capped output the user is asking about. The command tasks should run
 * with `options: { temperature: 0.2 }` (the caller passes this).
 */

export interface PromptParts {
  system: string;
  prompt: string;
}

const SHELL_CONTEXT = "The shell is zsh on macOS.";

/** Cap input to the trailing `max` chars (recent output matters most). */
function capTail(text: string, max: number): string {
  const t = text ?? "";
  if (t.length <= max) return t;
  return t.slice(t.length - max);
}

/** Fence a block of terminal output for the model. */
function fence(text: string): string {
  return "```\n" + text + "\n```";
}

/** 1. NL → single shell command. */
export function buildCommandPrompt(request: string): PromptParts {
  return {
    system:
      "You are a zsh command generator. Output ONLY a single zsh command that " +
      "accomplishes the user's request. No prose, no explanation, no markdown " +
      "fences, no leading prompt characters. One line only. " +
      SHELL_CONTEXT,
    prompt: request.trim(),
  };
}

/** 2. Explain the last output / error. */
export function buildExplainPrompt(output: string): PromptParts {
  return {
    system:
      "Explain this terminal output concisely for a developer. If it is an " +
      "error, give the likely cause and a concrete fix. Be terse — a few " +
      "sentences, plain text, no markdown headings. " +
      SHELL_CONTEXT,
    prompt: "Terminal output:\n" + fence(capTail(output, 8000)),
  };
}

/** 3. Summarize long output. */
export function buildSummarizePrompt(output: string): PromptParts {
  return {
    system:
      "Summarize this terminal output into the key points as short bullets " +
      "(use '- '). Keep it terse and factual; omit noise. " +
      SHELL_CONTEXT,
    prompt: "Terminal output:\n" + fence(capTail(output, 8000)),
  };
}

/** 4. Suggest the next 1–3 commands. */
export function buildSuggestPrompt(output: string): PromptParts {
  return {
    system:
      "Suggest 1 to 3 useful next zsh commands based on this terminal output. " +
      "Output one suggestion per line in the exact form `command — reason`. " +
      "No numbering, no markdown fences, no extra prose. " +
      SHELL_CONTEXT,
    prompt: "Terminal output:\n" + fence(capTail(output, 8000)),
  };
}

/**
 * Normalize an NL→command model reply into a single runnable line:
 * strip markdown fences, drop blank lines, take the first command line.
 */
export function extractCommand(raw: string): string {
  const stripped = raw
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/```/g, "")
    .trim();
  const firstLine = stripped
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (firstLine ?? "").replace(/^[$#>]\s*/, "").trim();
}

/** A parsed `command — reason` suggestion line. */
export interface Suggestion {
  command: string;
  reason: string;
}

/** Parse the suggest task reply into selectable `{ command, reason }` items. */
export function parseSuggestions(raw: string): Suggestion[] {
  const cleaned = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  return cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      // tolerate em dash, en dash, or hyphen as the separator
      const m = line.match(/^(.*?)\s*[—–-]\s*(.*)$/);
      const stripPrefix = (s: string) => s.replace(/^[-*\d.)\s]+/, "").trim();
      if (m) {
        return { command: stripPrefix(m[1]), reason: m[2].trim() };
      }
      return { command: stripPrefix(line), reason: "" };
    })
    .filter((s) => s.command.length > 0);
}
