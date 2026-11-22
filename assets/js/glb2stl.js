// glbtostlconverter.com - GLB/glTF to STL in the browser.
// Everything runs locally: files are read with the File API and never uploaded.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const ui = {
  drop: $('drop'), file: $('file'), sample: $('sample'), stage: $('stage'), canvas: $('view'),
  stats: $('stats'), out: $('outstats'), msg: $('msg'),
  unit: document.querySelectorAll('input[name="unit"]'), target: $('target'),
  merge: $('merge'), xform: $('xform'), zup: $('zup'), floor: $('floor'),
  fmt: document.querySelectorAll('input[name="fmt"]'),
  dlStl: $('dl-stl'), dlObj: $('dl-obj'), reset: $('reset'),
  viewTex: $('view-tex'), viewStl: $('view-stl'),
};

/* ---------- viewer ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
const controls = new OrbitControls(camera, ui.canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(3, 5, 4);
scene.add(sun);
let grid = null, shown = null, previewStl = null;

function resize() {
  const r = ui.stage.getBoundingClientRect();
  const w = Math.max(200, r.width), h = Math.max(200, r.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(ui.stage);
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function frame(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) || 1;
  camera.near = r / 1000; camera.far = r * 100; camera.updateProjectionMatrix();
  camera.position.copy(c).add(new THREE.Vector3(0.9, 0.6, 1.25).multiplyScalar(r * 1.3));
  controls.target.copy(c); controls.update();
  if (grid) scene.remove(grid);
  const g = Math.pow(10, Math.ceil(Math.log10(r * 2)));
  grid = new THREE.GridHelper(g, 20, 0x84cc16, 0x334155);
  grid.position.set(c.x, box.min.y, c.z);
  grid.material.transparent = true; grid.material.opacity = 0.45;
  scene.add(grid);
}

/* ---------- loading ---------- */
const draco = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/');
let current = null; // { name, bytes, root, info }

function say(text, kind = '') { ui.msg.textContent = text; ui.msg.className = 'msg ' + kind; }

function pickFiles(list) {
  const files = [...list];
  const main = files.find(f => /\.glb$/i.test(f.name)) || files.find(f => /\.gltf$/i.test(f.name));
  if (!main) { say('Choose a .glb or .gltf file. Other formats are not read by this tool.', 'bad'); return; }
  const others = new Map(files.filter(f => f !== main).map(f => [f.name, URL.createObjectURL(f)]));
  say('Reading ' + main.name + ' in your browser...');
  main.arrayBuffer().then(buf => parse(buf, main.name, main.size, others));
}

function parse(buf, name, bytes, others = new Map()) {
  const manager = new THREE.LoadingManager();
  const missing = [];
  manager.setURLModifier(url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const base = decodeURIComponent(url.split(/[\\/]/).pop().split('?')[0]);
    if (others.has(base)) return others.get(base);
    missing.push(base);
    return url;
  });
  const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  loader.parse(buf, '', gltf => {
    const root = gltf.scene || gltf.scenes[0];
    if (!root) { say('This file has no scene to convert.', 'bad'); return; }
    show(root, name, bytes, gltf.parser.json);
    if (missing.length) say('Loaded, but these referenced files were not provided: ' + [...new Set(missing)].join(', ') + '. Textures may be missing; geometry is complete only if all .bin files were included.', 'warn');
  }, err => {
    const m = missing.length ? ' It references outside files (' + [...new Set(missing)].join(', ') + '). Drop the .gltf together with those files, or use a .glb.' : '';
    say('Could not read this file: ' + (err && err.message ? err.message : err) + '.' + m, 'bad');
  });
}

function show(root, name, bytes, json) {
  if (shown) scene.remove(shown);
  if (previewStl) { scene.remove(previewStl); previewStl.geometry.dispose(); previewStl = null; }
  shown = root;
  scene.add(root);
  root.updateMatrixWorld(true);
  frame(root);
  const info = inspect(root, json);
  current = { name, bytes, root, info };
  ui.drop.classList.add('loaded');
  document.body.classList.add('has-model');
  setView('tex');
  renderStats();
  update();
  say('Loaded ' + name + '. Pick your options, then download.', 'ok');
}

