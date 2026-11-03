const FINAL_PUNCTUATION_RE = /[.!?…]["')\]]*$/;
const CONCLUSION_RE = /[.!…]["')\]]*$/;

export function endsSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return FINAL_PUNCTUATION_RE.test(trimmed);
}

/** A question mark by itself does not close a cut. */
export function endsConclusion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return CONCLUSION_RE.test(trimmed);
}

export function startsWithLowercase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const character = trimmed[0];
  return character.toLowerCase() !== character.toUpperCase() && character === character.toLowerCase();
}

export function continuesSentence(previousText: string, _currentText: string): boolean {
  return !endsSentence(previousText);
}
