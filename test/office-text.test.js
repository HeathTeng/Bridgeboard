import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { officeText } from '../lib/office-text.js';

/** A minimal zip writer, just enough to build test .docx/.pptx files. */
function zip(files, { deflate = true } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc32(raw), 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('reads the paragraphs of a Word document', () => {
  const doc = zip({
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Week 3 &amp; 4</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t><w:tab/><w:t>x</w:t></w:r></w:p></w:body></w:document>',
  });
  assert.equal(officeText(doc, 'Brief.DOCX'), 'Week 3 & 4\n第二段\tx');
});

test('reads PowerPoint slides in number order, stored or deflated', () => {
  const slide = (t) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
  for (const deflate of [true, false]) {
    const deck = zip({
      'ppt/slides/slide10.xml': slide('Ten'),
      'ppt/slides/slide2.xml': slide('Two'),
      'ppt/slides/_rels/slide2.xml.rels': '<Relationships/>',
    }, { deflate });
    assert.equal(officeText(deck, 'lec.pptx'), '--- 第 2 页 ---\nTwo\n\n--- 第 10 页 ---\nTen');
  }
});

test('returns null for other file types and errors on a broken file', () => {
  assert.equal(officeText(Buffer.from('x'), 'a.pdf'), null);
  assert.throws(() => officeText(Buffer.from('not a zip at all, just text'), 'a.docx'), /zip/);
});
