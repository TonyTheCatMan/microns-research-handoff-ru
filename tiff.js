/* Offline TIFF reader. Supports classic TIFF, uint8 grayscale, uncompressed
 * single or multiple strips, and one image per IFD. No network or dependencies. */
(function (root) {
  'use strict';
  class GrayTiff {
    constructor(buffer) {
      this.buffer = buffer;
      this.view = new DataView(buffer);
      this.pages = [];
      this.guard(0, 8);
      const marker = String.fromCharCode(this.view.getUint8(0), this.view.getUint8(1));
      if (marker !== 'II' && marker !== 'MM') throw new Error('Это не TIFF: отсутствует маркер порядка байтов.');
      this.little = marker === 'II';
      if (this.u16(2) !== 42) throw new Error('Этот просмотрщик поддерживает классический TIFF. Формат BigTIFF не поддерживается.');
      let next = this.u32(4);
      const seen = new Set();
      while (next) {
        if (seen.has(next) || seen.size >= 10000) throw new Error('Неверная цепочка каталогов TIFF.');
        seen.add(next);
        const count = this.u16(next);
        this.guard(next + 2, count * 12 + 4);
        const tags = {};
        for (let i = 0; i < count; i++) {
          const pos = next + 2 + 12 * i;
          const tag = this.u16(pos), type = this.u16(pos + 2), n = this.u32(pos + 4);
          if ([256,257,258,259,262,273,274,277,278,279,284,339].includes(tag)) {
            tags[tag] = this.values(type, n, pos + 8);
          }
        }
        const one = (key, fallback) => tags[key] ? tags[key][0] : fallback;
        const width = one(256), height = one(257), bits = one(258, 1);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1e8) throw new Error('Размеры TIFF не поддерживаются.');
        if (bits !== 8 || one(277, 1) !== 1 || one(339, 1) !== 1) throw new Error('Поддерживаются только одноканальные TIFF в оттенках серого с беззнаковыми 8-битными значениями.');
        if (one(259, 1) !== 1) throw new Error('TIFF сжат: используйте несжатые TIFF для проверки, входящие в этот пакет.');
        if (![0, 1].includes(one(262, 1))) throw new Error('TIFF должен использовать фотометрическую интерпретацию в оттенках серого.');
        if (one(274, 1) !== 1) throw new Error('Ориентация TIFF не поддерживается: начало координат должно находиться в левом верхнем углу.');
        const offsets = tags[273], counts = tags[279], rows = one(278, height);
        if (!offsets || !counts || offsets.length !== counts.length || !rows || offsets.length !== Math.ceil(height / rows)) throw new Error('Неверное или неподдерживаемое расположение полос TIFF.');
        for (let i = 0; i < offsets.length; i++) {
          const expected = width * Math.min(rows, height - i * rows);
          if (counts[i] < expected) throw new Error('Полоса TIFF содержит неполные данные.');
          this.guard(offsets[i], counts[i]);
        }
        this.pages.push({ width, height, offsets, counts, rows, whiteIsZero: one(262, 1) === 0 });
        next = this.u32(next + 2 + count * 12);
      }
      if (!this.pages.length) throw new Error('TIFF не содержит каталогов изображений.');
      const first = this.pages[0];
      if (this.pages.some(p => p.width !== first.width || p.height !== first.height || p.whiteIsZero !== first.whiteIsZero)) throw new Error('Срезы TIFF имеют разные размеры или разную интерпретацию оттенков серого.');
      this.width = first.width; this.height = first.height; this.depth = this.pages.length;
    }
    guard(offset, length) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.buffer.byteLength) throw new Error('TIFF ссылается на данные за границами файла; возможно, файл неполный.');
    }
    u16(p) { this.guard(p, 2); return this.view.getUint16(p, this.little); }
    u32(p) { this.guard(p, 4); return this.view.getUint32(p, this.little); }
    values(type, count, field) {
      const size = {1:1, 3:2, 4:4}[type];
      if (!size || count < 1 || count > 1000000) throw new Error('Тип или число значений тега TIFF не поддерживаются.');
      const bytes = size * count, offset = bytes <= 4 ? field : this.u32(field);
      this.guard(offset, bytes);
      return Array.from({length:count}, (_, i) => type === 1 ? this.view.getUint8(offset + i) : type === 3 ? this.u16(offset + i * 2) : this.u32(offset + i * 4));
    }
    plane(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.depth) throw new Error('Индекс среза находится за границами стопки TIFF.');
      const page = this.pages[index], pixels = new Uint8Array(this.width * this.height);
      for (let i = 0; i < page.offsets.length; i++) {
        const count = this.width * Math.min(page.rows, this.height - i * page.rows);
        pixels.set(new Uint8Array(this.buffer, page.offsets[i], count), i * page.rows * this.width);
      }
      return pixels;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = GrayTiff;
  root.GrayTiff = GrayTiff;
})(typeof globalThis !== 'undefined' ? globalThis : this);
