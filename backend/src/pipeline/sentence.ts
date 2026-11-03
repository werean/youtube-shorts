const FINAL_PUNCTUATION_RE = /[.!?…]["')\]]*$/;

export function endsSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return FINAL_PUNCTUATION_RE.test(trimmed);
}

export function startsWithLowercase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const character = trimmed[0];
  return character.toLowerCase() !== character.toUpperCase() && character === character.toLowerCase();
}

export function continuesSentence(previousText: string, currentText: string): boolean {
  return !endsSentence(previousText) || startsWithLowercase(currentText);
}