function inspect(root, json) {
  let meshes = 0, tris = 0, verts = 0, skinned = 0, morph = 0, skipped = 0;
  const mats = new Set(), maps = new Set();
  root.traverse(o => {
    if (o.isLine || o.isPoints) { skipped++; return; }
    if (!o.isMesh || !o.geometry.attributes.position) return;
    const n = o.isInstancedMesh ? o.count : 1;
    const g = o.geometry;
    meshes += n;
    tris += n * ((g.index ? g.index.count : g.attributes.position.count) / 3);
    verts += n * g.attributes.position.count;
    if (o.isSkinnedMesh) skinned++;
    if (g.morphAttributes && g.morphAttributes.position) morph++;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      mats.add(m);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k]) maps.add(m[k]);
    });
  });
  const box = new THREE.Box3().setFromObject(root, true);
  const ext = (json && json.extensionsUsed) || [];
  return { meshes, tris: Math.round(tris), verts, mats: mats.size, maps: maps.size, skinned, morph, skipped, box, ext };
}

const fmtN = n => n.toLocaleString('en-US');
const fmtB = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
const fmtL = (v, unit) => unit === 'mm' ? (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' mm' : (v < 0.01 ? v.toPrecision(3) : v.toFixed(3)) + ' m';

function renderStats() {
  const { name, bytes, info } = current;
  const s = info.box.getSize(new THREE.Vector3());
  const rows = [
    ['file', name], ['size', fmtB(bytes)], ['meshes', fmtN(info.meshes)], ['triangles', fmtN(info.tris)],
    ['vertices', fmtN(info.verts)], ['materials', fmtN(info.mats)], ['textures', fmtN(info.maps)],
    ['bbox (glTF units)', `${fmtL(s.x)} x ${fmtL(s.y)} x ${fmtL(s.z)}`],
    ['same in mm', `${fmtL(s.x * 1000, 'mm')} x ${fmtL(s.y * 1000, 'mm')} x ${fmtL(s.z * 1000, 'mm')}`],
  ];
  if (info.ext.length) rows.push(['extensions', info.ext.join(', ')]);
  if (info.skinned) rows.push(['note', info.skinned + ' skinned mesh(es): exported in the posed shape']);
  if (info.morph) rows.push(['note', 'morph targets ignored; base shape is exported']);
  if (info.skipped) rows.push(['note', info.skipped + ' line/point object(s) skipped']);
  ui.stats.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
}
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- geometry baking ---------- */
function options() {
  const unit = [...ui.unit].find(r => r.checked).value;
  return {
    unit, target: Math.max(0.1, parseFloat(ui.target.value) || 100),
    merge: ui.merge.checked, xform: ui.xform.checked, zup: ui.zup.checked, floor: ui.floor.checked,
    binary: [...ui.fmt].find(r => r.checked).value === 'binary',
  };
}

// Returns [{ name, pos: Float32Array (non-indexed triangle soup, meters, after node transforms) }]
function bakeParts(root, applyXf) {
  root.updateMatrixWorld(true);
  const parts = [], v = new THREE.Vector3(), m = new THREE.Matrix4(), im = new THREE.Matrix4();
  let n = 0;
  root.traverse(o => {
    if (!o.isMesh || o.isLine || o.isPoints || !o.geometry.attributes.position) return;
    const g = o.geometry, P = g.attributes.position, idx = g.index;
    const count = idx ? idx.count : P.count;
    const local = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      local[i * 3] = v.x; local[i * 3 + 1] = v.y; local[i * 3 + 2] = v.z;
    }
    const instances = o.isInstancedMesh ? (applyXf ? o.count : 1) : 1;
    for (let k = 0; k < instances; k++) {
      if (applyXf) {
        if (o.isInstancedMesh) { o.getMatrixAt(k, im); m.multiplyMatrices(o.matrixWorld, im); }
        else m.copy(o.matrixWorld);
      } else m.identity();
      const flip = m.determinant() < 0; // mirrored node: keep outward-facing winding
      const out = new Float32Array(count * 3);
      for (let t = 0; t < count; t += 3) {
        for (let c = 0; c < 3; c++) {
          const cc = flip ? [0, 2, 1][c] : c;
          const vi = idx ? idx.getX(t + cc) : t + cc;
          v.set(local[vi * 3], local[vi * 3 + 1], local[vi * 3 + 2]).applyMatrix4(m);
          out[(t + c) * 3] = v.x; out[(t + c) * 3 + 1] = v.y; out[(t + c) * 3 + 2] = v.z;
        }
      }
      n++;
      parts.push({ name: o.name || (o.parent && o.parent.name) || 'part-' + n, pos: out });
    }
  });
  return parts;
}

