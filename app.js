
const $ = id => document.getElementById(id);
const canvas = $('view');
const gl = canvas.getContext('webgl2', { antialias: true });

if (!gl) {
  alert('LOKIZ requires WebGL 2.');
  throw new Error('WebGL2 unavailable');
}

const VS = `#version 300 es
in vec3 aPosition;
uniform mat4 uMVP;
void main() {
  gl_Position = uMVP * vec4(aPosition, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

function compile(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);

  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }

  return s;
}

const program = gl.createProgram();

gl.attachShader(program, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(program);

if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program));
}

gl.useProgram(program);

const loc = {
  pos: gl.getAttribLocation(program, 'aPosition'),
  mvp: gl.getUniformLocation(program, 'uMVP'),
  color: gl.getUniformLocation(program, 'uColor')
};

const cubeVerts = new Float32Array([
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

const cubeBuffer = gl.createBuffer();

gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
gl.bufferData(gl.ARRAY_BUFFER, cubeVerts, gl.STATIC_DRAW);

gl.enableVertexAttribArray(loc.pos);
gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);

const grid = [];

for (let i = -10; i <= 10; i++) {
  grid.push(
    i,0,-10, i,0,10,
    -10,0,i, 10,0,i
  );
}

const gridBuffer = gl.createBuffer();

gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array(grid),
  gl.STATIC_DRAW
);

function uid() {
  return Math.random().toString(36).slice(2,10);
}

function defaultScene() {
  return {
    objects: [{
      id: uid(),
      name: 'Cube',
      type: 'cube',
      x: 0, y: 0, z: 0,
      sx: 1, sy: 1, sz: 1,
      color: '#7777ff',
      rotation: 0
    }]
  };
}

let scene = defaultScene();
let selected = scene.objects[0];
let socket = null;
let connected = false;
let suppressSync = false;
let playing = false;
let angle = 0.65;
let zoom = 8;
let drag = null;

const saved = localStorage.getItem('lokiz-scene');

if (saved) {
  try {
    scene = JSON.parse(saved);
    selected = scene.objects[0] || null;
  } catch {}
}

function hexColor(hex) {
  return [
    parseInt(hex.slice(1,3),16)/255,
    parseInt(hex.slice(3,5),16)/255,
    parseInt(hex.slice(5,7),16)/255,
    1
  ];
}

function matMul(a,b) {
  const o = new Float32Array(16);

  for (let c=0;c<4;c++)
    for (let r=0;r<4;r++)
      for (let k=0;k<4;k++)
        o[c*4+r] += a[k*4+r] * b[c*4+k];

  return o;
}

function perspective(f,a,n,fz) {
  const t = 1/Math.tan(f/2);
  const nf = 1/(n-fz);

  return new Float32Array([
    t/a,0,0,0,
    0,t,0,0,
    0,0,(fz+n)*nf,-1,
    0,0,2*fz*n*nf,0
  ]);
}

const sub = (a,b) => a.map((v,i)=>v-b[i]);

const dot = (a,b) =>
  a.reduce((s,v,i)=>s+v*b[i],0);

const cross = (a,b) => [
  a[1]*b[2]-a[2]*b[1],
  a[2]*b[0]-a[0]*b[2],
  a[0]*b[1]-a[1]*b[0]
];

const norm = a => {
  const l = Math.hypot(...a) || 1;
  return a.map(v=>v/l);
};

function lookAt(eye,center) {
  const z = norm(sub(eye,center));
  const x = norm(cross([0,1,0],z));
  const y = cross(z,x);

  return new Float32Array([
    x[0],y[0],z[0],0,
    x[1],y[1],z[1],0,
    x[2],y[2],z[2],0,
    -dot(x,eye),-dot(y,eye),-dot(z,eye),1
  ]);
}

function model(o) {
  const c = Math.cos(o.rotation || 0);
  const s = Math.sin(o.rotation || 0);

  return new Float32Array([
    c*o.sx,0,-s*o.sx,0,
    0,o.sy,0,0,
    s*o.sz,0,c*o.sz,0,
    o.x,o.y,o.z,1
  ]);
}

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  if (
    canvas.width !== w*devicePixelRatio ||
    canvas.height !== h*devicePixelRatio
  ) {
    canvas.width = w*devicePixelRatio;
    canvas.height = h*devicePixelRatio;
  }

  gl.viewport(0,0,canvas.width,canvas.height);
  gl.enable(gl.DEPTH_TEST);

  gl.clearColor(.055,.065,.085,1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const eye = [
    Math.sin(angle)*zoom,
    zoom*.55,
    Math.cos(angle)*zoom
  ];

  const view = lookAt(eye,[0,0,0]);

  const proj = perspective(
    Math.PI/3,
    canvas.width/canvas.height,
    .1,
    100
  );

  const vp = matMul(proj,view);

  // Grid
  gl.bindBuffer(gl.ARRAY_BUFFER,gridBuffer);
  gl.vertexAttribPointer(loc.pos,3,gl.FLOAT,false,0,0);

  gl.uniformMatrix4fv(loc.mvp,false,vp);
  gl.uniform4fv(loc.color,[.22,.25,.3,1]);

  gl.drawArrays(gl.LINES,0,grid.length/3);

  // Objects
  gl.bindBuffer(gl.ARRAY_BUFFER,cubeBuffer);
  gl.vertexAttribPointer(loc.pos,3,gl.FLOAT,false,0,0);

  for (const o of scene.objects) {
    gl.uniformMatrix4fv(
      loc.mvp,
      false,
      matMul(vp,model(o))
    );

    let c = hexColor(o.color || '#8888ff');

    if (o === selected) {
      c = [
        Math.min(1,c[0]*1.3+.12),
        Math.min(1,c[1]*1.3+.12),
        Math.min(1,c[2]*1.3+.12),
        1
      ];
    }

    gl.uniform4fv(loc.color,c);
    gl.drawArrays(gl.TRIANGLES,0,36);
  }

  requestAnimationFrame(draw);
}

function updateUI() {
  const list = $('hierarchy');
  list.replaceChildren();

  scene.objects.forEach(o => {
    const el = document.createElement('div');

    el.className =
      'tree-item' + (o === selected ? ' selected' : '');

    el.textContent = '◇  ' + o.name;

    el.onclick = () => {
      selected = o;
      updateUI();
    };

    list.append(el);
  });

  $('objectCount').textContent =
    scene.objects.length + ' OBJECT' +
    (scene.objects.length === 1 ? '' : 'S');

  renderInspector();
}

function renderInspector() {
  const box = $('inspector');
  box.replaceChildren();

  if (!selected) {
    box.innerHTML =
      '<p class="muted">Select an object to edit its properties.</p>';
    return;
  }

  const title = document.createElement('h3');
  title.textContent = selected.name;
  box.append(title);

  box.append(makeInput(
    'Name',
    selected.name,
    'text',
    v => {
      selected.name = v;
      updateUI();
      syncScene();
    }
  ));

  for (const [label,keys] of [
    ['Position',['x','y','z']],
    ['Scale',['sx','sy','sz']]
  ]) {
    const row = document.createElement('div');
    row.className = 'field-row';

    keys.forEach(k => {
      row.append(makeInput(
        k.toUpperCase(),
        selected[k],
        'number',
        v => {
          selected[k] = Number(v);
          syncScene();
        }
      ));
    });

    box.append(row);
  }

  box.append(makeInput(
    'Rotation (degrees)',
    Math.round((selected.rotation || 0)*180/Math.PI),
    'number',
    v => {
      selected.rotation = Number(v)*Math.PI/180;
      syncScene();
    }
  ));

  box.append(makeInput(
    'Color',
    selected.color || '#7777ff',
    'color',
    v => {
      selected.color = v;
      syncScene();
    }
  ));

  const del = document.createElement('button');
  del.textContent = 'Delete object';
  del.className = 'delete';

  del.onclick = () => {
    if (!canEdit()) return;

    scene.objects = scene.objects.filter(o=>o!==selected);
    selected = scene.objects[0] || null;

    updateUI();
    syncScene();
  };

  box.append(del);
}

function makeInput(label,value,type,change) {
  const wrap = document.createElement('label');
  wrap.textContent = label;

  const input = document.createElement('input');
  input.type = type;
  input.value = value;

  input.addEventListener('change',()=>{
    change(input.value);
  });

  wrap.append(input);
  return wrap;
}

function canEdit() {
  if (connected && $('userRole').value === 'viewer') {
    alert('Viewer access: editing is disabled.');
    return false;
  }

  return true;
}

function addObject(type) {
  if (!canEdit()) return;

  const o = {
    id: uid(),
    name: type + ' ' + (scene.objects.length+1),
    type,
    x:0,y:0,z:0,
    sx:1,sy:1,sz:1,
    color: type === 'sphere' ? '#50c9a5' : '#7777ff',
    rotation:0
  };

  scene.objects.push(o);
  selected = o;

  updateUI();
  syncScene();
}

function syncScene() {
  if (suppressSync) return;

  localStorage.setItem(
    'lokiz-scene',
    JSON.stringify(scene)
  );

  if (
    connected &&
    socket?.readyState === WebSocket.OPEN &&
    $('userRole').value === 'editor'
  ) {
    socket.send(JSON.stringify({
      type:'scene',
      scene
    }));
  }
}

function addChat(name,text,time=Date.now(),system=false) {
  const log = $('chatLog');
  const el = document.createElement('div');

  el.className = system
    ? 'system-message'
    : 'chat-message';

  if (system) {
    el.textContent = text;
  } else {
    const b = document.createElement('b');
    b.textContent = name;

    const msg = document.createElement('span');
    msg.textContent = text;

    const t = document.createElement('time');
    t.textContent = ' · ' +
      new Date(time).toLocaleTimeString([], {
        hour:'2-digit',
        minute:'2-digit'
      });

    el.append(b,msg,t);
  }

  log.append(el);
  log.scrollTop = log.scrollHeight;
}

function connect() {
  if (socket) socket.close();

  const name = $('userName').value.trim() || 'Guest';
  const room = $('roomCode').value.trim() || 'main';
  const role = $('userRole').value;

  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';

  const wsUrl = location.protocol === 'file:'
    ? 'ws://localhost:4173'
    : `${scheme}//${location.host}`;

  socket = new WebSocket(wsUrl);

  $('connectionText').textContent = 'CONNECTING';

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type:'join',
      name,
      room,
      role
    }));
  };

  socket.onmessage = e => {
    const m = JSON.parse(e.data);

    if (m.type === 'joined') {
      connected = true;

      $('connectionDot').style.background = 'var(--green)';
      $('connectionText').textContent = 'CONNECTED';
      $('sceneStatus').textContent = 'ROOM: ' + m.room;

      if (m.scene?.objects) {
        suppressSync = true;
        scene = m.scene;
        selected = scene.objects[0] || null;
        updateUI();
        suppressSync = false;
      }

      renderMembers(m.members || []);

      $('chatLog').replaceChildren();

      addChat(
        'LOKIZ',
        'Connected to room ' + m.room,
        Date.now(),
        true
      );

    } else if (m.type === 'scene') {
      suppressSync = true;

      scene = m.scene;

      selected =
        scene.objects.find(o =>
          selected && o.id === selected.id
        ) || scene.objects[0] || null;

      updateUI();
      suppressSync = false;

      $('sceneStatus').textContent =
        'SYNCED · ' + m.by;

    } else if (m.type === 'presence') {
      renderMembers(m.members || []);

    } else if (m.type === 'chat') {
      addChat(
        m.item.name,
        m.item.text,
        m.item.time
      );

    } else if (m.type === 'system') {
      addChat('',m.text,Date.now(),true);

    } else if (m.type === 'error') {
      addChat('',m.message,Date.now(),true);
    }
  };

  socket.onclose = () => {
    connected = false;

    $('connectionDot').style.background = '#687080';
    $('connectionText').textContent = 'OFFLINE';
    $('sceneStatus').textContent = 'LOCAL SCENE';

    renderMembers([]);
  };

  socket.onerror = () => {
    addChat(
      '',
      'Could not connect. Start the LOKIZ server and try again.',
      Date.now(),
      true
    );
  };
}

