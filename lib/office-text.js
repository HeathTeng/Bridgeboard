// Plain text out of Word (.docx) and PowerPoint (.pptx) files, for the
// "text for AI" export. Both are zip archives of XML; blackboard-mcp's
// extractText does not read them, and a zip library would be a dependency,
// so this reads the archive with Node's own zlib.
import { inflateRawSync } from 'node:zlib';

// A course handout's XML is a few MB at most; refuse anything that inflates
// far beyond that rather than filling memory.
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** Lists a zip archive's entries: name -> () => Buffer. */
export function readZip(buf) {
  // The end-of-central-directory record sits in the last 22 bytes plus an
  // optional comment of up to 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 Office 文件（找不到 zip 目录）。');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Office 文件的 zip 目录已损坏。');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compressed);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      throw new Error(`不支持的压缩方式 ${method}。`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Text of one WordprocessingML / DrawingML part, one paragraph per line. */
function xmlText(xml, ns) {
  return decode(
    xml
      .replace(new RegExp(`<${ns}:tab\\b[^>]*/>`, 'g'), '\t')
      .replace(new RegExp(`<${ns}:br\\b[^>]*/>`, 'g'), '\n')
      .replace(new RegExp(`</${ns}:p>`, 'g'), '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function docxText(zip) {
  const body = zip.get('word/document.xml');
  if (!body) throw new Error('这个 Word 文件里没有正文。');
  return xmlText(body().toString('utf8'), 'w');
}

function pptxText(zip) {
  const slides = [...zip.keys()]
    .map((name) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(name))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  if (!slides.length) throw new Error('这个 PowerPoint 文件里没有幻灯片。');
  return slides
    .map(([name, n]) => `--- 第 ${n} 页 ---\n${xmlText(zip.get(name)().toString('utf8'), 'a')}`)
    .join('\n\n');
}

/** Text of a .docx or .pptx file's contents, or null for other types. */
export function officeText(buf, fileName) {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext !== 'docx' && ext !== 'pptx') return null;
  const zip = readZip(buf);
  return ext === 'docx' ? docxText(zip) : pptxText(zip);
}