// Axis swap, scale and placement applied to every part in place. Returns final bbox and factor.
function finish(parts, o) {
  const box = new THREE.Box3(), v = new THREE.Vector3();
  for (const p of parts) {
    const a = p.pos;
    if (o.zup) for (let i = 0; i < a.length; i += 3) { const y = a[i + 1]; a[i + 1] = -a[i + 2]; a[i + 2] = y; }
    for (let i = 0; i < a.length; i += 3) box.expandByPoint(v.set(a[i], a[i + 1], a[i + 2]));
  }
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const k = o.unit === 'mm' ? 1000 : o.unit === 'fit' ? o.target / longest : 1;
  const off = new THREE.Vector3();
  if (o.floor) {
    const c = box.getCenter(new THREE.Vector3());
    off.set(-c.x, -c.y, -c.z);
    if (o.zup) off.z = -box.min.z; else off.y = -box.min.y;
  }
  for (const p of parts) {
    const a = p.pos;
    for (let i = 0; i < a.length; i += 3) {
      a[i] = (a[i] + off.x) * k; a[i + 1] = (a[i + 1] + off.y) * k; a[i + 2] = (a[i + 2] + off.z) * k;
    }
  }
  const outBox = new THREE.Box3(new THREE.Vector3().copy(box.min).add(off).multiplyScalar(k), new THREE.Vector3().copy(box.max).add(off).multiplyScalar(k));
  return { k, size: outBox.getSize(new THREE.Vector3()) };
}

// Welds by position and counts edges used by one face (holes) or 3+ faces (non-manifold).
function edgeCheck(parts, size) {
  const total = parts.reduce((s, p) => s + p.pos.length / 9, 0);
  if (total > 1500000) return null;
  const q = (Math.max(size.x, size.y, size.z) || 1) * 1e-6;
  const ids = new Map(); let next = 0;
  const id = (a, i) => {
    const key = Math.round(a[i] / q) + ',' + Math.round(a[i + 1] / q) + ',' + Math.round(a[i + 2] / q);
    let r = ids.get(key); if (r === undefined) { r = next++; ids.set(key, r); } return r;
  };
  const edges = new Map();
  let degenerate = 0;
  for (const p of parts) {
    const a = p.pos;
    for (let t = 0; t < a.length; t += 9) {
      const A = id(a, t), B = id(a, t + 3), C = id(a, t + 6);
      if (A === B || B === C || A === C) { degenerate++; continue; }
      for (const [x, y] of [[A, B], [B, C], [C, A]]) {
        const key = x < y ? x * 4294967296 + y : y * 4294967296 + x;
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
  }
  let open = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  return { open, nonManifold, degenerate };
}

function toMesh(pos, name) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(g);
  mesh.name = name;
  return mesh;
}

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.pos.length, 0);
  const all = new Float32Array(len); let o = 0;
  for (const p of parts) { all.set(p.pos, o); o += p.pos.length; }
  return all;
}

function build() {
  const o = options();
  const parts = bakeParts(current.root, o.xform);
  const fin = finish(parts, o);
  const tris = parts.reduce((s, p) => s + p.pos.length / 9, 0);
  return { o, parts, fin, tris };
}

