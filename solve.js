// A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Written from scratch in this session from the broken-row policy in the
// competition's RULES.txt. run(input) returns exactly csv-reader 1.0.0's
// answer for the input {text, header}: {columns, rows, errors}.
//
// How it stays exact: it is the same single left-to-right read, with the
// same error records in the same order — only the work is bulk instead of
// one character at a time:
//   - A physical line with no double quote and no stray CR is one record,
//     and its fields are the line split on commas. A quoted field can only
//     open where a quote is, so a quote-free line can never run on into
//     the next line; a stray CR or a quote on the line sends the whole
//     record to the field parser below.
//   - A quoted field finds its closing quote by searching for the next
//     quote that is not doubled. When the quoted span holds no CR and no
//     doubled quote, the value is one slice (line breaks inside it stay as
//     they are, and are counted); otherwise a short rebuild turns "" into
//     one quote and every CR or CRLF into one LF.
//   - An unquoted field, and the junk after a closing quote, take the next
//     comma or line break by search, with a CRLF read as one break and a
//     stray CR (a CR not followed by LF) dropped with its error; only a
//     field that actually holds a stray CR is walked a character at a time.
//   - A quote that never closes is a literal character and the text after
//     it is read again as unquoted, with the line count put back to the
//     opening quote's line, exactly as the reference does.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Fields stay strings, never trimmed or converted.

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The next LF at or after pos (len when the text holds no more), or -1 when it is not known: the unquoted
  // reader reuses it for every field of a line instead of searching for the line's end again and again.
  let lineEnd = -1;

  // Whether the current line's content (before its line break) holds a CR: when it holds none, no field on
  // the line can hold a stray CR, so the unquoted reader skips its per-field CR check.
  let lineHasCR = false;

  // Reads unquoted characters onto `v0` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field, how it ended, and how many characters were kept onto `v0`.
  function readUnquoted(v0) {
    if (lineEnd < pos) {
      lineEnd = text.indexOf('\n', pos);
      if (lineEnd === -1) lineEnd = len;
      let ce = lineEnd;
      if (lineEnd < len && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) ce = lineEnd - 1;
      lineHasCR = text.slice(pos, ce).indexOf('\r') !== -1;
    }
    const c = text.indexOf(',', pos);
    let e;
    let ended;
    if (c !== -1 && c < lineEnd) {
      e = c;
      ended = COMMA;
    } else if (lineEnd < len) {
      e = lineEnd;
      ended = LINE_BREAK;
    } else {
      e = len;
      ended = END;
    }
    // A CR right before the line break is the CRLF, not field content.
    let contentEnd = e;
    if (ended === LINE_BREAK && e > pos && text.charCodeAt(e - 1) === 13) contentEnd = e - 1;
    if (!lineHasCR) {
      const added = contentEnd - pos;
      const value = added === 0 ? v0 : v0.length === 0 ? text.slice(pos, contentEnd) : v0 + text.slice(pos, contentEnd);
      if (ended === COMMA) {
        pos = e + 1;
      } else if (ended === LINE_BREAK) {
        pos = e + 1;
        line += 1;
      } else {
        pos = len;
      }
      return { value, ended, added };
    }
    const seg = text.slice(pos, contentEnd);
    if (seg.indexOf('\r') === -1) {
      const value = seg.length === 0 ? v0 : v0.length === 0 ? seg : v0 + seg;
      if (ended === COMMA) {
        pos = e + 1;
      } else if (ended === LINE_BREAK) {
        pos = e + 1;
        line += 1;
      } else {
        pos = len;
      }
      return { value, ended, added: seg.length };
    }
    // A stray CR sits inside the field: walk it, dropping the CRs.
    const parts = [v0];
    let segStart = pos;
    while (pos < len) {
      const ch = text.charCodeAt(pos);
      if (ch === 44) {
        parts.push(text.slice(segStart, pos));
        pos += 1;
        const value = parts.join('');
        return { value, ended: COMMA, added: value.length - v0.length };
      }
      if (ch === 10) {
        parts.push(text.slice(segStart, pos));
        pos += 1;
        line += 1;
        const value = parts.join('');
        return { value, ended: LINE_BREAK, added: value.length - v0.length };
      }
      if (ch === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          parts.push(text.slice(segStart, pos));
          pos += 2;
          line += 1;
          const value = parts.join('');
          return { value, ended: LINE_BREAK, added: value.length - v0.length };
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        parts.push(text.slice(segStart, pos));
        segStart = pos + 1;
        pos += 1;
        continue;
      }
      pos += 1;
    }
    parts.push(text.slice(segStart, pos));
    const value = parts.join('');
    return { value, ended: END, added: value.length - v0.length };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let closedAt = -1;
    let hasDouble = false;
    let s = pos;
    while (true) {
      const q = text.indexOf('"', s);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        hasDouble = true;
        s = q + 2;
        continue;
      }
      closedAt = q;
      break;
    }
    if (closedAt === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    const q = closedAt;
    const seg = text.slice(pos, q);
    let value;
    if (!hasDouble && seg.indexOf('\r') === -1) {
      value = seg;
      let i = seg.indexOf('\n');
      while (i !== -1) {
        line += 1;
        i = seg.indexOf('\n', i + 1);
      }
    } else {
      // The span holds a doubled quote or a CR: rebuild it, "" into one quote and every CR or CRLF into one LF.
      const parts = [];
      let segStart = 0;
      let i = 0;
      while (i < seg.length) {
        const ch = seg.charCodeAt(i);
        if (ch === 34) {
          parts.push(seg.slice(segStart, i));
          parts.push('"');
          i += 2;
          segStart = i;
          continue;
        }
        if (ch === 13) {
          parts.push(seg.slice(segStart, i));
          parts.push('\n');
          line += 1;
          i += seg.charCodeAt(i + 1) === 10 ? 2 : 1;
          segStart = i;
          continue;
        }
        if (ch === 10) line += 1;
        i += 1;
      }
      parts.push(seg.slice(segStart));
      value = parts.join('');
    }
    // The quoted span held a line break: the next LF is no longer the one this record started with.
    if (line !== openLine) lineEnd = -1;
    pos = q + 1;
    if (pos >= len) return { value, ended: END };
    const ch = text.charCodeAt(pos);
    if (ch === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (ch === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (ch === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const ch = text.charCodeAt(pos);
      if (ch === 10) {
        pos += 1;
        line += 1;
      } else if (ch === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // The fast path: this physical line holds no quote and no stray CR, so it is one record's fields.
    const nl = text.indexOf('\n', pos);
    lineEnd = nl === -1 ? len : nl;
    const lineStr = text.slice(pos, lineEnd);
    let content = lineStr;
    if (nl !== -1 && content.length > 0 && content.charCodeAt(content.length - 1) === 13) {
      content = content.slice(0, -1); // a CR before the LF is the CRLF
    }
    lineHasCR = content.indexOf('\r') !== -1;
    let fields;
    let quoted = false;
    if (lineStr.indexOf('"') === -1 && !lineHasCR) {
      if (content.length === 0) {
        // An empty line: no record.
        pos = nl + 1;
        line += 1;
        continue;
      }
      fields = content.split(',');
      pos = nl === -1 ? len : nl + 1;
      if (nl !== -1) line += 1;
    }
    if (fields === undefined) {
      // A quote or a stray CR sits on this line: read the record field by field (it may run over lines).
      fields = [];
      let ended;
      do {
        quoted = pos < len && text.charCodeAt(pos) === 34;
        const field = quoted ? readQuoted() : readUnquoted('');
        fields.push(field.value);
        ended = field.ended;
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
