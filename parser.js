// Offline natural-language sentence parser for Quick Decide.
// Turns dictated or typed sentences into a clean, deduplicated list of choices.

const LEAD_IN_PATTERNS = [
  /^(?:hey|ok|okay|um|uh|so|well|like)[,\s]+/i,
  /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:help me\s+)?(?:just\s+)?(?:randomly\s+)?(?:decide|choose|pick|select)(?:\s+one)?(?:\s+(?:between|from|among|for me|out of))?\s+/i,
  /^i\s+(?:can'?t|cannot|don'?t know|am not sure|unsure)\s+(?:how to\s+)?(?:decide|choose|pick|know)(?:\s+(?:between|whether(?:\s+to)?|if\s+i\s+should|what\s+to))?\s+/i,
  /^(?:should\s+i|do\s+i|shall\s+i|would\s+you|want\s+to|wanna)\s+/i,
  /^(?:whether\s+to|if\s+i\s+should|between|either)\s+/i,
];

const TRAILING_FILLER_RE =
  /\s+(?:tonight|today|tomorrow|right now|now|for lunch|for dinner|for breakfast|for snack|this weekend|this evening|this morning|this afternoon|please|thanks|thank you)\s*$/i;

const SHARED_LEAD_VERB_RE =
  /^(eat|get|have|order|buy|watch|play|read|drink|wear|cook|make|try|visit|pick|choose|grab)\s+(.+)$/i;

const COMMON_ACTION_VERBS = new Set([
  'go', 'stay', 'walk', 'run', 'work', 'study', 'read', 'watch', 'play',
  'sleep', 'nap', 'cook', 'eat', 'order', 'get', 'have', 'make', 'call',
  'text', 'email', 'write', 'clean', 'drive', 'take', 'buy', 'skip',
  'start', 'finish', 'do', 'try', 'visit', 'meet', 'leave', 'wait',
  'drink', 'wear', 'grab', 'keep', 'cancel', 'book', 'check', 'open',
  'close', 'use', 'build', 'fix', 'rest', 'relax', 'exercise', 'hit',
]);

function stripLeadIns(text) {
  let result = text.trim();
  let changed = true;
  let guard = 0;
  while (changed && guard < 6) {
    changed = false;
    guard += 1;
    for (const pattern of LEAD_IN_PATTERNS) {
      const next = result.replace(pattern, '').trim();
      if (next !== result && next.length > 0) {
        result = next;
        changed = true;
      }
    }
  }
  return result;
}

function cleanOption(raw) {
  let s = raw
    .replace(/^[\s\-*•·\d.)]+(?=\S)/, '')
    .replace(/^(?:or|and|either|maybe|perhaps|just|like)\s+/i, '')
    .replace(/[?!.,;:\s]+$/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function splitNaturalList(text) {
  // 1. Multi-line input (newlines or explicit bullets)
  if (/\r?\n/.test(text)) {
    const lines = text
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length >= 2) {
      return lines;
    }
  }

  // 2. Semicolons, pipes, or spaced slashes
  if (/[;|]|\s\/\s/.test(text)) {
    const parts = text.split(/[;|]|\s\/\s/).filter((p) => p.trim());
    if (parts.length >= 2) return parts;
  }

  // 3. Explicit "vs" / "versus"
  if (/\b(?:vs\.?|versus)\b/i.test(text)) {
    const parts = text.split(/\s*\b(?:vs\.?|versus)\b\s*/i).filter((p) => p.trim());
    if (parts.length >= 2) return parts;
  }

  // 4. Comma-separated list with optional final "or" / "and"
  if (text.includes(',')) {
    const parts = text
      .split(/\s*,\s*(?:(?:or|and)\s+)?|\s+\bor\b\s+/i)
      .filter((p) => p.trim());
    if (parts.length >= 2) return parts;
  }

  // 5. "A or B" (and chained "A or B or C")
  if (/\s+\bor\b\s+/i.test(text)) {
    const parts = text.split(/\s+\bor\b\s+/i).filter((p) => p.trim());
    if (parts.length >= 2) return parts;
  }

  // 6. "between A and B" (or simple "A and B" after lead-in stripped)
  if (/\s+\band\b\s+/i.test(text)) {
    const parts = text.split(/\s+\band\b\s+/i).filter((p) => p.trim());
    if (parts.length >= 2) return parts;
  }

  // 7. Compact slash without spaces (e.g., "coffee/tea/matcha")
  if (text.includes('/')) {
    const parts = text.split('/').filter((p) => p.trim());
    if (parts.length >= 2) return parts;
  }

  return [text];
}

function stripSharedLeadingVerb(options) {
  if (options.length < 2) return options;
  const firstMatch = options[0].match(SHARED_LEAD_VERB_RE);
  if (!firstMatch) return options;

  // Only strip the leading verb from option 1 if none of the other options start
  // with an action verb (meaning they're noun items sharing that verb, e.g.
  // "eat ramen, tacos, or sushi" -> ["Ramen", "Tacos", "Sushi"]).
  const othersStartWithVerb = options.slice(1).some((opt) => {
    const firstWord = opt.split(/\s+/)[0]?.toLowerCase() ?? '';
    return COMMON_ACTION_VERBS.has(firstWord);
  });

  if (othersStartWithVerb) return options;

  const rest = firstMatch[2].trim();
  if (!rest) return options;

  return [
    rest.charAt(0).toUpperCase() + rest.slice(1),
    ...options.slice(1),
  ];
}

export function parseSentenceToChoices(input) {
  if (!input || typeof input !== 'string') return [];

  const trimmed = input.trim();
  if (!trimmed) return [];

  // Strip trailing question/period and conversational time filler before splitting
  const normalized = stripLeadIns(
    trimmed
      .replace(/[?!.]+$/g, '')
      .replace(TRAILING_FILLER_RE, '')
      .replace(/[?!.]+$/g, '')
      .trim()
  );

  const rawParts = splitNaturalList(normalized);
  const cleaned = rawParts
    .map((part) => cleanOption(part.replace(TRAILING_FILLER_RE, '')))
    .filter(Boolean);

  const adjusted = stripSharedLeadingVerb(cleaned);

  // Deduplicate case-insensitively while preserving order
  const seen = new Set();
  const unique = [];
  for (const item of adjusted) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}