/* ---------- live output summary ---------- */
let lastCheck = null;
function update() {
  if (!current) return;
  ui.target.disabled = [...ui.unit].find(r => r.checked).value !== 'fit';
  const { o, parts, fin, tris } = build();
  lastCheck = edgeCheck(parts, fin.size);
  const unitLabel = o.unit === 'none' ? 'units' : 'mm';
  const s = fin.size, f = v => (v < 10 ? v.toFixed(2) : v.toFixed(1));
  const files = o.merge ? 1 : parts.length;
  const stlBytes = o.binary ? (o.merge ? 84 + 50 * tris : parts.reduce((t, p) => t + 84 + 50 * p.pos.length / 9, 0)) : null;
  const rows = [
    ['output size', `${f(s.x)} x ${f(s.y)} x ${f(s.z)} ${unitLabel}`],
    ['scale factor', 'x' + (fin.k >= 1 ? fin.k.toFixed(fin.k % 1 ? 3 : 0) : fin.k.toPrecision(4))],
    ['triangles', fmtN(tris)],
    ['STL files', o.merge ? '1 (merged)' : files + (files > 1 ? ' (in a .zip)' : '')],
    ['est. STL size', stlBytes ? fmtB(stlBytes) : '~' + fmtB(Math.round(tris * 250)) + ' (ASCII)'],
  ];
  if (lastCheck) {
    rows.push(['open edges', fmtN(lastCheck.open) + (lastCheck.open ? '  (holes: not watertight)' : '  (closed)')]);
    rows.push(['non-manifold edges', fmtN(lastCheck.nonManifold)]);
  }
  ui.out.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  const L = Math.max(s.x, s.y, s.z);
  let warn = '';
  if (o.unit !== 'none' && L < 5) warn = 'The longest side is under 5 mm. Check the scale: this may be too small to print.';
  else if (o.unit !== 'none' && L > 400) warn = 'The longest side is over 400 mm, bigger than most hobby printer beds. Try "fit longest side" or scale it in your slicer.';
  $('scalewarn').textContent = warn;
  $('scalewarn').hidden = !warn;
  ui.dlStl.disabled = ui.dlObj.disabled = false;
  if (ui.viewStl.getAttribute('aria-pressed') === 'true') drawStlPreview(parts, o);
}

/* ---------- export ---------- */
const stlExporter = new STLExporter();
const objExporter = new OBJExporter();

function save(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return blob.size;
}

const base = () => current.name.replace(/\.(glb|gltf)$/i, '').replace(/[^\w.-]+/g, '_') || 'model';
const safe = s => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'part';

function stlOf(mesh, binary) {
  const g = new THREE.Group(); g.add(mesh); g.updateMatrixWorld(true);
  const r = stlExporter.parse(g, { binary });
  return binary ? new Uint8Array(r.buffer, r.byteOffset, r.byteLength) : r;
}

function exportStl() {
  const { o, parts, tris } = build();
  let size, fname;
  if (o.merge || parts.length === 1) {
    const data = stlOf(toMesh(concat(parts), base()), o.binary);
    fname = base() + '.stl';
    size = save(data, fname, o.binary ? 'model/stl' : 'text/plain');
  } else {
    const used = new Map();
    const entries = parts.map(p => {
      let n = safe(p.name); const c = used.get(n) || 0; used.set(n, c + 1); if (c) n += '-' + (c + 1);
      const d = stlOf(toMesh(p.pos, n), o.binary);
      return { name: n + '.stl', data: typeof d === 'string' ? new TextEncoder().encode(d) : d };
    });
    fname = base() + '-stl-parts.zip';
    size = save(zip(entries), fname, 'application/zip');
  }
  say(`Saved ${fname}: ${fmtN(tris)} triangles, ${fmtB(size)}. Textures and colors are not part of STL.`, 'ok');
  document.body.dataset.lastExport = JSON.stringify({ file: fname, tris, bytes: size });
}

function exportObj() {
  const { o, parts, tris } = build();
  const g = new THREE.Group();
  if (o.merge) g.add(toMesh(concat(parts), base()));
  else parts.forEach(p => g.add(toMesh(p.pos, safe(p.name))));
  g.updateMatrixWorld(true);
  const text = '# Exported by glbtostlconverter.com (geometry only, no materials)\n' + objExporter.parse(g);
  const size = save(text, base() + '.obj', 'text/plain');
  say(`Saved ${base()}.obj: ${fmtN(tris)} triangles, ${fmtB(size)}. Geometry only, no .mtl file.`, 'ok');
  document.body.dataset.lastExport = JSON.stringify({ file: base() + '.obj', tris, bytes: size });
}

