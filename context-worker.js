/* Exact, native-grid MICrONS crop surfaces. Runs outside the UI thread.
 * Incoming: {type:'load',token,volume:context_index volume,url:absolute data URL}.
 * Outgoing: progress, mesh (transferable Float32 vertices + Uint32 faces), done,
 * or error. A worker serves one load; terminate it to cancel a stale volume.
 */
'use strict';

class QuadList {
  constructor() { this.data = new Uint16Array(240); this.length = 0; this.area = [0, 0, 0]; }
  add(axis, sign, plane, u0, v0, u1, v1) {
    if (this.length + 6 > this.data.length) {
      const next = new Uint16Array(this.data.length * 2); next.set(this.data); this.data = next;
    }
    this.data.set([axis * 2 + (sign < 0 ? 1 : 0), plane, u0, v0, u1, v1], this.length);
    this.length += 6; this.area[axis] += (u1 - u0) * (v1 - v0);
  }
  toMesh(resolution) {
    const count = this.length / 6;
    const vertices = new Float32Array(count * 12), faces = new Uint32Array(count * 6);
    for (let q = 0; q < count; q++) {
      const offset = q * 6, code = this.data[offset], axis = code >> 1;
      const u = (axis + 1) % 3, v = (axis + 2) % 3, plane = this.data[offset + 1];
      const u0 = this.data[offset + 2], v0 = this.data[offset + 3];
      const u1 = this.data[offset + 4], v1 = this.data[offset + 5];
      // Cyclic axes make [0,1,2] wind towards the positive axis. Reverse for minus.
      const corners = code & 1 ? [[u0,v0],[u0,v1],[u1,v1],[u1,v0]] : [[u0,v0],[u1,v0],[u1,v1],[u0,v1]];
      for (let k = 0; k < 4; k++) {
        const base = q * 12 + k * 3;
        vertices[base + axis] = plane * resolution[axis];
        vertices[base + u] = corners[k][0] * resolution[u];
        vertices[base + v] = corners[k][1] * resolution[v];
      }
      const base = q * 4; faces.set([base,base+1,base+2,base,base+2,base+3], q*6);
    }
    this.data = null;
    return {vertices, faces};
  }
}

function rectangles(mask, rows, cols, axis, sign, plane, builders) {
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols;) {
    const id = mask[row * cols + col];
    if (!id) { col++; continue; }
    let endCol = col + 1;
    while (endCol < cols && mask[row * cols + endCol] === id) endCol++;
    let endRow = row + 1;
    outer: while (endRow < rows) {
      for (let c = col; c < endCol; c++) if (mask[endRow * cols + c] !== id) break outer;
      endRow++;
    }
    builders[id].add(axis, sign, plane, row, col, endRow, endCol);
    for (let r = row; r < endRow; r++) mask.fill(0, r * cols + col, r * cols + endCol);
    col = endCol;
  }
}

function decode(buffer, volume) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 24 || view.getUint32(0, true) !== 0x3158434d) throw new Error('Неверный формат сегментации.');
  const shape = [4, 8, 12].map(n => view.getUint32(n, true));
  const runs = view.getUint32(16, true), paletteCount = view.getUint32(20, true);
  if (shape.some((n,i) => n !== volume.shape_xyz[i] || n < 1 || n > 65535) || paletteCount !== volume.palette.length || paletteCount > 65535 || buffer.byteLength !== 24 + runs * 8) throw new Error('Размеры сегментации не совпадают с объёмом.');
  if (volume.palette[0] !== '0' || !volume.palette.every(id => typeof id === 'string' && /^\d+$/.test(id))) throw new Error('Неверные идентификаторы сегментации.');
  const size = shape.reduce((a,b) => a*b, 1);
  if (size > 128 * 1024 * 1024) throw new Error('Слишком большой объём сегментации.');
  const data = new Uint16Array(size), pairs = new Uint32Array(buffer, 24);
  let offset = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const id = pairs[i], count = pairs[i + 1];
    if (id >= paletteCount || count < 1 || offset + count > size) throw new Error('Повреждены данные сегментации.');
    data.fill(id, offset, offset + count); offset += count;
  }
  if (offset !== size) throw new Error('Сегментация не покрывает весь объём.');
  return data;
}