function renderMembers(members) {
  $('memberCount').textContent = members.length;

  const box = $('members');
  box.replaceChildren();

  if (!members.length) {
    box.innerHTML =
      '<span class="muted">No connected members</span>';
    return;
  }

  members.forEach(m => {
    const row = document.createElement('div');
    row.className = 'member';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = (m.name || '?').slice(0,1).toUpperCase();

    const name = document.createElement('span');
    name.textContent = m.name;

    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = m.role;

    row.append(avatar,name,role);
    box.append(row);
  });
}

// Editor controls
$('addCube').onclick = () => addObject('cube');
$('addSphere').onclick = () => addObject('sphere');
$('joinBtn').onclick = connect;

// Save locally
$('saveBtn').onclick = () => {
  localStorage.setItem(
    'lokiz-scene',
    JSON.stringify(scene)
  );

  addChat(
    'LOKIZ',
    'Scene saved in this browser.',
    Date.now(),
    true
  );
};

// Export project
$('exportBtn').onclick = () => {
  const blob = new Blob(
    [JSON.stringify(scene,null,2)],
    {type:'application/json'}
  );

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lokiz-scene.json';
  a.click();

  URL.revokeObjectURL(a.href);
};

// Play mode
$('playBtn').onclick = () => {
  playing = !playing;

  $('playBtn').textContent =
    playing ? '■ Stop' : '▶ Play';

  if (playing) {
    const animate = () => {
      if (!playing) return;

      scene.objects.forEach(o => {
        o.rotation = (o.rotation || 0) + .006;
      });

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  } else {
    syncScene();
  }
};

// Team chat
$('chatForm').onsubmit = e => {
  e.preventDefault();

  const text = $('chatInput').value.trim();
  if (!text) return;

  if (!connected) {
    addChat('LOCAL',text);
    $('chatInput').value = '';
    return;
  }

  socket.send(JSON.stringify({
    type:'chat',
    text
  }));

  $('chatInput').value = '';
};

// Camera controls
canvas.addEventListener('pointerdown',e => {
  drag = {
    x:e.clientX,
    y:e.clientY,
    angle
  };

  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove',e => {
  if (!drag) return;

  angle = drag.angle + (e.clientX-drag.x)*.008;
});

canvas.addEventListener('pointerup',()=>{
  drag = null;
});

canvas.addEventListener('wheel',e => {
  zoom = Math.max(
    3,
    Math.min(20,zoom+e.deltaY*.01)
  );

  e.preventDefault();
},{passive:false});

updateUI();
requestAnimationFrame(draw);