/* ---------- minimal ZIP (stored, no compression) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(entries) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), crc = crc32(e.data), sz = e.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x5A21, true);
    h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true);
    h.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(h.buffer), name, e.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(14, 0x5A21, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + sz;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/* ---------- STL-look preview ---------- */
const clay = new THREE.MeshStandardMaterial({ color: 0xa3b18a, roughness: 0.75, metalness: 0, flatShading: true, side: THREE.DoubleSide });
function drawStlPreview(parts, o) {
  if (previewStl) { scene.remove(previewStl); previewStl.geometry.dispose(); }
  const pos = concat(parts);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  previewStl = new THREE.Mesh(g, clay);
  // Show the printed orientation: Z-up output is rotated back to Y-up for this viewer.
  if (o.zup) previewStl.rotation.x = -Math.PI / 2;
  scene.add(previewStl);
  previewStl.updateMatrixWorld(true);
  frame(previewStl);
}
function setView(mode) {
  const stl = mode === 'stl';
  ui.viewTex.setAttribute('aria-pressed', String(!stl));
  ui.viewStl.setAttribute('aria-pressed', String(stl));
  if (!current) return;
  if (stl) { current.root.visible = false; const b = build(); drawStlPreview(b.parts, b.o); }
  else { current.root.visible = true; if (previewStl) { scene.remove(previewStl); previewStl.geometry.dispose(); previewStl = null; } frame(current.root); }
}

/* ---------- sample model, built here so nothing is downloaded ---------- */
function sampleChair() {
  const root = new THREE.Group(); root.name = 'sample-chair';
  const wood = new THREE.MeshStandardMaterial({ color: 0xb7793e, roughness: 0.6 });
  const fabric = new THREE.MeshStandardMaterial({ color: 0x5b7553, roughness: 0.9 });
  const add = (name, w, h, d, x, y, z, mat, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.name = name; m.position.set(x, y, z); m.rotation.y = ry; root.add(m); return m;
  };
  add('seat', 0.46, 0.05, 0.44, 0, 0.445, 0, fabric);
  for (const [i, x, z] of [[1, -0.2, -0.19], [2, 0.2, -0.19], [3, -0.2, 0.19], [4, 0.2, 0.19]]) add('leg-' + i, 0.04, 0.42, 0.04, x, 0.21, z, wood);
  add('back-left', 0.04, 0.42, 0.04, -0.2, 0.68, -0.19, wood);
  add('back-right', 0.04, 0.42, 0.04, 0.2, 0.68, -0.19, wood);
  add('backrest', 0.44, 0.16, 0.03, 0, 0.8, -0.19, fabric);
  return root;
}

/* ---------- events ---------- */
ui.file.addEventListener('change', e => { if (e.target.files.length) pickFiles(e.target.files); });
['dragenter', 'dragover'].forEach(t => ui.drop.addEventListener(t, e => { e.preventDefault(); ui.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => ui.drop.addEventListener(t, e => { e.preventDefault(); ui.drop.classList.remove('over'); }));
ui.drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) pickFiles(e.dataTransfer.files); });
ui.sample.addEventListener('click', () => show(sampleChair(), 'sample-chair.glb', 0, null));
[...ui.unit, ...ui.fmt, ui.merge, ui.xform, ui.zup, ui.floor].forEach(el => el.addEventListener('change', update));
ui.target.addEventListener('input', update);
ui.dlStl.addEventListener('click', exportStl);
ui.dlObj.addEventListener('click', exportObj);
ui.viewTex.addEventListener('click', () => setView('tex'));
ui.viewStl.addEventListener('click', () => setView('stl'));
ui.reset.addEventListener('click', () => location.reload());
say('Ready. Your file stays on this device.');
document.body.dataset.ready = '1';
