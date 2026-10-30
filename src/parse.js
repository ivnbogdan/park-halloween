// Extracts { block, floor, apt } from a free-text comment such as
// "T2, et 9, 99", "Bloc 1, etaj 1, ap 13." or "Blocul Galben - parter - ap 1".
// Returns null when the comment does not clearly name a block and an apartment.

export const BLOCKS = ['T1', 'T2', 'T3', 'TP'];

export function floorFromApt(apt) {
  // Ap 4 -> parter (0), ap 45 -> 4, ap 78 -> 7. Above ~100 this is only a guess.
  return apt < 10 ? 0 : Math.floor(apt / 10);
}

export function parseComment(text) {
  let s = (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  let block = null;
  const blockPatterns = [
    [/\bbloc(?:ul)?\s+galben\b|\bgalben\b/, () => 'TP'],
    [/\bt\s*p\b/, () => 'TP'],
    [/\bt\s*([123])\b/, (m) => 'T' + m[1]],
    [/\bbloc(?:ul)?\s*(?:nr\.?\s*)?([123])\b/, (m) => 'T' + m[1]],
  ];
  for (const [re, toBlock] of blockPatterns) {
    const m = s.match(re);
    if (m) {
      block = toBlock(m);
      s = s.replace(m[0], ' ');
      break;
    }
  }
  if (!block) return null;

  let floor = null;
  const floorMatch = s.match(/\bet(?:aj(?:ul)?)?\.?\s*(-\s*)?(\d{1,2})\b/);
  if (floorMatch) {
    floor = Number(floorMatch[2]) * (floorMatch[1] ? -1 : 1);
    s = s.replace(floorMatch[0], ' ');
  } else if (/\b(?:subsol|demisol)\b/.test(s)) {
    floor = -1;
    s = s.replace(/\b(?:subsol|demisol)\b/, ' ');
  } else if (/\bparter\b/.test(s)) {
    floor = 0;
    s = s.replace(/\bparter\b/, ' ');
  }

  let apt = null;
  const aptMatch = s.match(/\bap(?:t|artament(?:ul)?)?\.?\s*(?:nr\.?\s*)?(\d{1,3})\b/);
  if (aptMatch) {
    apt = Number(aptMatch[1]);
  } else {
    // Bare numbers: "T2, 7, 73" -> floor 7, ap 73; "T2, et 9, 99" -> ap 99.
    const nums = (s.match(/\b\d{1,3}\b/g) || []).map(Number);
    if (nums.length === 1) apt = nums[0];
    else if (nums.length === 2 && floor === null) [floor, apt] = nums;
    else return null;
  }
  if (!apt) return null;

  const floorStated = floor !== null;
  if (!floorStated) floor = floorFromApt(apt);
  return { block, floor, apt, floorStated };
}

// "Din pacate nu vom mai fi acasa", "nu mai participam", "ne retragem", "scoateti-ne" ...:
// the comment names an apartment that should be taken OFF the list.
export function isOptOut(text) {
  const s = (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return [
    /\bnu\s+(?:mai\s+)?(?:vom|o\s+sa|suntem|sunt|voi|vor|va)\b[^.!?]{0,30}\b(?:fi\s+)?acasa\b/,
    /\bnu\s+(?:mai\s+)?(?:participam|participa|putem|venim|deschidem)\b/,
    /\b(?:ne\s+retragem|retrag|anulam|anulat|scoate(?:ti)?(?:-ne|-ma)?|sterge(?:ti)?(?:-ne|-ma)?)\b/,
  ].some((re) => re.test(s));
}
