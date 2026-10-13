import {meshHeightLifts} from './height-exaggeration.mjs';
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_fine; layout(location=1) in vec3 a_coarse; layout(location=2) in vec3 a_color;
layout(location=5) in vec3 a_liftFine;layout(location=6) in vec3 a_liftCoarse;uniform float u_heightScale;layout(location=3) in vec3 a_normal; layout(location=4) in float a_edge; uniform int u_stitch;
uniform vec3 u_offset, u_right, u_up, u_forward; uniform float u_morph, u_focal, u_aspect, u_near, u_far;
uniform vec3 u_anchor; uniform float u_radius; out vec3 v_world; out float v_height; out vec3 v_color; out vec3 v_normal; out float v_distance;
void main(){float m=(int(a_edge)&u_stitch)!=0?0.0:u_morph;vec3 lift=mix(a_liftCoarse,a_liftFine,m)*(u_heightScale-1.0);vec3 p=mix(a_coarse,a_fine,m)+lift+u_offset; float z=dot(p,u_forward);
gl_Position=vec4(dot(p,u_right)*u_focal/u_aspect,dot(p,u_up)*u_focal,
 (u_far+u_near)/(u_far-u_near)*z-2.0*u_far*u_near/(u_far-u_near),z);
vec3 world=mix(a_coarse,a_fine,m)+lift+u_anchor;v_world=world;v_height=length(a_fine+u_anchor)-u_radius;v_color=a_color; vec3 up=normalize(a_fine+u_anchor);float nr=dot(a_normal,up);v_normal=normalize(up*nr+(a_normal-up*nr)*u_heightScale); v_distance=z;}`;
const fragment = `#version 300 es
precision highp float; in vec3 v_color; in vec3 v_normal; in float v_distance;
in vec3 v_world; in float v_height; uniform sampler2D u_map; uniform sampler2D u_zoneMap; uniform int u_zoneEnabled; uniform vec4 u_zoneRect; uniform int u_thematic; uniform float u_contour; uniform float u_far; uniform vec3 u_sun; out vec4 outColor;
void main(){vec3 n=normalize(v_normal);
float light=.08+.92*max(0.0,dot(n,u_sun)); vec3 color=v_color;
if(u_thematic==1){vec3 p=normalize(v_world);vec2 uv=vec2(fract(atan(p.y,p.x)/6.28318530718+1.0),acos(clamp(p.z,-1.0,1.0))/3.14159265359);color=texture(u_map,uv).rgb;if(u_zoneEnabled==1){vec2 local=vec2(fract(uv.x-u_zoneRect.x+1.0),uv.y-u_zoneRect.y);if(local.x<u_zoneRect.z&&local.y>=0.0&&local.y<u_zoneRect.w){vec4 zc=texture(u_zoneMap,local/u_zoneRect.zw);if(zc.a>0.5)color=zc.rgb;}}light=.65+.35*light;}
float line=1.0;if(u_contour>0.0&&v_height>=0.0){float phase=mod(v_height,u_contour),d=min(phase,u_contour-phase),width=fwidth(v_height)*.7;if(width>0.0000007&&width<u_contour*.3)line=mix(.25,1.0,smoothstep(width*.5,width,d));}
outColor=vec4(color*light*line,1.0);
gl_FragDepth=log2(1.0+max(0.0,v_distance))/log2(1.0+u_far);}`;
export class GlobeRenderer {
  constructor(canvas) {
    this.canvas = canvas; const gl = this.gl = canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is unavailable in this browser');
    const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment), p = this.program = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); gl.deleteShader(vs); gl.deleteShader(fs);
    this.uniform = Object.fromEntries(['stitch', 'offset', 'right', 'up', 'forward', 'morph', 'focal', 'aspect', 'near', 'far', 'sun','anchor','radius','map','zoneMap','zoneEnabled','zoneRect','thematic','contour','heightScale'].map(n => [n, gl.getUniformLocation(p, `u_${n}`)]));
    this.gpuBytes = 0; this.peakGpuBytes = 0; this.allocations = 0; this.deletions = 0; this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'); this.pendingQueries = []; this.gpuMs = null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info'); this.device = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    this.contextLost = event => { event.preventDefault(); this.lost = true; }; canvas.addEventListener('webglcontextlost', this.contextLost);
  }
  upload(mesh) {
    const gl = this.gl;
    if(gl.isContextLost?.())throw new Error('GPU context is lost');
    const release=p=>{if(!p)return;for(const b of [p.vbo,p.ibo,p.edgeBuffer,p.liftBuffer])if(b)gl.deleteBuffer(b);if(p.vao)gl.deleteVertexArray(p.vao);};
    const part = (vertices, indices, edgeMask = null, lifts=null) => {
      if (!indices.length) return null;
      const p={vao:null,vbo:null,ibo:null,edgeBuffer:null,liftBuffer:null};
      try {
        p.vao=gl.createVertexArray();p.vbo=gl.createBuffer();p.ibo=gl.createBuffer();
        if(!p.vao||!p.vbo||!p.ibo)throw new Error('GPU allocation failed');
        gl.bindVertexArray(p.vao);gl.bindBuffer(gl.ARRAY_BUFFER,p.vbo);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
        for(let i=0;i<4;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,48,i*12);}
        if(edgeMask){p.edgeBuffer=gl.createBuffer();if(!p.edgeBuffer)throw new Error('GPU edge allocation failed');gl.bindBuffer(gl.ARRAY_BUFFER,p.edgeBuffer);gl.bufferData(gl.ARRAY_BUFFER,edgeMask,gl.STATIC_DRAW);gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,1,gl.UNSIGNED_BYTE,false,1,0);}
        if(lifts){p.liftBuffer=gl.createBuffer();if(!p.liftBuffer)throw new Error('GPU lift allocation failed');gl.bindBuffer(gl.ARRAY_BUFFER,p.liftBuffer);gl.bufferData(gl.ARRAY_BUFFER,lifts,gl.STATIC_DRAW);for(let k=0;k<2;k++){gl.enableVertexAttribArray(5+k);gl.vertexAttribPointer(5+k,3,gl.FLOAT,false,24,k*12);}}
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,p.ibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);gl.bindVertexArray(null);
        const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`GPU upload failed (${error})`);
        return {...p,count:indices.length,bytes:vertices.byteLength+indices.byteLength+(edgeMask?.byteLength??0)+(lifts?.byteLength??0)};
      }catch(e){gl.bindVertexArray(null);release(p);throw e;}
    };
    let ground,overlay;
    try{ground=part(mesh.vertex,mesh.index,mesh.edgeMask,mesh.heightLifts??(this.radiusM?meshHeightLifts(mesh.vertex,mesh.anchor,this.radiusM):null));if(!ground)throw new Error('Empty ground mesh');overlay=part(mesh.overlayVertex,mesh.overlayIndex,null,mesh.overlayHeightLifts??(this.radiusM?meshHeightLifts(mesh.overlayVertex,mesh.anchor,this.radiusM):null));}
    catch(e){release(ground);throw e;}
    const bytes=ground.bytes+(overlay?.bytes??0);
    this.gpuBytes += bytes; this.peakGpuBytes = Math.max(this.peakGpuBytes, this.gpuBytes); this.allocations++;
    return { tile: mesh.tile, pendingFeatures:mesh.pendingFeatures??0, anchor: mesh.anchor, heightRangeM: mesh.heightRangeM, baseHeightRangeM: mesh.baseHeightRangeM, geometricError: mesh.geometricError, featureRefinementLimited:mesh.featureRefinementLimited, morphErrorM: mesh.morphErrorM, edgeMorphErrorM: mesh.edgeMorphErrorM,
      ground, overlay, waterIndexCount:mesh.waterIndexCount??0, witness: mesh.witness, bytes, branchMorph: 0 };
  }
  dispose(tile) {
    const gl = this.gl;
    for (const p of [tile.ground, tile.overlay].filter(Boolean)) { gl.deleteBuffer(p.vbo); if(p.edgeBuffer)gl.deleteBuffer(p.edgeBuffer);if(p.liftBuffer)gl.deleteBuffer(p.liftBuffer); gl.deleteBuffer(p.ibo); gl.deleteVertexArray(p.vao); }
    this.gpuBytes -= tile.bytes; this.deletions++;
  }
  draw(camera, tiles, time) {
    const gl = this.gl, u = this.uniform, c = this.canvas;
    const ratio = Math.min(1.5, devicePixelRatio || 1), w = Math.round(c.clientWidth * ratio), h = Math.round(c.clientHeight * ratio);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(.014, .025, .045, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.useProgram(this.program);
    gl.uniform3fv(u.right, camera.right); gl.uniform3fv(u.up, camera.up); gl.uniform3fv(u.forward, camera.forward); gl.uniform3fv(u.sun, camera.sun??[-.35, .45, .82]);
    gl.uniform1f(u.focal, camera.focal); gl.uniform1f(u.aspect, w / h); gl.uniform1f(u.near, camera.near); gl.uniform1f(u.far, camera.far);
    gl.uniform1f(u.heightScale,camera.heightScale??1);gl.uniform1f(u.radius,camera.radiusM??0);gl.uniform1i(u.map,0);
    if(camera.thematicMap&&this.mapKey!==camera.thematicMap.key){const m=camera.thematicMap;this.mapTexture??=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.mapTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,m.width,m.height,0,gl.RGBA,gl.UNSIGNED_BYTE,m.rgba);this.mapKey=m.key;}
    if(this.mapTexture){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.mapTexture);}
    const zone=camera.thematicMap?.zoneOverlay;gl.uniform1i(u.zoneMap,1);gl.uniform1i(u.zoneEnabled,zone?1:0);
    if(zone){gl.uniform4fv(u.zoneRect,zone.rect);gl.activeTexture(gl.TEXTURE1);this.zoneTexture??=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.zoneTexture);if(this.zoneKey!==zone.key){gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,zone.width,zone.height,0,gl.RGBA,gl.UNSIGNED_BYTE,zone.rgba);this.zoneKey=zone.key;}}

    let query = null;
    if (this.timer && this.pendingQueries.length < 4 && time - (this.lastQuery ?? 0) > 500) { query = gl.createQuery(); gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query); this.lastQuery = time; }
    let triangles = 0;
    for (const { tile, morph, stitchMask = 0 } of tiles) {
      gl.uniform3fv(u.anchor,tile.anchor);gl.uniform1i(u.thematic,camera.thematicMap?1:0);gl.uniform1f(u.contour,camera.contourInterval??0);
      gl.uniform3fv(u.offset, tile.anchor.map((v, i) => v - camera.eye[i])); gl.uniform1f(u.morph, morph);
      gl.uniform1i(u.stitch,stitchMask); gl.bindVertexArray(tile.ground.vao); gl.drawElements(gl.TRIANGLES, tile.ground.count, gl.UNSIGNED_SHORT, 0); triangles += tile.ground.count / 3;
      if (tile.overlay && (morph > .99 || tile.waterIndexCount>0)) { gl.uniform1f(u.contour,0); gl.uniform1i(u.stitch,0); gl.uniform1f(u.morph, 1); gl.bindVertexArray(tile.overlay.vao); const count=morph>.99?tile.overlay.count:tile.waterIndexCount;gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0); triangles += count / 3; }
    }
    gl.bindVertexArray(null);
    if (query) { gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.pendingQueries.push(query); }
    while (this.pendingQueries.length && gl.getQueryParameter(this.pendingQueries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pendingQueries.shift(); if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) this.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q);
    }
    return { drawTiles: tiles.length, triangles, gpuMs: this.gpuMs, viewport: [w, h] };
  }
  destroy() { this.canvas.removeEventListener('webglcontextlost',this.contextLost); for (const q of this.pendingQueries) this.gl.deleteQuery(q); if(this.mapTexture)this.gl.deleteTexture(this.mapTexture);if(this.zoneTexture)this.gl.deleteTexture(this.zoneTexture); this.gl.deleteProgram(this.program); }
}
