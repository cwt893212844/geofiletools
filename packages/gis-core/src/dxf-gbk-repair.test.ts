import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import {
  dxfBytesContainReplacement,
  repairDxfCp936Strings,
} from './dxf-gbk-repair';

const root = join(process.cwd(), '..', '..');

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
});
