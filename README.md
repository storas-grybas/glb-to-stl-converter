# GLB to STL Converter

Convert a .glb or .gltf model into a printable STL (binary or ASCII) or a geometry only OBJ, entirely in the browser with three.js.

**Live version:** https://glbtostlconverter.com/

## Features

- Reads .glb files and .gltf files with their separate .bin and texture files (select them together)
- Draco and meshopt compressed models, with both decoders bundled locally
- Model stats before export, including triangle count and the bounding box in meters and millimeters
- Scale options: meters to millimeters (x1000), fit the longest side to a target size, or keep the numbers as they are
- Applies node transforms (including instanced and skinned meshes), rotates Y-up to Z-up and places the model centered on the build plate
- One merged STL, or one STL per mesh packed in a .zip
- Watertight check that counts open edges and non-manifold edges
- Textured and as-STL preview modes, plus a built-in sample chair
- No upload, no server and no tracking

## Run it locally

The page uses ES modules and an import map, so serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How it works

The file is parsed by the three.js GLTFLoader with DRACOLoader and the meshopt decoder. `assets/js/glb2stl.js` walks every mesh in the scene, bakes each node's world matrix into the triangle positions (and flips the winding for mirrored nodes, so normals still face out), then swaps the axes to Z-up, scales and recenters. The edge check welds vertices by position and counts edges shared by one face or by three or more, and the result is written with the three.js STLExporter or OBJExporter.

## Limits

- STL stores triangles only. Textures, colors, materials and UV maps are dropped, and the OBJ export is geometry only too.
- STL has no unit field. The converter assumes glTF meters and writes millimeters, so a model authored at the wrong scale needs the fit option.
- The converter does not repair meshes. If the check reports open edges, fix the model in a mesh editor or let your slicer try.
- Animations and morph targets are ignored.

Need a full 3D model of a furniture piece from one photo? FurniMesh (https://furnimesh.com/image-to-3d?utm_source=github-glb-to-stl-converter&utm_medium=referral&utm_campaign=best-network) is made by the same team.

## Licenses

- Code in this repository: MIT, see `LICENSE`.
- three.js 0.187.0 and its addons in `vendor/three/` (GLTFLoader, DRACOLoader, OrbitControls, STLExporter, OBJExporter, BufferGeometryUtils, SkeletonUtils): MIT, see `vendor/three/LICENSE`.
- meshoptimizer decoder (`vendor/three/addons/libs/meshopt_decoder.module.js`): MIT, copyright Arseny Kapoulkine, as shipped with three.js.
- Draco decoder (`vendor/three/addons/libs/draco/gltf/`): Apache License 2.0, copyright Google, as shipped with three.js. See `vendor/three/addons/libs/draco/LICENSE-Apache-2.0.txt`.
