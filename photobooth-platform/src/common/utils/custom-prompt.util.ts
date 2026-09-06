const USER_INPUT_PLACEHOLDER = '{user_input}';

// Strips control characters (newlines/tabs included -- this is a single-line
// form field, not free text) by char code rather than a regex escape range,
// to avoid any ambiguity in how an escape sequence in the pattern source
// gets interpreted.
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

export function sanitizeCustomInput(raw: string): string {
  return stripControlChars(raw).replace(/\s+/g, ' ').trim();
}

// Shared by SubmissionsService (stores the resolved prompt on creation) and
// ProcessingWorker (re-resolves it at generation time) -- same pattern as
// how Template.prompt / PromptOption.prompt are each read in both places,
// so there's exactly one implementation of the substitution rule.
//
// String.prototype.replace with a literal (non-regex) search string only
// ever replaces the FIRST occurrence -- that's relied on here, not
// incidental: it means a user who types the literal text "{user_input}" as
// their own answer can't get it substituted a second time or otherwise
// change how many times the template expands, since there is no second pass.
export function buildCustomPrompt(promptTemplate: string, rawUserInput: string): string {
  const cleaned = sanitizeCustomInput(rawUserInput);
  return promptTemplate.includes(USER_INPUT_PLACEHOLDER)
    ? promptTemplate.replace(USER_INPUT_PLACEHOLDER, cleaned)
    : `${promptTemplate} ${cleaned}`;
}