async function load({token, volume, url}) {
  if (!volume || !Array.isArray(volume.shape_xyz) || !Array.isArray(volume.objects) || !Array.isArray(volume.palette)) throw new Error('Не указан объём сегментации.');
  if (volume.resolution_nm?.join(',') !== '8,8,40') throw new Error('Неверный шаг сетки сегментации.');
  postMessage({type:'progress', token, message:'Загрузка окружающих сегментов…'});
  const response = await fetch(url);
  if (!response.ok) throw new Error('Не удалось загрузить сегментацию: HTTP ' + response.status);
  let bytes = await response.arrayBuffer();
  if (bytes.byteLength !== volume.data_bytes) throw new Error('Размер загруженной сегментации не совпадает с индексом.');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== volume.data_sha256) throw new Error('Проверка целостности сегментации не пройдена.');
  if (typeof DecompressionStream !== 'function') throw new Error('Для окружающих сегментов требуется современная версия Chrome, Firefox или Edge.');
  bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const data = decode(bytes, volume); bytes = null;
  const shape = volume.shape_xyz, stride = [1,shape[0],shape[0]*shape[1]];
  const builders = new Array(volume.palette.length), wanted = new Uint8Array(volume.palette.length);
  const seedIDs = new Set((volume.seed_objects || []).map(o => o.segment_id));
  for (const object of volume.objects) {
    const index = object.palette_index;
    if (!Number.isInteger(index) || index < 1 || index >= builders.length || wanted[index] || volume.palette[index] !== object.segment_id || seedIDs.has(object.segment_id)) throw new Error('Неверный список окружающих сегментов.');
    wanted[index] = 1; builders[index] = new QuadList();
  }
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, rows = shape[u], cols = shape[v];
    const positive = new Uint16Array(rows*cols), negative = new Uint16Array(rows*cols);
    // Only internal planes: touching a crop border never manufactures a cap.
    for (let plane = 1; plane < shape[axis]; plane++) {
      for (let row = 0; row < rows; row++) {
        let index = (plane-1)*stride[axis] + row*stride[u];
        for (let col = 0; col < cols; col++, index += stride[v]) {
          const a = data[index], b = data[index + stride[axis]], at = row*cols + col;
          positive[at] = a !== b && wanted[a] ? a : 0;
          negative[at] = a !== b && wanted[b] ? b : 0;
        }
      }
      rectangles(positive,rows,cols,axis,1,plane,builders);
      rectangles(negative,rows,cols,axis,-1,plane,builders);
    }
    postMessage({type:'progress',token,message:'Построение поверхностей: ' + Math.round((axis+1)*100/3) + '%',axis});
  }
  let triangleCount = 0;
  for (const object of volume.objects) {
    const builder = builders[object.palette_index];
    if (!Array.isArray(object.interface_faces_xyz) || builder.area.some((n,i) => n !== object.interface_faces_xyz[i])) throw new Error('Площадь поверхности не совпадает с исходной сегментацией: ' + object.id);
    const mesh = builder.toMesh(volume.resolution_nm); triangleCount += mesh.faces.length/3;
    builders[object.palette_index] = null;
    postMessage({type:'mesh',token,object:{...object,...mesh}},[mesh.vertices.buffer,mesh.faces.buffer]);
  }
  postMessage({type:'done',token,count:volume.objects.length,triangle_count:triangleCount});
}

self.onmessage = event => {
  if (event.data?.type !== 'load') return;
  load(event.data).catch(error => postMessage({type:'error',token:event.data.token,message:error.message || String(error)}));
};
