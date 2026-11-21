const canvas = document.getElementById("gameCanvas");
const gl = canvas.getContext("webgl2");

if (!gl) {
  alert("LOKIZ requires WebGL 2.");
  throw new Error("WebGL 2 unavailable");
}

const vertexShader = `#version 300 es
in vec3 position;
uniform mat4 mvp;
void main() {
  gl_Position = mvp * vec4(position, 1.0);
}`;

const fragmentShader = `#version 300 es
precision highp float;
uniform vec4 color;
out vec4 outColor;
void main() {
  outColor = color;
}`;

function shader(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}

const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexShader));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentShader));
gl.linkProgram(program);

if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program));
}

gl.useProgram(program);

const vertices = new Float32Array([
  -1,-1,-1, 1,-1,-1, 1,1,-1,
  -1,-1,-1, 1,1,-1, -1,1,-1,
  -1,-1,1, 1,-1,1, 1,1,1,
  -1,-1,1, 1,1,1, -1,1,1,
  -1,-1,-1, -1,1,-1, -1,1,1,
  -1,-1,-1, -1,1,1, -1,-1,1,
  1,-1,-1, 1,1,-1, 1,1,1,
  1,-1,-1, 1,1,1, 1,-1,1,
  -1,1,-1, 1,1,-1, 1,1,1,
  -1,1,-1, 1,1,1, -1,1,1,
  -1,-1,-1, 1,-1,-1, 1,-1,1,
  -1,-1,-1, 1,-1,1, -1,-1,1
]);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

const position = gl.getAttribLocation(program, "position");
gl.enableVertexAttribArray(position);
gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);

const mvpLocation = gl.getUniformLocation(program, "mvp");
const colorLocation = gl.getUniformLocation(program, "color");

function identity() {
  return new Float32Array([
    1,0,0,0, 0,1,0,0,
    0,0,1,0, 0,0,0,1
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) {
        out[c*4+r] += a[k*4+r] * b[c*4+k];
      }
    }
  }
  return out;
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f/aspect,0,0,0,
    0,f,0,0,
    0,0,(far+near)*nf,-1,
    0,0,2*far*near*nf,0
  ]);
}

function modelMatrix(obj) {
  const [x,y,z] = obj.position;
  const [rx,ry,rz] = obj.rotation;
  const [sx,sy,sz] = obj.scale;

  const cx=Math.cos(rx), sxr=Math.sin(rx);
  const cy=Math.cos(ry), syr=Math.sin(ry);
  const cz=Math.cos(rz), szr=Math.sin(rz);

  return new Float32Array([
    (cy*cz)*sx, (sxr*syr*cz+cx*szr)*sx, (cx*syr*cz-sxr*szr)*sx, 0,
    (-cy*szr)*sy, (-sxr*syr*szr+cx*cz)*sy, (-cx*syr*szr-sxr*cz)*sy, 0,
    syr*sz, -sxr*cy*sz, cx*cy*sz, 0,
    x,y,z,1
  ]);
}

function cameraMatrix() {
  const view = identity();
  view[14] = -8;
  view[13] = -2;
  return view;
}

const objects = [];
let selected = null;
let playing = false;
let lastTime = 0;

function createObject(type) {
  const obj = {
    id: crypto.randomUUID(),
    name: type + " " + (objects.length + 1),
    type,
    position: [0,0,0],
    rotation: [0,0,0],
    scale: [1,1,1],
    color: [0.4,0.65,1,1]
  };

  objects.push(obj);
  selected = obj;
  updateEditor();
}

function updateEditor() {
  const hierarchy = document.getElementById("hierarchy");
  hierarchy.innerHTML = "";

  objects.forEach(obj => {
    const el = document.createElement("div");
    el.className = "object" + (obj === selected ? " selected" : "");
    el.textContent = obj.name;
    el.onclick = () => {
      selected = obj;
      updateEditor();
    };
    hierarchy.appendChild(el);
  });

  const inspector = document.getElementById("inspector");

  if (!selected) {
    inspector.textContent = "Select an object";
    return;
  }

  inspector.innerHTML = `
    <h4>${selected.name}</h4>
    <label>Position X</label>
    <input type="number" id="px" step="0.1" value="${selected.position[0]}">
    <label>Position Y</label>
    <input type="number" id="py" step="0.1" value="${selected.position[1]}">
    <label>Position Z</label>
    <input type="number" id="pz" step="0.1" value="${selected.position[2]}">
    <label>Color</label>
    <input type="color" id="objectColor" value="#66aaff">
    <button id="deleteObject">Delete Object</button>
  `;

  ["px","py","pz"].forEach((id,i) => {
    document.getElementById(id).oninput = e => {
      selected.position[i] = Number(e.target.value);
    };
  });

  document.getElementById("objectColor").oninput = e => {
    const hex = e.target.value;
    selected.color = [
      parseInt(hex.slice(1,3),16)/255,
      parseInt(hex.slice(3,5),16)/255,
      parseInt(hex.slice(5,7),16)/255,
      1
    ];
  };

  document.getElementById("deleteObject").onclick = () => {
    objects.splice(objects.indexOf(selected),1);
    selected = null;
    updateEditor();
  };
}

function render(time) {
  const dt = Math.min((time-lastTime)/1000, 0.05);
  lastTime = time;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0,0,canvas.width,canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.07,0.07,0.09,1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const projection = perspective(
    Math.PI/3, canvas.width/canvas.height, 0.1, 100
  );

  const view = cameraMatrix();

  objects.forEach(obj => {
    if (playing && obj.type === "Cube") {
      obj.rotation[1] += dt * 0.5;
    }

    const mvp = multiply(
      projection,
      multiply(view, modelMatrix(obj))
    );

    gl.uniformMatrix4fv(mvpLocation,false,mvp);
    gl.uniform4fv(colorLocation,obj.color);
    gl.drawArrays(gl.TRIANGLES,0,36);
  });

  requestAnimationFrame(render);
}

document.getElementById("addCube").onclick = () => createObject("Cube");
document.getElementById("addSphere").onclick = () => createObject("Sphere");
document.getElementById("addPlane").onclick = () => createObject("Plane");

document.getElementById("playBtn").onclick = () => {
  playing = true;
};

document.getElementById("stopBtn").onclick = () => {
  playing = false;
};

createObject("Cube");
requestAnimationFrame(render);
