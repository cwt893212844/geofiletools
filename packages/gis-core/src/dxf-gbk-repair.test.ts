import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import {
  dxfBytesContainReplacement,
  repairDxfCp936Strings,
} from './dxf-gbk-repair';

const root = join(process.cwd(), '..', '..');

/** Build a minimal DXF byte array with $DWGCODEPAGE and GBK text. */
function makeFakeDxf(codepage: string, textValue: string, encoding: 'gbk' | 'utf8' = 'gbk'): Uint8Array {
  const lines = [
    '  0', 'SECTION',
    '  2', 'HEADER',
    '  9', '$DWGCODEPAGE',
    '  3', codepage,
    '  9', '$ACADVER',
    '  1', 'AC1015',
    '  0', 'ENDSEC',
    '  0', 'SECTION',
    '  2', 'ENTITIES',
    '  0', 'TEXT',
    '  8', '0',
    '  1', textValue,
    '  0', 'ENDSEC',
    '  0', 'EOF',
  ];
  const header = lines.join('\r\n') + '\r\n';
  // Replace the text value with the desired encoding
  const headerBytes = iconv.encode(header.replace(textValue, ''), 'ascii');
  const valueBytes = iconv.encode(textValue, encoding);
  // Simple concat via string (good enough for ASCII surroundings + encoded value)
  const full = iconv.encode(header.replace(textValue, '\x00PLACEHOLDER\x00'), 'ascii');
  const idx = full.indexOf(0x00);
  const endIdx = full.indexOf(0x00, idx + 1);
  const result = new Uint8Array(idx + valueBytes.length + (full.length - endIdx - 1));
  result.set(full.subarray(0, idx));
  result.set(valueBytes, idx);
  result.set(full.subarray(endIdx + 1), idx + valueBytes.length);
  return result;
}

describe('dxf-gbk-repair', () => {
  it('detects UTF-8 replacement bytes in LibreDWG output', () => {
    const dxf = readFileSync(
      join(root, '测试', '20214656-规划验收总平面勘测图_转zh2000_平面.dxf'),
    );
    expect(dxfBytesContainReplacement(dxf)).toBe(true);
  });

  it('repairs GBK TEXT values in native CAD DXF exports', () => {
    const dxf = readFileSync(join(root, '北山村JMD-201612.dxf'));
    const repaired = repairDxfCp936Strings(dxf);
    const text = new TextDecoder('utf-8').decode(repaired);
    expect(text).toContain('北山会馆');
    expect(text).toContain('宋体');
    expect(dxfBytesContainReplacement(repaired)).toBe(false);
  });

  it('neutralises $DWGCODEPAGE to UTF-8 when GBK repairs are made', () => {
    const dxf = readFileSync(join(root, '北山村JMD-201612.dxf'));
    const text = new TextDecoder('latin1').decode(dxf.subarray(0, 300));
    expect(text).toContain('ANSI_936');

    const repaired = repairDxfCp936Strings(dxf);
    const repairedText = new TextDecoder('utf-8').decode(repaired);
    expect(repairedText).not.toContain('ANSI_936');
    expect(repairedText).toContain('$DWGCODEPAGE');
    expect(repairedText).toContain('UTF-8');
  });

  it('keeps already-valid UTF-8 DXF text unchanged', () => {
    const sample = iconv.encode(
      ['0', 'SECTION', '2', 'ENTITIES', '0', 'TEXT', '1', '规划验收', '0', 'ENDSEC'].join(
        '\n',
      ),
      'utf8',
    );
    const repaired = repairDxfCp936Strings(sample);
    expect(new TextDecoder('utf-8').decode(repaired)).toContain('规划验收');
  });

  it('does not modify $DWGCODEPAGE when no GBK repairs are needed', () => {
    // UTF-8 DXF with ANSI_936 header but already-valid UTF-8 text: codepage stays as-is
    const utfText = '规划验收';
    const lines = [
      '  0', 'SECTION', '  2', 'HEADER',
      '  9', '$DWGCODEPAGE', '  3', 'ANSI_936',
      '  0', 'ENDSEC',
      '  0', 'SECTION', '  2', 'ENTITIES',
      '  0', 'TEXT', '  1', utfText,
      '  0', 'ENDSEC', '  0', 'EOF',
    ].join('\n') + '\n';
    const sample = new TextEncoder().encode(lines);
    const repaired = repairDxfCp936Strings(sample);
    const repairedText = new TextDecoder('utf-8').decode(repaired);
    // No GBK repairs made → $DWGCODEPAGE value unchanged
    expect(repairedText).toContain('ANSI_936');
    expect(repairedText).toContain(utfText);
  });
});
